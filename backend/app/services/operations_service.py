from __future__ import annotations

import json
from uuid import uuid4
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.core.concurrency import RecordConflictError, verify_version
from app.models.agent import AgentCustomer
from app.models.operations import (
    DocumentTemplate,
    InventoryBalance,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    Poster,
    PricingBook,
    PricingItem,
)
from app.models.system import StoredFile
from app.models.workflow import CustomerProject
from app.schemas.operations import (
    CreateInventoryItemRequest,
    CreateInventoryLocationRequest,
    CreateInventoryMovementRequest,
    CreatePosterRequest,
    DocumentTemplateSummary,
    InventoryItemSummary,
    InventoryLocationSummary,
    InventoryMovementSummary,
    InventorySummary,
    PosterSummary,
    PricingBookSummary,
    PricingItemInput,
    SaveDocumentTemplateRequest,
    SavePricingBookRequest,
)
from app.services.access_service import get_customer, get_project
from app.services.audit_service import write_event


class OperationsServiceError(Exception):
    status_code = 400


class OperationsNotFoundError(OperationsServiceError):
    status_code = 404


class OperationsConflictError(OperationsServiceError):
    status_code = 409


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def _f(value) -> float:
    return float(Decimal(value or 0))


def _location_summary(row: InventoryLocation) -> InventoryLocationSummary:
    return InventoryLocationSummary(id=row.id, version=row.version, name=row.name, location_type=row.location_type, address=row.address, is_active=row.is_active)


def _inventory_maps(db: Session, company_id: str):
    items = list(db.scalars(select(InventoryItem).where(InventoryItem.company_id == company_id, InventoryItem.is_active.is_(True)).order_by(InventoryItem.category, InventoryItem.name)).all())
    locations = list(db.scalars(select(InventoryLocation).where(InventoryLocation.company_id == company_id, InventoryLocation.is_active.is_(True)).order_by(InventoryLocation.name)).all())
    balances = list(db.scalars(select(InventoryBalance).where(InventoryBalance.company_id == company_id)).all())
    return items, locations, balances


def _available_by_item(balances: list[InventoryBalance]) -> dict[str, Decimal]:
    available: dict[str, Decimal] = {}
    for balance in balances:
        available[balance.item_id] = available.get(balance.item_id, Decimal('0')) + (
            Decimal(balance.quantity_on_hand or 0) - Decimal(balance.reserved_quantity or 0)
        )
    return available


def low_stock_item_count(db: Session, company_id: str) -> int:
    items, _, balances = _inventory_maps(db, company_id)
    available = _available_by_item(balances)
    return sum(
        available.get(item.id, Decimal('0')) <= Decimal(item.reorder_level or 0)
        for item in items
    )


def inventory_summary(db: Session, actor: CurrentSession) -> InventorySummary:
    company_id = actor.membership.company_id
    items, locations, balances = _inventory_maps(db, company_id)
    location_by_id = {row.id: row for row in locations}
    balance_by_item: dict[str, list[InventoryBalance]] = {}
    for balance in balances:
        balance_by_item.setdefault(balance.item_id, []).append(balance)
    item_summaries: list[InventoryItemSummary] = []
    stock_value = Decimal('0')
    total_quantity = Decimal('0')
    low_stock = 0
    for item in items:
        item_balances = balance_by_item.get(item.id, [])
        on_hand = sum((Decimal(row.quantity_on_hand or 0) for row in item_balances), Decimal('0'))
        reserved = sum((Decimal(row.reserved_quantity or 0) for row in item_balances), Decimal('0'))
        available = on_hand - reserved
        primary = max(item_balances, key=lambda row: row.quantity_on_hand, default=None)
        is_low = available <= Decimal(item.reorder_level or 0)
        low_stock += int(is_low)
        stock_value += on_hand * Decimal(item.unit_cost or 0)
        total_quantity += on_hand
        item_summaries.append(InventoryItemSummary(
            id=item.id, version=item.version, sku=item.sku, name=item.name, category=item.category, unit=item.unit,
            supplier_name=item.supplier_name, unit_cost=_f(item.unit_cost), reorder_level=_f(item.reorder_level),
            quantity_on_hand=_f(on_hand), reserved_quantity=_f(reserved), available_quantity=_f(available),
            location_id=primary.location_id if primary else None,
            location_name=location_by_id[primary.location_id].name if primary and primary.location_id in location_by_id else '',
            low_stock=is_low, is_active=item.is_active, updated_at=item.updated_at,
        ))
    movement_rows = list(db.scalars(select(InventoryMovement).where(InventoryMovement.company_id == company_id).order_by(InventoryMovement.created_at.desc()).limit(60)).all())
    movement_summaries = _movement_summaries(db, movement_rows)
    return InventorySummary(items=item_summaries, locations=[_location_summary(row) for row in locations], movements=movement_summaries, total_items=len(items), low_stock_items=low_stock, stock_value=_f(stock_value), total_quantity=_f(total_quantity))


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
    return next(item for item in inventory_summary(db, actor).items if item.id == row.id)


