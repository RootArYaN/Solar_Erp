from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.core.config import settings
from app.models.agent import AgentCustomer, AgentProfile
from app.models.finance import Bill
from app.models.operations import GeneratedDocumentPack, Poster
from app.models.system import StoredFile
from app.models.workflow import CustomerProject
from app.schemas.files import DocumentCustomerOption, StoredFileList, StoredFileSummary
from app.services.access_service import AccessError, get_customer, get_project, is_admin
from app.services.audit_service import write_event
from app.services.file_validation import (
    ALLOWED_EXTENSIONS,
    CUSTOMER_DOCUMENT_FILE_SUFFIXES,
    FileValidationError,
    accepted_mime_types,
    clean_name,
    declared_mime_type,
    typed_customer_document_name,
    validate_saved_content,
)
from app.services.storage import StorageError, storage


class FileServiceError(Exception):
    status_code = 400


class FileNotFoundError(FileServiceError):
    status_code = 404


class FileForbiddenError(FileServiceError):
    status_code = 403


def ensure_file_permission(actor: CurrentSession, owner_type: str, action: str) -> None:
    if actor.user.is_super_admin:
        return
    if owner_type == "finance_bill":
        allowed = {
            "view": {"finance.view", "finance.manage"},
            "create": {"finance.manage"},
            "edit": {"finance.manage"},
        }.get(action, set())
        if not allowed.intersection(actor.permissions):
            raise FileForbiddenError(f"You do not have permission to {action} this bill attachment")
        return
    is_poster = owner_type == "poster"
    allowed = {
        (True, "view"): {"posters.view", "posters.edit"},
        (True, "create"): {"posters.create"},
        (True, "edit"): {"posters.edit"},
        (False, "view"): {"documents.view", "documents.manage"},
        (False, "create"): {"documents.create", "documents.manage"},
        (False, "edit"): {"documents.edit", "documents.manage"},
    }.get((is_poster, action), set())
    if not allowed.intersection(actor.permissions):
        label = "poster" if is_poster else "document"
        raise FileForbiddenError(f"You do not have permission to {action} this {label}")


def _summary(row: StoredFile) -> StoredFileSummary:
    return StoredFileSummary(
        id=row.id,
        owner_type=row.owner_type,
        owner_id=row.owner_id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        name=row.name,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        checksum=row.checksum,
        created_at=row.created_at,
    )


def _best_effort_storage_delete(relative_path: str) -> None:
    try:
        storage.delete(relative_path)
    except StorageError:
        pass


def _customer_filter(actor: CurrentSession):
    if is_admin(actor) or "agents.view_all" in actor.permissions or "agents.manage" in actor.permissions:
        return AgentCustomer.company_id == actor.membership.company_id
    if actor.role == "customer":
        return AgentCustomer.customer_membership_id == actor.membership.id
    return AgentCustomer.agent_profile_id.in_(
        select(AgentProfile.id).where(
            AgentProfile.company_id == actor.membership.company_id,
            AgentProfile.membership_id == actor.membership.id,
        )
    )


def list_document_customers(db: Session, actor: CurrentSession) -> list[DocumentCustomerOption]:
    customers = list(db.scalars(
        select(AgentCustomer)
        .where(
            AgentCustomer.company_id == actor.membership.company_id,
            _customer_filter(actor),
        )
        .order_by(AgentCustomer.customer_name.asc())
    ).all())
    if not customers:
        return []
    projects = list(db.scalars(
        select(CustomerProject)
        .where(
            CustomerProject.company_id == actor.membership.company_id,
            CustomerProject.customer_id.in_([row.id for row in customers]),
        )
        .order_by(CustomerProject.created_at.desc())
    ).all())
    latest_project: dict[str, CustomerProject] = {}
    for project in projects:
        latest_project.setdefault(project.customer_id, project)
    return [
        DocumentCustomerOption(
            id=row.id,
            customer_name=row.customer_name,
            project_id=latest_project[row.id].id if row.id in latest_project else None,
            project_number=latest_project[row.id].project_number if row.id in latest_project else None,
            project_status=latest_project[row.id].status if row.id in latest_project else None,
        )
        for row in customers
    ]


