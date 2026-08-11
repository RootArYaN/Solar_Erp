from __future__ import annotations

from typing import TYPE_CHECKING

import json
import re
import tempfile
from contextlib import ExitStack
from io import BytesIO
from pathlib import Path
from datetime import UTC, datetime
from uuid import uuid4
from decimal import Decimal

from sqlalchemy import case, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


if TYPE_CHECKING:
    from app.api.deps import CurrentSession

from app.core.concurrency import RecordConflictError, verify_version
from app.models.agent import AgentCustomer
from app.models.auth import Membership, User
from app.models.operations import (
    DocumentTemplate,
    GeneratedDocumentPack,
    InventoryBalance,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    Poster,
    PricingBook,
    PricingItem,
)
from app.models.system import AuditEvent, StoredFile
from app.models.workflow import CustomerProject, CustomerQuotation
from app.schemas.operations import (
    CreateInventoryMovementBatchRequest,
    CreateInventoryItemRequest,
    CreateInventoryLocationRequest,
    CreateInventoryMovementRequest,
    CreatePosterRequest,
    DocumentTemplateSummary,
    GeneratedDocumentPackSummary,
    InventoryItemSummary,
    InventoryLocationSummary,
    InventoryMovementCorrectionRequest,
    InventoryMovementList,
    InventoryMovementReversalRequest,
    InventoryMovementSummary,
    InventorySummary,
    PosterSummary,
    PricingBookSummary,
    PricingItemInput,
    SaveDocumentTemplateRequest,
    SaveGeneratedDocumentPackRequest,
    SavePricingBookRequest,
)
from app.services.access_service import AccessError, get_customer, get_project, operational_reference_filter
from app.services.audit_service import write_event
from app.services.customer_lifecycle_service import CustomerLifecycleError, reactivate_for_activity
from app.services.storage import storage
from app.services import workflow_service


class OperationsServiceError(Exception):
    status_code = 400


class OperationsNotFoundError(OperationsServiceError):
    status_code = 404


class OperationsConflictError(OperationsServiceError):
    status_code = 409


DEFAULT_DOCUMENT_COMPANY_NAME = 'Shree Enterprise'


def _customer_document_slot(row: StoredFile) -> str:
    if row.owner_type.startswith("customer_document:"):
        return row.owner_type.partition(":")[2]
    normalized = re.sub(r"[^a-z0-9]+", " ", Path(row.name).stem.lower()).strip()
    if any(alias in normalized for alias in ("aadhaar", "aadhar", "adhar")):
        return "aadhaar"
    if "customer signature" in normalized or normalized == "signature":
        return "customer_signature"
    return ""


def _active_customer_documents(db: Session, row: GeneratedDocumentPack) -> list[StoredFile]:
    return list(db.scalars(
        select(StoredFile)
        .where(
            StoredFile.company_id == row.company_id,
            StoredFile.customer_id == row.customer_id,
            or_(
                StoredFile.owner_type == "customer_document",
                StoredFile.owner_type.like("customer_document:%"),
            ),
        )
        .order_by(StoredFile.created_at.asc())
    ).all())


def _required_customer_documents(db: Session, row: GeneratedDocumentPack) -> list[str]:
    present = {_customer_document_slot(file) for file in _active_customer_documents(db, row)}
    labels = {"aadhaar": "Aadhaar card", "customer_signature": "Customer signature"}
    return [labels[key] for key in ("aadhaar", "customer_signature") if key not in present]


def merged_document_pack(
    db: Session,
    actor: CurrentSession,
    pack_id: str,
) -> tuple[Path, str, GeneratedDocumentPack, int]:
    row = db.scalar(select(GeneratedDocumentPack).where(
        GeneratedDocumentPack.id == pack_id,
        GeneratedDocumentPack.company_id == actor.membership.company_id,
    ))
    if not row:
        raise OperationsNotFoundError("Document pack not found")
    _document_context(db, actor, row.customer_id)
    if row.status not in {"generated", "final"}:
        raise OperationsConflictError("Generate the full document pack before downloading a merged PDF")

    generated = db.scalar(
        select(StoredFile)
        .where(
            StoredFile.company_id == row.company_id,
            StoredFile.owner_type == "generated_document_pack",
            StoredFile.owner_id == row.id,
            StoredFile.mime_type == "application/pdf",
        )
        .order_by(StoredFile.created_at.desc())
    )
    if not generated:
        raise OperationsNotFoundError("The stored full-pack PDF is missing for this version")

    attachments = _active_customer_documents(db, row)
    try:
        from PIL import Image, ImageOps
        from pypdf import PdfReader, PdfWriter

        with ExitStack() as resources:
            writer = PdfWriter()
            generated_path = resources.enter_context(storage.materialize(generated.storage_path))
            writer.append(str(generated_path))
            for attachment in attachments:
                path = resources.enter_context(storage.materialize(attachment.storage_path))
                if attachment.mime_type == "application/pdf":
                    writer.append(str(path))
                    continue
                if attachment.mime_type.startswith("image/"):
                    with Image.open(path) as source:
                        image = ImageOps.exif_transpose(source).convert("RGB")
                        image_pdf = BytesIO()
                        resources.callback(image_pdf.close)
                        image.save(image_pdf, format="PDF", resolution=150)
                        image_pdf.seek(0)
                        writer.append(PdfReader(image_pdf))
                    continue
                raise OperationsConflictError(
                    f"{attachment.name} cannot be merged. Upload customer attachments as PDF, JPG, PNG, or WebP."
                )

            with tempfile.NamedTemporaryFile(
                prefix=f"document-pack-v{row.version}-",
                suffix=".pdf",
                dir=storage.temp_root,
                delete=False,
            ) as output:
                writer.write(output)
                output_path = Path(output.name)
    except OperationsServiceError:
        raise
    except Exception as exc:
        raise OperationsConflictError(f"Could not merge the document pack: {exc}") from exc

    base_name = Path(generated.name).stem
    download_name = f"{base_name}_With_Attachments.pdf"
    return output_path, download_name, row, len(attachments)


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def _f(value) -> float:
    return float(Decimal(value or 0))


def _location_summary(row: InventoryLocation) -> InventoryLocationSummary:
    return InventoryLocationSummary(id=row.id, version=row.version, name=row.name, location_type=row.location_type, address=row.address, is_active=row.is_active)


def _inventory_balance_totals(db: Session, company_id: str):
    return (
        select(
            InventoryBalance.item_id.label("item_id"),
            func.coalesce(func.sum(InventoryBalance.quantity_on_hand), 0).label("on_hand"),
            func.coalesce(func.sum(InventoryBalance.reserved_quantity), 0).label("reserved"),
        )
        .where(InventoryBalance.company_id == company_id)
        .group_by(InventoryBalance.item_id)
        .subquery()
    )