def _balance(db: Session, company_id: str, item_id: str, location_id: str, create: bool = False) -> InventoryBalance | None:
    row = db.scalar(select(InventoryBalance).where(InventoryBalance.company_id == company_id, InventoryBalance.item_id == item_id, InventoryBalance.location_id == location_id).with_for_update())
    if not row and create:
        row = InventoryBalance(company_id=company_id, item_id=item_id, location_id=location_id, quantity_on_hand=Decimal('0'), reserved_quantity=Decimal('0'))
        db.add(row); db.flush()
    return row


def _movement_summaries(db: Session, rows: list[InventoryMovement]) -> list[InventoryMovementSummary]:
    item_ids = {row.item_id for row in rows}; location_ids = {i for row in rows for i in (row.source_location_id, row.destination_location_id) if i}; project_ids = {row.project_id for row in rows if row.project_id}; customer_ids = {row.customer_id for row in rows if row.customer_id}
    items = {row.id: row for row in db.scalars(select(InventoryItem).where(InventoryItem.id.in_(item_ids))).all()} if item_ids else {}
    locations = {row.id: row for row in db.scalars(select(InventoryLocation).where(InventoryLocation.id.in_(location_ids))).all()} if location_ids else {}
    projects = {row.id: row for row in db.scalars(select(CustomerProject).where(CustomerProject.id.in_(project_ids))).all()} if project_ids else {}
    customers = {row.id: row for row in db.scalars(select(AgentCustomer).where(AgentCustomer.id.in_(customer_ids))).all()} if customer_ids else {}
    result=[]
    for row in rows:
        result.append(InventoryMovementSummary(id=row.id,item_id=row.item_id,item_name=items[row.item_id].name if row.item_id in items else '',movement_type=row.movement_type,quantity=_f(row.quantity),source_location_id=row.source_location_id,source_location_name=locations[row.source_location_id].name if row.source_location_id in locations else '',destination_location_id=row.destination_location_id,destination_location_name=locations[row.destination_location_id].name if row.destination_location_id in locations else '',project_id=row.project_id,project_number=projects[row.project_id].project_number if row.project_id in projects else '',customer_id=row.customer_id,customer_name=customers[row.customer_id].customer_name if row.customer_id in customers else '',reference_number=row.reference_number,partner_name=row.supplier_name or row.transporter_name,note=row.note,status=row.status,created_at=row.created_at))
    return result


def post_movement(db: Session, actor: CurrentSession, payload: CreateInventoryMovementRequest) -> InventoryMovementSummary:
    company_id=actor.membership.company_id
    item=db.scalar(select(InventoryItem).where(InventoryItem.id==payload.item_id,InventoryItem.company_id==company_id,InventoryItem.is_active.is_(True)))
    if not item: raise OperationsNotFoundError('Inventory item not found')
    for location_id in [payload.source_location_id,payload.destination_location_id]:
        if location_id and not db.scalar(select(InventoryLocation.id).where(InventoryLocation.id==location_id,InventoryLocation.company_id==company_id,InventoryLocation.is_active.is_(True))): raise OperationsNotFoundError('Inventory location not found')
    if payload.project_id:
        project=get_project(db,actor,payload.project_id)
        if payload.customer_id and project.customer_id!=payload.customer_id: raise OperationsConflictError('The project does not belong to the selected customer')
        payload.customer_id=project.customer_id
    elif payload.customer_id: get_customer(db,actor,payload.customer_id)
    qty=_d(payload.quantity)
    source=_balance(db,company_id,item.id,payload.source_location_id,False) if payload.source_location_id else None
    destination=_balance(db,company_id,item.id,payload.destination_location_id,True) if payload.destination_location_id else None
    if payload.movement_type in {'outward','project_dispatch','supplier_return','transfer'}:
        if not source or Decimal(source.quantity_on_hand)-Decimal(source.reserved_quantity)<qty: raise OperationsConflictError('Insufficient available inventory at the source location')
        source.quantity_on_hand=Decimal(source.quantity_on_hand)-qty
    if payload.movement_type in {'inward','project_return','transfer'}:
        if not destination: raise OperationsConflictError('Destination balance could not be created')
        destination.quantity_on_hand=Decimal(destination.quantity_on_hand)+qty
    if payload.movement_type=='adjustment':
        target=source or destination
        if not target: raise OperationsConflictError('Adjustment location is required')
        target.quantity_on_hand=qty
    row=InventoryMovement(company_id=company_id,item_id=item.id,movement_type=payload.movement_type,quantity=qty,source_location_id=payload.source_location_id,destination_location_id=payload.destination_location_id,project_id=payload.project_id,customer_id=payload.customer_id,challan_id=payload.challan_id,reference_number=payload.reference_number or f'MOV-{item.sku}-{uuid4().hex[:6].upper()}',supplier_name=payload.supplier_name,transporter_name=payload.transporter_name,note=payload.note,status='completed',created_by=actor.membership.id)
    db.add(row); db.flush()
    write_event(db,company_id=company_id,event='inventory.movement_posted',entity='inventory_movement',entity_id=row.id,actor=actor,project_id=row.project_id,customer_id=row.customer_id,changes={'item_id':row.item_id,'movement_type':row.movement_type,'quantity':str(row.quantity)})
    db.commit(); return _movement_summaries(db,[row])[0]


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