def validate_file_owner(
    db: Session,
    actor: CurrentSession,
    *,
    owner_type: str,
    owner_id: str,
    project_id: str | None,
    customer_id: str | None,
) -> tuple[str | None, str | None]:
    if owner_type == "poster":
        if owner_id != actor.membership.company_id or project_id or customer_id:
            raise FileForbiddenError("Poster files must belong to the current company library")
        return None, None

    if owner_type == "finance_bill":
        bill = db.scalar(select(Bill).where(
            Bill.id == owner_id,
            Bill.company_id == actor.membership.company_id,
        ))
        if not bill:
            raise FileNotFoundError("Bill not found")
        if project_id and project_id != bill.project_id:
            raise FileServiceError("The attachment project does not match the bill")
        if customer_id and customer_id != bill.customer_id:
            raise FileServiceError("The attachment customer does not match the bill")
        return bill.project_id, bill.customer_id

    if owner_type == "customer_document" or owner_type.startswith("customer_document:"):
        if owner_type.startswith("customer_document:") and owner_type.partition(":")[2] not in CUSTOMER_DOCUMENT_FILE_SUFFIXES:
            raise FileServiceError("Unknown customer document type")
        if not customer_id or owner_id != customer_id:
            raise FileServiceError("Customer documents require a matching customer owner")
        if project_id:
            project = get_project(db, actor, project_id)
            if project.customer_id != customer_id:
                raise FileServiceError("The project does not belong to the selected customer")
        else:
            get_customer(db, actor, customer_id)
        return project_id, customer_id

    if owner_type == "generated_document_pack":
        pack = db.scalar(select(GeneratedDocumentPack).where(
            GeneratedDocumentPack.id == owner_id,
            GeneratedDocumentPack.company_id == actor.membership.company_id,
        ))
        if not pack:
            raise FileNotFoundError("Document pack not found")
        get_customer(db, actor, pack.customer_id)
        if customer_id and customer_id != pack.customer_id:
            raise FileServiceError("The document pack does not belong to the selected customer")
        if project_id and project_id != pack.project_id:
            raise FileServiceError("The document pack does not belong to the selected project")
        return pack.project_id, pack.customer_id

    raise FileServiceError("Unsupported file owner type")


