from __future__ import annotations

import mimetypes
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.core.config import settings
from app.models.agent import AgentCustomer, AgentProfile
from app.models.system import StoredFile
from app.models.workflow import CustomerProject
from app.schemas.files import DocumentCustomerOption, StoredFileList, StoredFileSummary
from app.services.access_service import AccessError, get_customer, get_project, is_admin
from app.services.audit_service import write_event
from app.services.storage import StorageError, storage

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".csv", ".json", ".txt", ".docx", ".xlsx"}
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "application/json",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class FileServiceError(Exception):
    status_code = 400


class FileNotFoundError(FileServiceError):
    status_code = 404


class FileForbiddenError(FileServiceError):
    status_code = 403


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
        status=row.status,
        created_at=row.created_at,
        archived_at=row.archived_at,
    )


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
            AgentCustomer.archived_at.is_(None),
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
            CustomerProject.archived_at.is_(None),
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


def _clean_name(value: str) -> str:
    name = Path(value or "document").name.replace("\x00", "").strip()
    return name[:240] or "document"


def _signature_mime(header: bytes, extension: str) -> str | None:
    if header.startswith(b"%PDF-"):
        return "application/pdf"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp"
    if header.startswith(b"PK\x03\x04") and extension in {".docx", ".xlsx"}:
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document" if extension == ".docx" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if extension in {".csv", ".json", ".txt"}:
        return {".csv": "text/csv", ".json": "application/json", ".txt": "text/plain"}[extension]
    return None


async def save_file(
    db: Session,
    actor: CurrentSession,
    upload: UploadFile,
    *,
    owner_type: str,
    owner_id: str,
    project_id: str | None,
    customer_id: str | None,
) -> StoredFileSummary:
    if project_id:
        project = get_project(db, actor, project_id)
        customer_id = project.customer_id
    elif customer_id:
        get_customer(db, actor, customer_id)

    name = _clean_name(upload.filename or "document")
    extension = Path(name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise FileServiceError("This file type is not allowed")

    header = await upload.read(32)
    await upload.seek(0)
    detected_mime = _signature_mime(header, extension)
    declared_mime = (upload.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream").lower()
    if not detected_mime or detected_mime not in ALLOWED_MIME:
        raise FileServiceError("The file content does not match an allowed document type")
    if declared_mime not in ALLOWED_MIME and not declared_mime.startswith("text/"):
        raise FileServiceError("The file MIME type is not allowed")

    relative = f"active/{actor.membership.company_id}/{uuid4().hex}{extension}"
    try:
        size_bytes, checksum = await storage.save_upload(upload, relative, settings.max_upload_bytes)
    except StorageError as exc:
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
        status="active",
        uploaded_by=actor.membership.id,
    )
    db.add(row)
    db.flush()
    write_event(
        db,
        company_id=row.company_id,
        event="document.uploaded",
        entity="stored_file",
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"name": row.name, "size_bytes": row.size_bytes, "owner_type": row.owner_type},
    )
    db.commit()
    return _summary(row)


def list_files(
    db: Session,
    actor: CurrentSession,
    *,
    owner_type: str | None,
    owner_id: str | None,
    project_id: str | None,
    customer_id: str | None,
    status: str | None,
    page: int,
    page_size: int,
) -> StoredFileList:
    if project_id:
        get_project(db, actor, project_id)
    if customer_id:
        get_customer(db, actor, customer_id)

    filters = [StoredFile.company_id == actor.membership.company_id]
    if owner_type:
        # Customer checklist uploads encode their document slot after a colon.
        # Keep the base owner type query backwards compatible with legacy rows.
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
    if status:
        filters.append(StoredFile.status == status)

    if not is_admin(actor) and "agents.view_all" not in actor.permissions and "agents.manage" not in actor.permissions:
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
        StoredFile.status != "deleted",
    ))
    if not row:
        raise FileNotFoundError("File not found")
    try:
        if row.project_id:
            get_project(db, actor, row.project_id)
        elif row.customer_id:
            get_customer(db, actor, row.customer_id)
        elif not is_admin(actor) and row.uploaded_by != actor.membership.id:
            raise FileForbiddenError("You can only access files assigned to you")
    except AccessError as exc:
        raise FileForbiddenError(str(exc)) from exc
    return row


def set_file_status(db: Session, actor: CurrentSession, file_id: str, status: str) -> StoredFileSummary:
    row = get_file(db, actor, file_id)
    row.status = status
    row.archived_at = datetime.now(UTC) if status in {"archived", "deleted"} else None
    event = {
        "archived": "document.archived",
        "deleted": "document.deleted",
        "active": "document.restored",
    }[status]
    write_event(
        db,
        company_id=row.company_id,
        event=event,
        entity="stored_file",
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"status": status},
    )
    db.commit()
    return _summary(row)