def _inventory_totals(db: Session, company_id: str) -> tuple[int, int, Decimal, Decimal]:
    balances = _inventory_balance_totals(db, company_id)
    on_hand = func.coalesce(balances.c.on_hand, 0)
    available = on_hand - func.coalesce(balances.c.reserved, 0)
    row = db.execute(
        select(
            func.count(InventoryItem.id),
            func.coalesce(func.sum(case((available <= InventoryItem.reorder_level, 1), else_=0)), 0),
            func.coalesce(func.sum(on_hand * InventoryItem.unit_cost), 0),
            func.coalesce(func.sum(on_hand), 0),
        )
        .select_from(InventoryItem)
        .outerjoin(balances, balances.c.item_id == InventoryItem.id)
        .where(
            InventoryItem.company_id == company_id,
            InventoryItem.is_active.is_(True),
        )
    ).one()
    return int(row[0] or 0), int(row[1] or 0), Decimal(row[2] or 0), Decimal(row[3] or 0)


def _inventory_item_filters(
    company_id: str,
    *,
    query: str | None = None,
    category: str | None = None,
):
    filters = [
        InventoryItem.company_id == company_id,
        InventoryItem.is_active.is_(True),
    ]
    normalized_category = (category or '').strip()
    if normalized_category:
        filters.append(InventoryItem.category == normalized_category)
    term = (query or '').strip().lower()
    if term:
        like = f'%{term}%'
        location_match = exists(
            select(InventoryBalance.id)
            .join(InventoryLocation, InventoryLocation.id == InventoryBalance.location_id)
            .where(
                InventoryBalance.company_id == company_id,
                InventoryBalance.item_id == InventoryItem.id,
                InventoryLocation.company_id == company_id,
                InventoryLocation.is_active.is_(True),
                func.lower(InventoryLocation.name).like(like),
            )
        )
        filters.append(or_(
            func.lower(InventoryItem.sku).like(like),
            func.lower(InventoryItem.name).like(like),
            func.lower(InventoryItem.category).like(like),
            func.lower(InventoryItem.supplier_name).like(like),
            location_match,
        ))
    return filters


def _inventory_maps(
    db: Session,
    company_id: str,
    *,
    item_offset: int = 0,
    item_limit: int | None = None,
    item_query: str | None = None,
    item_category: str | None = None,
):
    item_filters = _inventory_item_filters(company_id, query=item_query, category=item_category)
    item_statement = (
        select(InventoryItem)
        .where(*item_filters)
        .order_by(InventoryItem.category, InventoryItem.name, InventoryItem.id)
        .offset(item_offset)
    )
    if item_limit is not None:
        item_statement = item_statement.limit(item_limit)
    items = list(db.scalars(item_statement).all())
    locations = list(db.scalars(
        select(InventoryLocation)
        .where(InventoryLocation.company_id == company_id, InventoryLocation.is_active.is_(True))
        .order_by(InventoryLocation.name)
    ).all())
    item_ids = [item.id for item in items]
    balances = list(db.scalars(
        select(InventoryBalance).where(
            InventoryBalance.company_id == company_id,
            InventoryBalance.item_id.in_(item_ids),
        )
    ).all()) if item_ids else []
    return items, locations, balances



def low_stock_item_count(db: Session, company_id: str) -> int:
    _total, low_stock, _value, _quantity = _inventory_totals(db, company_id)
    return low_stock


def _inventory_item_summary_from_related(
    item: InventoryItem,
    item_balances: list[InventoryBalance],
    location_by_id: dict[str, InventoryLocation],
) -> InventoryItemSummary:
    on_hand = sum((Decimal(row.quantity_on_hand or 0) for row in item_balances), Decimal('0'))
    reserved = sum((Decimal(row.reserved_quantity or 0) for row in item_balances), Decimal('0'))
    available = on_hand - reserved
    primary = max(item_balances, key=lambda row: row.quantity_on_hand, default=None)
    return InventoryItemSummary(
        id=item.id, version=item.version, sku=item.sku, name=item.name, category=item.category, unit=item.unit,
        supplier_name=item.supplier_name, unit_cost=_f(item.unit_cost), reorder_level=_f(item.reorder_level),
        quantity_on_hand=_f(on_hand), reserved_quantity=_f(reserved), available_quantity=_f(available),
        location_id=primary.location_id if primary else None,
        location_name=location_by_id[primary.location_id].name if primary and primary.location_id in location_by_id else '',
        low_stock=available <= Decimal(item.reorder_level or 0), is_active=item.is_active, updated_at=item.updated_at,
    )


def _inventory_item_summary(db: Session, item: InventoryItem) -> InventoryItemSummary:
    balances = list(db.scalars(select(InventoryBalance).where(
        InventoryBalance.company_id == item.company_id,
        InventoryBalance.item_id == item.id,
    )).all())
    location_ids = {row.location_id for row in balances}
    locations = {
        row.id: row
        for row in db.scalars(select(InventoryLocation).where(InventoryLocation.id.in_(location_ids))).all()
    } if location_ids else {}
    return _inventory_item_summary_from_related(item, balances, locations)