def save_file(
    db: Session,
    actor: CurrentSession,
    upload: UploadFile,
    *,
    owner_type: str,
    owner_id: str,
    project_id: str | None,
    customer_id: str | None,
) -> StoredFileSummary:
    ensure_file_permission(actor, owner_type, "create")
    project_id, customer_id = validate_file_owner(
        db, actor, owner_type=owner_type, owner_id=owner_id, project_id=project_id, customer_id=customer_id
    )

    try:
        name = clean_name(upload.filename or "document")
    except FileValidationError as exc:
        raise FileServiceError(str(exc)) from exc
    extension = Path(name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise FileServiceError("This file type is not allowed")

    declared_mime = declared_mime_type(name, upload.content_type)
    accepted_mimes = accepted_mime_types(extension)
    if declared_mime and declared_mime not in accepted_mimes:
        raise FileServiceError("The file MIME type does not match its extension")
    name = typed_customer_document_name(name, owner_type)

    relative = f"active/{actor.membership.company_id}/{uuid4().hex}{extension}"
    try:
        with storage.prepare_upload(upload, settings.max_upload_bytes) as candidate:
            if candidate.size_bytes <= 0:
                raise FileServiceError("Empty files are not allowed")
            detected_mime = validate_saved_content(candidate.path, extension)
            storage.scan_path(candidate.path)
            storage.put_file(
                candidate.path,
                relative,
                content_type=detected_mime,
                checksum=candidate.checksum,
            )
            size_bytes = candidate.size_bytes
            checksum = candidate.checksum
    except (StorageError, FileServiceError, FileValidationError) as exc:
        _best_effort_storage_delete(relative)
        if isinstance(exc, FileServiceError):
            raise
        raise FileServiceError(str(exc)) from exc

    row = StoredFile(
        company_id=actor.membership.company_id,
        owner_type=owner_type[:40],
        owner_id=owner_id[:80],
        project_id=project_id,
        customer_id=customer_id,
        name=name,
        storage_path=relative,
        mime_type=detected_mime,
        size_bytes=size_bytes,
        checksum=checksum,
        uploaded_by=actor.membership.id,
    )
    replaced_file: StoredFile | None = None
    replaced_storage_path: str | None = None
    try:
        db.add(row)
        db.flush()
        if owner_type == "finance_bill":
            bill = db.scalar(select(Bill).where(
                Bill.id == owner_id,
                Bill.company_id == row.company_id,
            ))
            if not bill:
                raise FileNotFoundError("Bill not found")
            if bill.file_id:
                replaced_file = db.scalar(select(StoredFile).where(
                    StoredFile.id == bill.file_id,
                    StoredFile.company_id == row.company_id,
                    StoredFile.owner_type == "finance_bill",
                    StoredFile.owner_id == owner_id,
                ))
            bill.file_id = row.id
            db.flush()
            if replaced_file:
                replaced_storage_path = replaced_file.storage_path
                db.delete(replaced_file)
        write_event(
            db,
            company_id=row.company_id,
            event=("bill.attachment_replaced" if replaced_file else "bill.attachment_uploaded") if owner_type == "finance_bill" else "document.uploaded",
            entity="stored_file",
            entity_id=row.id,
            actor=actor,
            project_id=row.project_id,
            customer_id=row.customer_id,
            changes={
                "name": row.name,
                "size_bytes": row.size_bytes,
                "owner_type": row.owner_type,
                "checksum": row.checksum,
                "replaced_file_id": replaced_file.id if replaced_file else None,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        _best_effort_storage_delete(relative)
        raise
    if replaced_storage_path:
        _best_effort_storage_delete(replaced_storage_path)
    return _summary(row)


def list_files(
    db: Session,
    actor: CurrentSession,
    *,
    owner_type: str | None,
    owner_id: str | None,
    project_id: str | None,
    customer_id: str | None,
    page: int,
    page_size: int,
) -> StoredFileList:
    ensure_file_permission(actor, owner_type or "document", "view")
    if project_id:
        get_project(db, actor, project_id)
    if customer_id:
        get_customer(db, actor, customer_id)

    filters = [StoredFile.company_id == actor.membership.company_id]
    if owner_type:
        if owner_type == "customer_document":
            filters.append(or_(
                StoredFile.owner_type == owner_type,
                StoredFile.owner_type.like("customer_document:%"),
            ))
        else:
            filters.append(StoredFile.owner_type == owner_type)
    if owner_id:
        filters.append(StoredFile.owner_id == owner_id)
    if project_id:
        filters.append(StoredFile.project_id == project_id)
    if customer_id:
        filters.append(StoredFile.customer_id == customer_id)

    if owner_type != "finance_bill" and not is_admin(actor) and "agents.view_all" not in actor.permissions and "agents.manage" not in actor.permissions:
        customer_ids = select(AgentCustomer.id).where(
            AgentCustomer.company_id == actor.membership.company_id,
            _customer_filter(actor),
        )
        filters.append(or_(
            StoredFile.customer_id.in_(customer_ids),
            StoredFile.uploaded_by == actor.membership.id,
        ))

    total = db.scalar(select(func.count()).select_from(StoredFile).where(*filters)) or 0
    rows = list(db.scalars(
        select(StoredFile)
        .where(*filters)
        .order_by(StoredFile.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())
    return StoredFileList(data=[_summary(row) for row in rows], page=page, page_size=page_size, total=total)


def get_file(db: Session, actor: CurrentSession, file_id: str) -> StoredFile:
    row = db.scalar(select(StoredFile).where(
        StoredFile.id == file_id,
        StoredFile.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FileNotFoundError("File not found")
    try:
        if row.owner_type == "finance_bill":
            bill = db.scalar(select(Bill).where(
                Bill.id == row.owner_id,
                Bill.company_id == actor.membership.company_id,
                Bill.file_id == row.id,
            ))
            if not bill:
                raise FileNotFoundError("Bill attachment not found")
        elif row.project_id:
            get_project(db, actor, row.project_id)
        elif row.customer_id:
            get_customer(db, actor, row.customer_id)
        elif row.owner_type == "poster":
            pass
        elif not is_admin(actor) and row.uploaded_by != actor.membership.id:
            raise FileForbiddenError("You can only access files assigned to you")
    except AccessError as exc:
        raise FileForbiddenError(str(exc)) from exc
    return row


def delete_file(db: Session, actor: CurrentSession, file_id: str) -> None:
    row = db.scalar(select(StoredFile).where(
        StoredFile.id == file_id,
        StoredFile.company_id == actor.membership.company_id,
    ))
    if not row:
        return
    can_remove_own_unlinked_poster = (
        row.owner_type == "poster"
        and row.uploaded_by == actor.membership.id
        and "posters.create" in actor.permissions
        and not db.scalar(select(Poster.id).where(
            Poster.company_id == row.company_id,
            or_(Poster.file_id == row.id, Poster.thumbnail_file_id == row.id),
        ).limit(1))
    )
    if not can_remove_own_unlinked_poster:
        ensure_file_permission(actor, row.owner_type, "edit")
    # Apply the same resource-level authorization as download and view.
    row = get_file(db, actor, file_id)
    staged = storage.stage_delete(row.storage_path)
    try:
        posters = list(db.scalars(select(Poster).where(
            Poster.company_id == row.company_id,
            or_(Poster.file_id == row.id, Poster.thumbnail_file_id == row.id),
        )).all())
        for poster in posters:
            if poster.file_id == row.id:
                write_event(
                    db,
                    company_id=row.company_id,
                    event="poster.deleted",
                    entity="poster",
                    entity_id=poster.id,
                    actor=actor,
                    changes={"title": poster.title, "file_id": row.id},
                )
                db.delete(poster)
            else:
                poster.thumbnail_file_id = None

        if row.owner_type == "finance_bill":
            bill = db.scalar(select(Bill).where(
                Bill.id == row.owner_id,
                Bill.company_id == row.company_id,
                Bill.file_id == row.id,
            ))
            if bill:
                bill.file_id = None

        write_event(
            db,
            company_id=row.company_id,
            event="poster.file_deleted" if row.owner_type == "poster" else ("bill.attachment_deleted" if row.owner_type == "finance_bill" else "document.deleted"),
            entity="stored_file",
            entity_id=row.id,
            actor=actor,
            project_id=row.project_id,
            customer_id=row.customer_id,
            changes={
                "name": row.name,
                "owner_type": row.owner_type,
                "owner_id": row.owner_id,
                "checksum": row.checksum,
                "size_bytes": row.size_bytes,
            },
        )
        db.delete(row)
        db.commit()
    except Exception:
        db.rollback()
        if staged:
            storage.restore_staged_delete(staged, row.storage_path)
        raise
    if staged:
        storage.finalize_staged_delete(staged)