def _poster_summary(db: Session,row: Poster)->PosterSummary:
    file=db.get(StoredFile,row.file_id)
    return PosterSummary(id=row.id,version=row.version,title=row.title,description=row.description,file_id=row.file_id,file_name=file.name if file else '',mime_type=file.mime_type if file else '',category=row.category,status=row.status,created_at=row.created_at,updated_at=row.updated_at)


def list_posters(db: Session, actor: CurrentSession, status: str | None=None)->list[PosterSummary]:
    filters=[Poster.company_id==actor.membership.company_id]
    if status: filters.append(Poster.status==status)
    rows=list(db.scalars(select(Poster).where(*filters).order_by(Poster.created_at.desc())).all())
    return [_poster_summary(db,row) for row in rows]


def create_poster(db: Session, actor: CurrentSession, payload: CreatePosterRequest)->PosterSummary:
    file=db.scalar(select(StoredFile).where(StoredFile.id==payload.file_id,StoredFile.company_id==actor.membership.company_id,StoredFile.status=='active'))
    if not file: raise OperationsNotFoundError('Poster file not found')
    if file.mime_type not in {'image/jpeg','image/png','image/webp','application/pdf'}: raise OperationsConflictError('Poster must be JPEG, PNG, WebP or PDF')
    row=Poster(company_id=actor.membership.company_id,title=payload.title,description=payload.description,file_id=file.id,category=payload.category,status='active',created_by=actor.membership.id)
    db.add(row); db.flush(); write_event(db,company_id=row.company_id,event='poster.uploaded',entity='poster',entity_id=row.id,actor=actor,changes={'title':row.title,'file_id':row.file_id}); db.commit(); return _poster_summary(db,row)


def set_poster_status(db: Session, actor: CurrentSession, poster_id: str, status: str)->PosterSummary:
    row=db.scalar(select(Poster).where(Poster.id==poster_id,Poster.company_id==actor.membership.company_id))
    if not row: raise OperationsNotFoundError('Poster not found')
    row.status=status; write_event(db,company_id=row.company_id,event='poster.status_changed',entity='poster',entity_id=row.id,actor=actor,changes={'status':status}); db.commit(); return _poster_summary(db,row)


def get_template(db: Session, actor: CurrentSession, template_type: str)->DocumentTemplateSummary:
    row=db.scalar(select(DocumentTemplate).where(DocumentTemplate.company_id==actor.membership.company_id,DocumentTemplate.template_type==template_type))
    if not row:
        settings={'company_name':actor.membership.company.name,'brand_name':actor.membership.company.name,'address':'','gstin':'','phone':'','email':'','bank_details':'','quotation_notes':'','agreement_wording':'','footer':'','terms':''}
        row=DocumentTemplate(company_id=actor.membership.company_id,template_type=template_type,name='Company Document Template',settings_json=json.dumps(settings),is_active=True,updated_by=actor.membership.id); db.add(row); db.commit(); db.refresh(row)
    try: settings=json.loads(row.settings_json or '{}')
    except json.JSONDecodeError: settings={}
    return DocumentTemplateSummary(id=row.id,template_type=row.template_type,name=row.name,settings=settings if isinstance(settings,dict) else {},is_active=row.is_active,updated_at=row.updated_at)


def save_template(db: Session, actor: CurrentSession, template_type: str, payload: SaveDocumentTemplateRequest)->DocumentTemplateSummary:
    row=db.scalar(select(DocumentTemplate).where(DocumentTemplate.company_id==actor.membership.company_id,DocumentTemplate.template_type==template_type))
    if not row:
        row=DocumentTemplate(company_id=actor.membership.company_id,template_type=template_type,name=payload.name,settings_json='{}',is_active=True,updated_by=actor.membership.id); db.add(row)
    row.name=payload.name; row.settings_json=json.dumps(payload.settings,separators=(',',':')); row.updated_by=actor.membership.id
    db.flush(); write_event(db,company_id=row.company_id,event='document_template.updated',entity='document_template',entity_id=row.id,actor=actor,changes={'template_type':template_type}); db.commit(); return get_template(db,actor,template_type)


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
    summary = inventory_summary(db, actor)
    return next(item for item in summary.items if item.id == row.id)


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
    return _poster_summary(db,row)