def inventory_summary(
    db: Session,
    actor: CurrentSession,
    *,
    item_page: int = 1,
    item_page_size: int = 50,
    item_query: str | None = None,
    item_category: str | None = None,
    movement_limit: int = 30,
) -> InventorySummary:
    company_id = actor.membership.company_id
    total_items, low_stock, stock_value, total_quantity = _inventory_totals(db, company_id)
    item_filters = _inventory_item_filters(company_id, query=item_query, category=item_category)
    item_total = int(db.scalar(
        select(func.count(InventoryItem.id)).where(*item_filters)
    ) or 0)
    item_categories = [
        str(value) for value in db.scalars(
            select(InventoryItem.category)
            .where(
                InventoryItem.company_id == company_id,
                InventoryItem.is_active.is_(True),
                InventoryItem.category != '',
            )
            .distinct()
            .order_by(InventoryItem.category)
        ).all()
    ]
    max_page = max(1, (item_total + item_page_size - 1) // item_page_size)
    item_page = min(item_page, max_page)
    item_offset = (item_page - 1) * item_page_size
    items, locations, balances = _inventory_maps(
        db,
        company_id,
        item_offset=item_offset,
        item_limit=item_page_size,
        item_query=item_query,
        item_category=item_category,
    )
    location_by_id = {row.id: row for row in locations}
    balance_by_item: dict[str, list[InventoryBalance]] = {}
    for balance in balances:
        balance_by_item.setdefault(balance.item_id, []).append(balance)
    item_summaries = [
        _inventory_item_summary_from_related(item, balance_by_item.get(item.id, []), location_by_id)
        for item in items
    ]
    movement_rows = list(db.scalars(
        select(InventoryMovement)
        .where(
            InventoryMovement.company_id == company_id,
            operational_reference_filter(
                company_id,
                customer_column=InventoryMovement.customer_id,
                project_column=InventoryMovement.project_id,
            ),
        )
        .order_by(InventoryMovement.created_at.desc(), InventoryMovement.id.desc())
        .limit(movement_limit)
    ).all()) if movement_limit else []
    movement_summaries = _movement_summaries(db, movement_rows)
    return InventorySummary(
        items=item_summaries,
        locations=[_location_summary(row) for row in locations],
        movements=movement_summaries,
        total_items=total_items,
        low_stock_items=low_stock,
        stock_value=_f(stock_value),
        total_quantity=_f(total_quantity),
        item_page=item_page,
        item_page_size=item_page_size,
        item_total=item_total,
        item_categories=item_categories,
        items_has_more=item_offset + len(item_summaries) < item_total,
    )


def list_inventory_movements(
    db: Session,
    actor: CurrentSession,
    *,
    item_id: str | None = None,
    customer_id: str | None = None,
    movement_type: str | None = None,
    status: str | None = None,
    query: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> InventoryMovementList:
    filters = [
        InventoryMovement.company_id == actor.membership.company_id,
        operational_reference_filter(
            actor.membership.company_id,
            customer_column=InventoryMovement.customer_id,
            project_column=InventoryMovement.project_id,
        ),
    ]
    if item_id:
        filters.append(InventoryMovement.item_id == item_id)
    if customer_id:
        filters.append(InventoryMovement.customer_id == customer_id)
    if movement_type:
        filters.append(InventoryMovement.movement_type == movement_type)
    if status:
        filters.append(InventoryMovement.status == status)
    if query and (search_value := query.strip().lower()):
        item_match = exists(
            select(InventoryItem.id).where(
                InventoryItem.id == InventoryMovement.item_id,
                or_(
                    func.lower(InventoryItem.name).contains(search_value, autoescape=True),
                    func.lower(InventoryItem.sku).contains(search_value, autoescape=True),
                    func.lower(InventoryItem.supplier_name).contains(search_value, autoescape=True),
                ),
            )
        )
        location_match = exists(
            select(InventoryLocation.id).where(
                or_(
                    InventoryLocation.id == InventoryMovement.source_location_id,
                    InventoryLocation.id == InventoryMovement.destination_location_id,
                ),
                or_(
                    func.lower(InventoryLocation.name).contains(search_value, autoescape=True),
                    func.lower(InventoryLocation.address).contains(search_value, autoescape=True),
                ),
            )
        )
        filters.append(or_(
            func.lower(InventoryMovement.reference_number).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.supplier_name).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.transporter_name).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.vehicle_number).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.driver_name).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.driver_phone).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.eway_bill_number).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.source_location_manual).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.destination_location_manual).contains(search_value, autoescape=True),
            func.lower(InventoryMovement.note).contains(search_value, autoescape=True),
            item_match,
            location_match,
        ))
    total = int(db.scalar(select(func.count()).select_from(InventoryMovement).where(*filters)) or 0)
    rows = list(db.scalars(
        select(InventoryMovement)
        .where(*filters)
        .order_by(InventoryMovement.created_at.desc(), InventoryMovement.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())
    return InventoryMovementList(
        data=_movement_summaries(db, rows),
        page=page,
        page_size=page_size,
        total=total,
    )


def get_inventory_challan_movements(
    db: Session,
    actor: CurrentSession,
    movement_id: str,
) -> list[InventoryMovementSummary]:
    scope_filter = operational_reference_filter(
        actor.membership.company_id,
        customer_column=InventoryMovement.customer_id,
        project_column=InventoryMovement.project_id,
    )
    movement = db.scalar(
        select(InventoryMovement).where(
            InventoryMovement.id == movement_id,
            InventoryMovement.company_id == actor.membership.company_id,
            scope_filter,
        )
    )
    if not movement:
        raise OperationsNotFoundError('Inventory movement not found')

    if movement.movement_group_id:
        challan_filter = InventoryMovement.movement_group_id == movement.movement_group_id
    elif movement.challan_id:
        challan_filter = InventoryMovement.challan_id == movement.challan_id
    elif movement.reference_number:
        # Legacy individual movements may only have the printed challan number.
        challan_filter = InventoryMovement.reference_number == movement.reference_number
    else:
        challan_filter = InventoryMovement.id == movement.id

    rows = list(db.scalars(
        select(InventoryMovement)
        .where(
            InventoryMovement.company_id == actor.membership.company_id,
            scope_filter,
            challan_filter,
        )
        .order_by(InventoryMovement.created_at.asc(), InventoryMovement.id.asc())
    ).all())
    return _movement_summaries(db, rows)


def create_location(db: Session, actor: CurrentSession, payload: CreateInventoryLocationRequest) -> InventoryLocationSummary:
    row = InventoryLocation(company_id=actor.membership.company_id, name=payload.name.strip(), location_type=payload.location_type.strip(), address=payload.address.strip())
    db.add(row)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise OperationsConflictError('An inventory location with this name already exists') from exc
    write_event(db, company_id=row.company_id, event='inventory.location_created', entity='inventory_location', entity_id=row.id, actor=actor, changes={'name': row.name})
    db.commit(); return _location_summary(row)


def create_item(db: Session, actor: CurrentSession, payload: CreateInventoryItemRequest) -> InventoryItemSummary:
    location = db.scalar(select(InventoryLocation).where(InventoryLocation.id == payload.location_id, InventoryLocation.company_id == actor.membership.company_id, InventoryLocation.is_active.is_(True)))
    if not location: raise OperationsNotFoundError('Inventory location not found')
    row = InventoryItem(company_id=actor.membership.company_id, sku=payload.sku.upper(), name=payload.name, category=payload.category, unit=payload.unit, supplier_name=payload.supplier_name, unit_cost=_d(payload.unit_cost), reorder_level=_d(payload.reorder_level))
    db.add(row)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise OperationsConflictError('An inventory item with this SKU already exists') from exc
    balance = InventoryBalance(company_id=row.company_id, item_id=row.id, location_id=location.id, quantity_on_hand=_d(payload.opening_quantity), reserved_quantity=Decimal('0'))
    db.add(balance)
    if payload.opening_quantity > 0:
        db.add(InventoryMovement(company_id=row.company_id, item_id=row.id, movement_type='inward', quantity=_d(payload.opening_quantity), destination_location_id=location.id, reference_number=f'OPEN-{row.sku}', note='Opening stock', status='completed', created_by=actor.membership.id))
    write_event(db, company_id=row.company_id, event='inventory.item_created', entity='inventory_item', entity_id=row.id, actor=actor, changes={'sku': row.sku, 'name': row.name, 'opening_quantity': str(payload.opening_quantity)})
    db.commit()
    return _inventory_item_summary(db, row)


def _balance(db: Session, company_id: str, item_id: str, location_id: str, create: bool = False) -> InventoryBalance | None:
    row = db.scalar(select(InventoryBalance).where(InventoryBalance.company_id == company_id, InventoryBalance.item_id == item_id, InventoryBalance.location_id == location_id).with_for_update())
    if not row and create:
        row = InventoryBalance(company_id=company_id, item_id=item_id, location_id=location_id, quantity_on_hand=Decimal('0'), reserved_quantity=Decimal('0'))
        db.add(row); db.flush()
    return row


def _movement_actor_names(db: Session, rows: list[InventoryMovement]) -> dict[str, str]:
    row_ids = {row.id for row in rows}
    company_ids = {row.company_id for row in rows}
    action_events = list(db.scalars(
        select(AuditEvent)
        .where(
            AuditEvent.company_id.in_(company_ids),
            AuditEvent.entity == 'inventory_movement',
            AuditEvent.entity_id.in_(row_ids),
            AuditEvent.event.in_(('inventory.movement_corrected', 'inventory.movement_reversed')),
        )
        .order_by(AuditEvent.created_at.desc())
    ).all()) if row_ids else []
    action_by_movement: dict[str, AuditEvent] = {}
    for event in action_events:
        action_by_movement.setdefault(event.entity_id, event)

    membership_ids = {row.created_by for row in rows if row.created_by}
    memberships = {
        membership.id: membership
        for membership in db.scalars(select(Membership).where(Membership.id.in_(membership_ids))).all()
    } if membership_ids else {}
    user_ids = {event.user_id for event in action_events if event.user_id}
    user_ids.update(
        membership.user_id
        for membership in memberships.values()
        if membership.user_id
    )
    users = {
        user.id: user.full_name
        for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    } if user_ids else {}

    result: dict[str, str] = {}
    for row in rows:
        action = action_by_movement.get(row.id)
        membership = memberships.get(row.created_by)
        user_id = action.user_id if action and action.user_id else membership.user_id if membership else None
        result[row.id] = users.get(user_id, 'System')
    return result


def _movement_summaries(db: Session, rows: list[InventoryMovement]) -> list[InventoryMovementSummary]:
    row_ids = {row.id for row in rows}
    reversal_rows = list(db.scalars(
        select(InventoryMovement).where(InventoryMovement.reversed_movement_id.in_(row_ids))
    ).all()) if row_ids else []
    correction_rows = list(db.scalars(
        select(InventoryMovement).where(InventoryMovement.correction_of_movement_id.in_(row_ids))
    ).all()) if row_ids else []
    reversed_ids = {row.reversed_movement_id for row in reversal_rows if row.reversed_movement_id}
    reversal_by_original = {row.reversed_movement_id: row for row in reversal_rows if row.reversed_movement_id}
    correction_by_original = {row.correction_of_movement_id: row for row in correction_rows if row.correction_of_movement_id}
    item_ids = {row.item_id for row in rows}
    location_ids = {location_id for row in rows for location_id in (row.source_location_id, row.destination_location_id) if location_id}
    project_ids = {row.project_id for row in rows if row.project_id}
    customer_ids = {row.customer_id for row in rows if row.customer_id}
    items = {row.id: row for row in db.scalars(select(InventoryItem).where(InventoryItem.id.in_(item_ids))).all()} if item_ids else {}
    locations = {row.id: row for row in db.scalars(select(InventoryLocation).where(InventoryLocation.id.in_(location_ids))).all()} if location_ids else {}
    projects = {row.id: row for row in db.scalars(select(CustomerProject).where(CustomerProject.id.in_(project_ids))).all()} if project_ids else {}
    customers = {row.id: row for row in db.scalars(select(AgentCustomer).where(AgentCustomer.id.in_(customer_ids))).all()} if customer_ids else {}
    actor_names = _movement_actor_names(db, rows)
    result = []
    for row in rows:
        result.append(InventoryMovementSummary(
            id=row.id,
            item_id=row.item_id,
            item_name=items[row.item_id].name if row.item_id in items else '',
            item_sku=items[row.item_id].sku if row.item_id in items else '',
            item_unit=items[row.item_id].unit if row.item_id in items else '',
            movement_type=row.movement_type,
            quantity=_f(row.quantity),
            source_location_id=row.source_location_id,
            source_location_name=locations[row.source_location_id].name if row.source_location_id in locations else '',
            source_location_manual=row.source_location_manual,
            destination_location_id=row.destination_location_id,
            destination_location_name=locations[row.destination_location_id].name if row.destination_location_id in locations else '',
            destination_location_manual=row.destination_location_manual,
            project_id=row.project_id,
            project_number=projects[row.project_id].project_number if row.project_id in projects else '',
            customer_id=row.customer_id,
            customer_name=customers[row.customer_id].customer_name if row.customer_id in customers else '',
            reference_number=row.reference_number,
            movement_group_id=row.movement_group_id,
            challan_date=row.challan_date,
            partner_name=row.supplier_name or row.transporter_name,
            transporter_name=row.transporter_name,
            vehicle_number=row.vehicle_number,
            driver_name=row.driver_name,
            driver_phone=row.driver_phone,
            eway_bill_number=row.eway_bill_number,
            note=row.note,
            status=row.status,
            reversed_movement_id=row.reversed_movement_id,
            correction_of_movement_id=row.correction_of_movement_id,
            reason=row.reason,
            actor_name=actor_names.get(row.id, 'System'),
            is_reversed=row.id in reversed_ids,
            corrected_quantity=_f(correction_by_original[row.id].quantity) if row.id in correction_by_original else None,
            related_movement_id=(
                correction_by_original[row.id].id if row.id in correction_by_original
                else reversal_by_original[row.id].id if row.id in reversal_by_original
                else row.correction_of_movement_id or row.reversed_movement_id
            ),
            created_at=row.created_at,
        ))
    return result


def _post_movement_row(
    db: Session,
    actor: CurrentSession,
    payload: CreateInventoryMovementRequest,
    *,
    movement_group_id: str | None = None,
) -> InventoryMovement:
    company_id = actor.membership.company_id
    item = db.scalar(select(InventoryItem).where(
        InventoryItem.id == payload.item_id,
        InventoryItem.company_id == company_id,
        InventoryItem.is_active.is_(True),
    ))
    if not item:
        raise OperationsNotFoundError('Inventory item not found')
    location_ids = {
        location_id
        for location_id in (payload.source_location_id, payload.destination_location_id)
        if location_id
    }
    if location_ids:
        valid_location_ids = set(db.scalars(
            select(InventoryLocation.id).where(
                InventoryLocation.id.in_(location_ids),
                InventoryLocation.company_id == company_id,
                InventoryLocation.is_active.is_(True),
            )
        ).all())
        if valid_location_ids != location_ids:
            raise OperationsNotFoundError('Inventory location not found')
    customer_id = payload.customer_id
    if payload.project_id:
        project = get_project(db, actor, payload.project_id)
        if customer_id and project.customer_id != customer_id:
            raise OperationsConflictError('The project does not belong to the selected customer')
        customer_id = project.customer_id
    elif customer_id:
        get_customer(db, actor, customer_id)
    if customer_id:
        try:
            reactivate_for_activity(db, actor, customer_id, source='inventory_movement')
        except CustomerLifecycleError as exc:
            raise OperationsConflictError(str(exc)) from exc
    qty = _d(payload.quantity)
    source = _balance(db, company_id, item.id, payload.source_location_id, False) if payload.source_location_id else None
    destination = _balance(db, company_id, item.id, payload.destination_location_id, True) if payload.destination_location_id else None
    if payload.movement_type in {'outward', 'project_dispatch', 'supplier_return', 'transfer'}:
        if not source or Decimal(source.quantity_on_hand) - Decimal(source.reserved_quantity) < qty:
            raise OperationsConflictError(f'Insufficient available inventory for {item.name} at the source location')
        source.quantity_on_hand = Decimal(source.quantity_on_hand) - qty
    if payload.movement_type in {'inward', 'project_return', 'transfer'}:
        if not destination:
            raise OperationsConflictError('Destination balance could not be created')
        destination.quantity_on_hand = Decimal(destination.quantity_on_hand) + qty
    if payload.movement_type == 'adjustment':
        target = source or destination
        if not target:
            raise OperationsConflictError('Adjustment location is required')
        target.quantity_on_hand = qty
    row = InventoryMovement(
        company_id=company_id,
        item_id=item.id,
        movement_type=payload.movement_type,
        quantity=qty,
        source_location_id=payload.source_location_id,
        destination_location_id=payload.destination_location_id,
        source_location_manual=payload.source_location_manual.strip(),
        destination_location_manual=payload.destination_location_manual.strip(),
        project_id=payload.project_id,
        customer_id=customer_id,
        challan_id=payload.challan_id,
        movement_group_id=movement_group_id,
        reference_number=payload.reference_number or f'MOV-{item.sku}-{uuid4().hex[:6].upper()}',
        challan_date=payload.challan_date,
        supplier_name=payload.supplier_name,
        transporter_name=payload.transporter_name,
        vehicle_number=payload.vehicle_number.upper().strip(),
        driver_name=payload.driver_name,
        driver_phone=payload.driver_phone,
        eway_bill_number=payload.eway_bill_number,
        note=payload.note,
        status='completed',
        created_by=actor.membership.id,
    )
    db.add(row)
    db.flush()
    write_event(
        db,
        company_id=company_id,
        event='inventory.movement_posted',
        entity='inventory_movement',
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={
            'item_id': row.item_id,
            'movement_type': row.movement_type,
            'quantity': str(row.quantity),
            'movement_group_id': movement_group_id,
            'challan_number': row.reference_number,
            'vehicle_number': row.vehicle_number,
        },
    )
    return row


def post_movement(db: Session, actor: CurrentSession, payload: CreateInventoryMovementRequest) -> InventoryMovementSummary:
    try:
        row = _post_movement_row(db, actor, payload)
        db.commit()
        return _movement_summaries(db, [row])[0]
    except Exception:
        db.rollback()
        raise


def post_movement_batch(
    db: Session,
    actor: CurrentSession,
    payload: CreateInventoryMovementBatchRequest,
) -> list[InventoryMovementSummary]:
    group_id = str(uuid4())
    reference_number = payload.reference_number.strip() or f'CH-{uuid4().hex[:8].upper()}'
    rows: list[InventoryMovement] = []
    try:
        for line in payload.lines:
            movement = CreateInventoryMovementRequest(
                item_id=line.item_id,
                movement_type=payload.movement_type,
                quantity=line.quantity,
                source_location_id=line.source_location_id,
                destination_location_id=line.destination_location_id,
                source_location_manual=line.source_location_manual,
                destination_location_manual=line.destination_location_manual,
                reference_number=reference_number,
                challan_date=payload.challan_date,
                supplier_name=payload.supplier_name,
                transporter_name=payload.transporter_name,
                vehicle_number=payload.vehicle_number,
                driver_name=payload.driver_name,
                driver_phone=payload.driver_phone,
                eway_bill_number=payload.eway_bill_number,
                note=payload.note,
            )
            rows.append(_post_movement_row(db, actor, movement, movement_group_id=group_id))
        db.commit()
        return _movement_summaries(db, rows)
    except Exception:
        db.rollback()
        raise


REVERSIBLE_MOVEMENT_TYPES = {
    'inward',
    'outward',
    'transfer',
    'project_dispatch',
    'project_return',
    'supplier_return',
}


def _load_movement_for_update(
    db: Session,
    actor: CurrentSession,
    movement_id: str,
) -> InventoryMovement:
    row = db.scalar(
        select(InventoryMovement)
        .where(
            InventoryMovement.id == movement_id,
            InventoryMovement.company_id == actor.membership.company_id,
            operational_reference_filter(
                actor.membership.company_id,
                customer_column=InventoryMovement.customer_id,
                project_column=InventoryMovement.project_id,
            ),
        )
        .with_for_update()
    )
    if not row:
        raise OperationsNotFoundError('Inventory movement not found')
    return row


def _assert_movement_reversible(db: Session, row: InventoryMovement) -> None:
    if row.status != 'completed':
        raise OperationsConflictError(f'Only completed movements can be changed; current status is {row.status}')
    if row.movement_type not in REVERSIBLE_MOVEMENT_TYPES:
        raise OperationsConflictError(
            'This movement type cannot be safely reversed automatically. '
            'Use a new inventory adjustment instead.'
        )
    existing = db.scalar(
        select(InventoryMovement.id).where(
            InventoryMovement.company_id == row.company_id,
            InventoryMovement.reversed_movement_id == row.id,
        ).limit(1)
    )
    if existing:
        raise OperationsConflictError('This inventory movement has already been reversed or corrected')


def _apply_inventory_effect(
    db: Session,
    row: InventoryMovement,
    quantity: Decimal,
    *,
    reverse: bool,
) -> None:
    source = _balance(db, row.company_id, row.item_id, row.source_location_id, False) if row.source_location_id else None
    destination = _balance(db, row.company_id, row.item_id, row.destination_location_id, False) if row.destination_location_id else None

    if row.movement_type in {'inward', 'project_return'}:
        if not destination:
            raise OperationsConflictError('Destination inventory balance is missing')
        if reverse:
            if Decimal(destination.quantity_on_hand) - quantity < Decimal(destination.reserved_quantity):
                raise OperationsConflictError('Reversal would reduce stock below the reserved quantity')
            destination.quantity_on_hand = Decimal(destination.quantity_on_hand) - quantity
        else:
            destination.quantity_on_hand = Decimal(destination.quantity_on_hand) + quantity
        return

    if row.movement_type in {'outward', 'project_dispatch', 'supplier_return'}:
        if not source:
            raise OperationsConflictError('Source inventory balance is missing')
        if reverse:
            source.quantity_on_hand = Decimal(source.quantity_on_hand) + quantity
        else:
            if Decimal(source.quantity_on_hand) - quantity < Decimal(source.reserved_quantity):
                raise OperationsConflictError('Insufficient available inventory for the corrected movement')
            source.quantity_on_hand = Decimal(source.quantity_on_hand) - quantity
        return


    if row.movement_type == 'transfer':
        if not source or not destination:
            raise OperationsConflictError('Transfer inventory balances are missing')
        if reverse:
            if Decimal(destination.quantity_on_hand) - quantity < Decimal(destination.reserved_quantity):
                raise OperationsConflictError('Transfer reversal would reduce destination stock below reserved quantity')
            destination.quantity_on_hand = Decimal(destination.quantity_on_hand) - quantity
            source.quantity_on_hand = Decimal(source.quantity_on_hand) + quantity
        else:
            if Decimal(source.quantity_on_hand) - quantity < Decimal(source.reserved_quantity):
                raise OperationsConflictError('Insufficient source stock for the corrected transfer')
            source.quantity_on_hand = Decimal(source.quantity_on_hand) - quantity
            destination.quantity_on_hand = Decimal(destination.quantity_on_hand) + quantity
        return

    raise OperationsConflictError('This inventory movement type cannot be recalculated safely')


def _copy_inventory_movement(
    original: InventoryMovement,
    actor: CurrentSession,
    *,
    movement_type: str,
    quantity: Decimal,
    status: str,
    reason: str,
    reversed_movement_id: str | None = None,
    correction_of_movement_id: str | None = None,
) -> InventoryMovement:
    prefix = 'REV' if reversed_movement_id else 'COR'
    reference = f'{prefix}-{original.reference_number}'[:80]
    return InventoryMovement(
        company_id=original.company_id,
        item_id=original.item_id,
        movement_type=movement_type,
        quantity=quantity,
        source_location_id=original.source_location_id,
        destination_location_id=original.destination_location_id,
        source_location_manual=original.source_location_manual,
        destination_location_manual=original.destination_location_manual,
        project_id=original.project_id,
        customer_id=original.customer_id,
        challan_id=original.challan_id,
        movement_group_id=original.movement_group_id,
        reference_number=reference,
        challan_date=original.challan_date,
        supplier_name=original.supplier_name,
        transporter_name=original.transporter_name,
        vehicle_number=original.vehicle_number,
        driver_name=original.driver_name,
        driver_phone=original.driver_phone,
        eway_bill_number=original.eway_bill_number,
        note=original.note,
        status=status,
        reversed_movement_id=reversed_movement_id,
        correction_of_movement_id=correction_of_movement_id,
        reason=reason,
        created_by=actor.membership.id,
    )


def reverse_inventory_movement(
    db: Session,
    actor: CurrentSession,
    movement_id: str,
    payload: InventoryMovementReversalRequest,
) -> InventoryMovementSummary:
    try:
        original = _load_movement_for_update(db, actor, movement_id)
        _assert_movement_reversible(db, original)
        quantity = Decimal(original.quantity)
        _apply_inventory_effect(db, original, quantity, reverse=True)
        reversal = _copy_inventory_movement(
            original,
            actor,
            movement_type='reversal',
            quantity=quantity,
            status='completed',
            reason=payload.reason,
            reversed_movement_id=original.id,
        )
        original.status = 'reversed'
        original.reason = payload.reason
        db.add(reversal)
        db.flush()
        write_event(
            db,
            company_id=original.company_id,
            event='inventory.movement_reversed',
            entity='inventory_movement',
            entity_id=original.id,
            actor=actor,
            project_id=original.project_id,
            customer_id=original.customer_id,
            changes={
                'quantity': str(original.quantity),
                'reversal_movement_id': reversal.id,
                'reason': payload.reason,
            },
        )
        db.commit()
        return _movement_summaries(db, [reversal])[0]
    except Exception:
        db.rollback()
        raise


def correct_inventory_movement(
    db: Session,
    actor: CurrentSession,
    movement_id: str,
    payload: InventoryMovementCorrectionRequest,
) -> InventoryMovementSummary:
    try:
        original = _load_movement_for_update(db, actor, movement_id)
        _assert_movement_reversible(db, original)
        original_quantity = Decimal(original.quantity)
        corrected_quantity = _d(payload.quantity)
        if corrected_quantity == original_quantity:
            raise OperationsConflictError('Corrected quantity is unchanged')

        # Append-only correction: first undo the finalized effect, then apply a
        # replacement movement. The original row is never silently rewritten.
        _apply_inventory_effect(db, original, original_quantity, reverse=True)
        reversal = _copy_inventory_movement(
            original,
            actor,
            movement_type='reversal',
            quantity=original_quantity,
            status='completed',
            reason=payload.reason,
            reversed_movement_id=original.id,
        )
        db.add(reversal)
        db.flush()

        _apply_inventory_effect(db, original, corrected_quantity, reverse=False)
        corrected = _copy_inventory_movement(
            original,
            actor,
            movement_type=original.movement_type,
            quantity=corrected_quantity,
            status='completed',
            reason=payload.reason,
            correction_of_movement_id=original.id,
        )
        original.status = 'corrected'
        original.reason = payload.reason
        db.add(corrected)
        db.flush()
        write_event(
            db,
            company_id=original.company_id,
            event='inventory.movement_corrected',
            entity='inventory_movement',
            entity_id=original.id,
            actor=actor,
            project_id=original.project_id,
            customer_id=original.customer_id,
            changes={
                'original_quantity': str(original_quantity),
                'corrected_quantity': str(corrected_quantity),
                'reversal_movement_id': reversal.id,
                'corrected_movement_id': corrected.id,
                'reason': payload.reason,
            },
        )
        db.commit()
        return _movement_summaries(db, [corrected])[0]
    except Exception:
        db.rollback()
        raise


def get_pricing(db: Session, actor: CurrentSession) -> PricingBookSummary:
    book=db.scalar(select(PricingBook).where(PricingBook.company_id==actor.membership.company_id,PricingBook.is_active.is_(True)).order_by(PricingBook.is_default.desc(),PricingBook.updated_at.desc()).limit(1))
    if not book:
        book=PricingBook(company_id=actor.membership.company_id,name='Master Price List',version=1,is_default=True,is_active=True,created_by=actor.membership.id,updated_by=actor.membership.id)
        db.add(book); db.commit(); db.refresh(book)
    rows=list(db.scalars(select(PricingItem).where(PricingItem.pricing_book_id==book.id).order_by(PricingItem.display_order,PricingItem.name)).all())
    return PricingBookSummary(id=book.id,name=book.name,version=book.version,is_default=book.is_default,is_active=book.is_active,updated_at=book.updated_at,items=[PricingItemInput(id=row.id,inventory_item_id=row.inventory_item_id,name=row.name,category=row.category,unit=row.unit,price=_f(row.price),quantity=_f(row.quantity),tax_rate=_f(row.tax_rate),calculation_type=row.calculation_type,calculation_value=_f(row.calculation_value),display_order=row.display_order,is_active=row.is_active) for row in rows])


def save_pricing(db: Session, actor: CurrentSession, payload: SavePricingBookRequest) -> PricingBookSummary:
    book=db.scalar(select(PricingBook).where(PricingBook.company_id==actor.membership.company_id,PricingBook.is_active.is_(True)).order_by(PricingBook.is_default.desc()).limit(1))
    if not book:
        book=PricingBook(company_id=actor.membership.company_id,name=payload.name,version=1,is_default=True,is_active=True,created_by=actor.membership.id,updated_by=actor.membership.id); db.add(book); db.flush()
    else:
        book.name=payload.name; book.version+=1; book.updated_by=actor.membership.id
        for row in db.scalars(select(PricingItem).where(PricingItem.pricing_book_id==book.id)).all(): db.delete(row)
        db.flush()
    for index,item in enumerate(payload.items):
        db.add(PricingItem(company_id=actor.membership.company_id,pricing_book_id=book.id,inventory_item_id=item.inventory_item_id,name=item.name,category=item.category,unit=item.unit,price=_d(item.price),quantity=_d(item.quantity),tax_rate=_d(item.tax_rate),calculation_type=item.calculation_type,calculation_value=_d(item.calculation_value),display_order=item.display_order if item.display_order else index,is_active=item.is_active))
    write_event(db,company_id=book.company_id,event='pricing.updated',entity='pricing_book',entity_id=book.id,actor=actor,changes={'version':book.version,'item_count':len(payload.items)})
    db.commit(); return get_pricing(db,actor)


def _poster_summary(row: Poster, file: StoredFile | None)->PosterSummary:
    return PosterSummary(id=row.id,version=row.version,title=row.title,description=row.description,file_id=row.file_id,file_name=file.name if file else '',mime_type=file.mime_type if file else '',category=row.category,status=row.status,created_at=row.created_at,updated_at=row.updated_at)


def list_posters(db: Session, actor: CurrentSession, status: str | None=None)->list[PosterSummary]:
    filters=[Poster.company_id==actor.membership.company_id]
    if status: filters.append(Poster.status==status)
    rows=list(db.scalars(select(Poster).where(*filters).order_by(Poster.created_at.desc()).limit(250)).all())
    file_ids={row.file_id for row in rows}
    files={row.id: row for row in db.scalars(select(StoredFile).where(StoredFile.id.in_(file_ids))).all()} if file_ids else {}
    return [_poster_summary(row,files.get(row.file_id)) for row in rows]


def create_poster(db: Session, actor: CurrentSession, payload: CreatePosterRequest)->PosterSummary:
    file=db.scalar(select(StoredFile).where(StoredFile.id==payload.file_id,StoredFile.company_id==actor.membership.company_id))
    if not file or file.owner_type != 'poster': raise OperationsNotFoundError('Poster file not found')
    if file.uploaded_by != actor.membership.id and not (actor.user.is_super_admin or 'posters.edit' in actor.permissions):
        raise OperationsConflictError('Use a poster file uploaded by your current session')
    if file.mime_type not in {'image/jpeg','image/png','image/webp','application/pdf'}: raise OperationsConflictError('Poster must be JPEG, PNG, WebP or PDF')
    row=Poster(company_id=actor.membership.company_id,title=payload.title,description=payload.description,file_id=file.id,category=payload.category,status='active',created_by=actor.membership.id)
    db.add(row); db.flush(); write_event(db,company_id=row.company_id,event='poster.uploaded',entity='poster',entity_id=row.id,actor=actor,changes={'title':row.title,'file_id':row.file_id}); db.commit(); return _poster_summary(row,file)


def set_poster_status(db: Session, actor: CurrentSession, poster_id: str, status: str)->PosterSummary:
    row=db.scalar(select(Poster).where(Poster.id==poster_id,Poster.company_id==actor.membership.company_id))
    if not row: raise OperationsNotFoundError('Poster not found')
    row.status=status; write_event(db,company_id=row.company_id,event='poster.status_changed',entity='poster',entity_id=row.id,actor=actor,changes={'status':status}); db.commit(); return _poster_summary(row,db.get(StoredFile,row.file_id))


def _default_document_template_settings(actor: CurrentSession, template_type: str) -> dict[str, str]:
    return {
        'company_name': DEFAULT_DOCUMENT_COMPANY_NAME, 'brand_name': DEFAULT_DOCUMENT_COMPANY_NAME, 'address': '', 'gstin': '',
        'phone': '', 'email': '', 'bank_details': '', 'quotation_notes': '',
        'agreement_wording': '', 'footer': '', 'terms': '',
    }


def _normalize_document_template_identity(settings: dict[str, object], actor: CurrentSession) -> dict[str, object]:
    normalized = dict(settings)
    legacy_default = actor.membership.company.name.strip()
    for key in ('company_name', 'brand_name'):
        value = normalized.get(key)
        if not isinstance(value, str) or not value.strip() or value.strip() == legacy_default:
            normalized[key] = DEFAULT_DOCUMENT_COMPANY_NAME
    return normalized


def get_template(db: Session, actor: CurrentSession, template_type: str)->DocumentTemplateSummary:
    row=db.scalar(select(DocumentTemplate).where(DocumentTemplate.company_id==actor.membership.company_id,DocumentTemplate.template_type==template_type))
    defaults = _default_document_template_settings(actor, template_type)
    if not row:
        row=DocumentTemplate(company_id=actor.membership.company_id,template_type=template_type,name='Company Document Template',settings_json=json.dumps(defaults),is_active=True,updated_by=actor.membership.id); db.add(row); db.commit(); db.refresh(row)
    try: settings=json.loads(row.settings_json or '{}')
    except json.JSONDecodeError: settings={}
    if not isinstance(settings, dict):
        settings = {}
    settings = _normalize_document_template_identity(settings, actor)
    return DocumentTemplateSummary(id=row.id,template_type=row.template_type,name=row.name,settings=settings,is_active=row.is_active,updated_at=row.updated_at)


def save_template(db: Session, actor: CurrentSession, template_type: str, payload: SaveDocumentTemplateRequest)->DocumentTemplateSummary:
    row=db.scalar(select(DocumentTemplate).where(DocumentTemplate.company_id==actor.membership.company_id,DocumentTemplate.template_type==template_type))
    if not row:
        row=DocumentTemplate(company_id=actor.membership.company_id,template_type=template_type,name=payload.name,settings_json='{}',is_active=True,updated_by=actor.membership.id); db.add(row)
    normalized_settings = _normalize_document_template_identity(payload.settings, actor)
    row.name=payload.name; row.settings_json=json.dumps(normalized_settings,separators=(',',':')); row.updated_by=actor.membership.id
    db.flush(); write_event(db,company_id=row.company_id,event='document_template.updated',entity='document_template',entity_id=row.id,actor=actor,changes={'template_type':template_type}); db.commit(); return get_template(db,actor,template_type)



def _json_dict(value: str) -> dict[str, object]:
    try:
        parsed = json.loads(value or '{}')
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _document_context(db: Session, actor: CurrentSession, customer_id: str) -> tuple[AgentCustomer, CustomerProject, CustomerQuotation]:
    try:
        customer = get_customer(db, actor, customer_id)
    except AccessError as exc:
        error = OperationsNotFoundError(str(exc)) if exc.status_code == 404 else OperationsServiceError(str(exc))
        error.status_code = exc.status_code
        raise error from exc
    project = db.scalar(
        select(CustomerProject)
        .where(
            CustomerProject.company_id == actor.membership.company_id,
            CustomerProject.customer_id == customer.id,
        )
        .order_by(CustomerProject.created_at.desc())
    )
    if not project:
        raise OperationsConflictError('Approve the quotation before generating customer documents')
    quotation = db.scalar(select(CustomerQuotation).where(
        CustomerQuotation.id == project.quotation_id,
        CustomerQuotation.company_id == actor.membership.company_id,
    ))
    if not quotation or quotation.status != 'approved':
        raise OperationsConflictError('Only an approved quotation can generate a customer document pack')
    return customer, project, quotation


def _document_pack_summary(row: GeneratedDocumentPack) -> GeneratedDocumentPackSummary:
    return GeneratedDocumentPackSummary(
        id=row.id, customer_id=row.customer_id, project_id=row.project_id, quotation_id=row.quotation_id,
        version=row.version, status=row.status, input_snapshot=_json_dict(row.input_snapshot_json),
        template_snapshot=_json_dict(row.template_snapshot_json), generated_at=row.generated_at,
        finalized_at=row.finalized_at, created_at=row.created_at, updated_at=row.updated_at,
    )


def list_document_packs(db: Session, actor: CurrentSession, customer_id: str) -> list[GeneratedDocumentPackSummary]:
    _, project, _ = _document_context(db, actor, customer_id)
    rows = list(db.scalars(
        select(GeneratedDocumentPack)
        .where(
            GeneratedDocumentPack.company_id == actor.membership.company_id,
            GeneratedDocumentPack.customer_id == customer_id,
        )
        .order_by(GeneratedDocumentPack.version.desc())
    ).all())
    target_status = (
        "approved" if any(row.status == "final" for row in rows)
        else "in_progress" if any(row.status == "generated" for row in rows)
        else None
    )
    if target_status and workflow_service.sync_documentation_progress(
        db, actor, project.id, target_status
    ):
        db.commit()
    return [_document_pack_summary(row) for row in rows]


def save_document_pack(
    db: Session, actor: CurrentSession, customer_id: str, payload: SaveGeneratedDocumentPackRequest
) -> GeneratedDocumentPackSummary:
    customer, project, quotation = _document_context(db, actor, customer_id)
    template = get_template(db, actor, 'customer_pack')
    latest = db.scalar(
        select(GeneratedDocumentPack)
        .where(
            GeneratedDocumentPack.company_id == actor.membership.company_id,
            GeneratedDocumentPack.customer_id == customer.id,
        )
        .order_by(GeneratedDocumentPack.version.desc())
    )
    create_new = latest is None or latest.status in {'generated', 'final'}
    if create_new:
        row = GeneratedDocumentPack(
            company_id=actor.membership.company_id, customer_id=customer.id, project_id=project.id,
            quotation_id=quotation.id, version=(latest.version + 1 if latest else 1), status='draft',
            created_by=actor.membership.id, updated_by=actor.membership.id,
        )
        db.add(row)
    else:
        row = latest
        row.project_id = project.id
        row.quotation_id = quotation.id
        row.updated_by = actor.membership.id
    if payload.status == "generated":
        db.flush()
        missing_documents = _required_customer_documents(db, row)
        if missing_documents:
            raise OperationsConflictError(
                f"Upload {' and '.join(missing_documents)} before generating the full document pack"
            )
    row.input_snapshot_json = json.dumps(payload.input_snapshot, separators=(',', ':'), default=str)
    row.template_snapshot_json = json.dumps(template.settings, separators=(',', ':'), default=str)
    row.status = payload.status
    row.generated_at = datetime.now(UTC) if payload.status == 'generated' else row.generated_at
    row.finalized_at = None
    db.flush()
    if payload.status == "generated":
        workflow_service.sync_documentation_progress(db, actor, project.id, "in_progress")
    write_event(
        db, company_id=row.company_id,
        event='document_pack.generated' if payload.status == 'generated' else 'document_pack.draft_saved',
        entity='generated_document_pack', entity_id=row.id, actor=actor, project_id=project.id, customer_id=customer.id,
        changes={'version': row.version, 'status': row.status},
    )
    db.commit()
    db.refresh(row)
    return _document_pack_summary(row)


def finalize_document_pack(db: Session, actor: CurrentSession, pack_id: str) -> GeneratedDocumentPackSummary:
    row = db.scalar(select(GeneratedDocumentPack).where(
        GeneratedDocumentPack.id == pack_id,
        GeneratedDocumentPack.company_id == actor.membership.company_id,
    ))
    if not row:
        raise OperationsNotFoundError('Document pack not found')
    _, project, _ = _document_context(db, actor, row.customer_id)
    if row.status != 'generated':
        raise OperationsConflictError('Generate the document pack before finalizing it')
    row.status = 'final'
    row.finalized_at = datetime.now(UTC)
    row.updated_by = actor.membership.id
    workflow_service.sync_documentation_progress(db, actor, project.id, "approved")
    write_event(
        db, company_id=row.company_id, event='document_pack.finalized', entity='generated_document_pack',
        entity_id=row.id, actor=actor, project_id=row.project_id, customer_id=row.customer_id,
        changes={'version': row.version, 'status': row.status},
    )
    db.commit()
    db.refresh(row)
    return _document_pack_summary(row)

def update_inventory_item(db: Session, actor: CurrentSession, item_id: str, payload):
    row = db.scalar(select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.company_id == actor.membership.company_id))
    if not row:
        raise OperationsNotFoundError('Inventory item not found')
    try:
        verify_version(row, payload.version)
    except RecordConflictError as exc:
        raise OperationsConflictError(str(exc)) from exc
    duplicate = db.scalar(select(InventoryItem).where(InventoryItem.company_id == row.company_id, InventoryItem.sku == payload.sku, InventoryItem.id != row.id))
    if duplicate:
        raise OperationsConflictError('SKU already exists')
    before = {key: getattr(row, key) for key in ('sku','name','category','unit','supplier_name','unit_cost','reorder_level','is_active')}
    for key in before:
        setattr(row, key, _d(getattr(payload,key)) if key in {'unit_cost','reorder_level'} else getattr(payload,key))
    row.version += 1
    changes = {key: {'old': before[key], 'new': getattr(row,key)} for key in before if before[key] != getattr(row,key)}
    write_event(db, company_id=row.company_id, event='inventory.item_updated', entity='inventory_item', entity_id=row.id, actor=actor, changes=changes)
    db.commit(); db.refresh(row)
    return _inventory_item_summary(db, row)


def update_inventory_location(db: Session, actor: CurrentSession, location_id: str, payload):
    row = db.scalar(select(InventoryLocation).where(InventoryLocation.id == location_id, InventoryLocation.company_id == actor.membership.company_id))
    if not row:
        raise OperationsNotFoundError('Inventory location not found')
    try:
        verify_version(row, payload.version)
    except RecordConflictError as exc:
        raise OperationsConflictError(str(exc)) from exc
    duplicate = db.scalar(select(InventoryLocation).where(InventoryLocation.company_id == row.company_id, InventoryLocation.name == payload.name, InventoryLocation.id != row.id))
    if duplicate:
        raise OperationsConflictError('Location name already exists')
    before = {key: getattr(row,key) for key in ('name','location_type','address','is_active')}
    for key in before: setattr(row,key,getattr(payload,key))
    row.version += 1
    changes = {key: {'old': before[key], 'new': getattr(row,key)} for key in before if before[key] != getattr(row,key)}
    write_event(db, company_id=row.company_id, event='inventory.location_updated', entity='inventory_location', entity_id=row.id, actor=actor, changes=changes)
    db.commit(); db.refresh(row)
    return _location_summary(row)


def update_poster(db: Session, actor: CurrentSession, poster_id: str, payload):
    row = db.scalar(select(Poster).where(Poster.id == poster_id, Poster.company_id == actor.membership.company_id))
    if not row:
        raise OperationsNotFoundError('Poster not found')
    try:
        verify_version(row, payload.version)
    except RecordConflictError as exc:
        raise OperationsConflictError(str(exc)) from exc
    before = {key: getattr(row,key) for key in ('title','description','category')}
    for key in before: setattr(row,key,getattr(payload,key))
    row.version += 1
    changes = {key: {'old': before[key], 'new': getattr(row,key)} for key in before if before[key] != getattr(row,key)}
    write_event(db, company_id=row.company_id, event='poster.updated', entity='poster', entity_id=row.id, actor=actor, changes=changes)
    db.commit(); db.refresh(row)
    return _poster_summary(row,db.get(StoredFile,row.file_id))
