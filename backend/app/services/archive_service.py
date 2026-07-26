from __future__ import annotations

import csv
import json
import mimetypes
import os
import socket
import zipfile
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import DateTime as SqlDateTime, Numeric as SqlNumeric, delete, func, inspect, or_, select, update
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.core.config import settings
from app.core.time import as_utc
from app.models.agent import AgentCustomer, AgentProfile, AgentTransaction
from app.models.auth import Membership
from app.models.system import Archive, ArchiveJob, AuditEvent, AuthSession, StoredFile
from app.models.workflow import CustomerProject, CustomerQuotation, ProjectTimeline, QuotationRequest, TransactionApproval
from app.schemas.archive import (
    AgentTransactionArchiveRequest,
    ArchiveDetail,
    ArchiveFileEntry,
    ArchiveJobSummary,
    ArchiveKpis,
    ArchiveList,
    ArchiveSummary,
    AuditEventList,
    AuditEventSummary,
)
from app.services.access_service import AccessError, get_customer, get_project, is_admin
from app.services.audit_service import write_event
from app.services.pdf_report import write_project_summary_pdf, write_quotation_pdf
from app.services.storage import StorageError, safe_relative_path, storage

ACTIVE_JOB_STATUSES = {"queued", "running"}
ARCHIVE_READY_STATUSES = {"ready", "cleaned", "restored"}
COMPRESSED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".mp4", ".docx", ".xlsx", ".zip"}


class ArchiveServiceError(Exception):
    status_code = 400


class ArchiveNotFoundError(ArchiveServiceError):
    status_code = 404


class ArchiveForbiddenError(ArchiveServiceError):
    status_code = 403


class ArchiveConflictError(ArchiveServiceError):
    status_code = 409


def _now() -> datetime:
    return datetime.now(UTC)


def _json_default(value: Any):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"Unsupported value: {type(value)!r}")


def _row_data(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    return {column.key: getattr(row, column.key) for column in inspect(row).mapper.column_attrs}


def _model_values(model: type, values: dict[str, Any]) -> dict[str, Any]:
    result = dict(values)
    for column in inspect(model).columns:
        value = result.get(column.key)
        if value is None:
            continue
        if isinstance(column.type, SqlDateTime) and isinstance(value, str):
            result[column.key] = datetime.fromisoformat(value)
        elif isinstance(column.type, SqlNumeric) and not isinstance(value, Decimal):
            result[column.key] = Decimal(str(value))
    return result


def _load_meta(row: Archive) -> dict[str, Any]:
    try:
        value = json.loads(row.meta_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _save_meta(row: Archive, value: dict[str, Any]) -> None:
    row.meta_json = json.dumps(value, separators=(",", ":"), default=_json_default)


def _archive_summary(row: Archive) -> ArchiveSummary:
    meta = _load_meta(row)
    return ArchiveSummary(
        id=row.id,
        type=row.type,
        ref_id=row.ref_id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        customer_name=str(meta.get("customer_name") or ""),
        agent_name=str(meta.get("agent_name") or ""),
        project_name=str(meta.get("project_name") or ""),
        status=row.status,
        file_name=row.file_name,
        size_bytes=row.size_bytes,
        checksum=row.checksum,
        created_at=row.created_at,
        verified_at=row.verified_at,
        keep_until=row.keep_until,
        cleaned_at=row.cleaned_at,
        restored_at=row.restored_at,
        error=row.error,
    )


def _job_summary(row: ArchiveJob) -> ArchiveJobSummary:
    return ArchiveJobSummary(
        id=row.id,
        archive_id=row.archive_id,
        action=row.action,
        status=row.status,
        progress=row.progress,
        started_at=row.started_at,
        finished_at=row.finished_at,
        error=row.error,
        created_at=row.created_at,
    )


def _get_archive(db: Session, actor: CurrentSession, archive_id: str) -> Archive:
    row = db.scalar(select(Archive).where(
        Archive.id == archive_id,
        Archive.company_id == actor.membership.company_id,
    ))
    if not row:
        raise ArchiveNotFoundError("Archive not found")
    try:
        if row.project_id:
            get_project(db, actor, row.project_id)
        elif row.customer_id:
            get_customer(db, actor, row.customer_id)
    except AccessError as exc:
        raise ArchiveForbiddenError(str(exc)) from exc
    return row


def list_archives(
    db: Session,
    actor: CurrentSession,
    *,
    archive_type: str | None,
    status: str | None,
    search: str | None,
    page: int,
    page_size: int,
) -> ArchiveList:
    filters = [Archive.company_id == actor.membership.company_id]
    if archive_type:
        filters.append(Archive.type == archive_type)
    if status:
        filters.append(Archive.status == status)
    if search:
        term = f"%{search.strip()}%"
        filters.append(or_(Archive.ref_id.ilike(term), Archive.meta_json.ilike(term)))

    if actor.role == "agent":
        profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == actor.membership.id))
        if not profile:
            return ArchiveList(data=[], page=page, page_size=page_size, total=0)
        customer_ids = select(AgentCustomer.id).where(AgentCustomer.agent_profile_id == profile.id)
        filters.append((Archive.agent_profile_id == profile.id) | (Archive.customer_id.in_(customer_ids)))
    elif actor.role == "customer":
        customer_ids = select(AgentCustomer.id).where(AgentCustomer.customer_membership_id == actor.membership.id)
        filters.append(Archive.customer_id.in_(customer_ids))

    total = db.scalar(select(func.count()).select_from(Archive).where(*filters)) or 0
    rows = list(db.scalars(
        select(Archive)
        .where(*filters)
        .order_by(Archive.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())
    return ArchiveList(data=[_archive_summary(row) for row in rows], page=page, page_size=page_size, total=total)


def archive_kpis(db: Session, actor: CurrentSession) -> ArchiveKpis:
    company_id = actor.membership.company_id
    now = _now()
    archived_projects = db.scalar(select(func.count()).select_from(Archive).where(
        Archive.company_id == company_id,
        Archive.type == "project",
        Archive.status != "purged",
    )) or 0
    storage_rows = list(db.scalars(select(Archive).where(
        Archive.company_id == company_id,
        Archive.status != "purged",
    )).all())
    storage_used = 0
    for archive in storage_rows:
        meta = _load_meta(archive)
        storage_used += int(meta.get("storage_size_bytes") or archive.size_bytes or 0)
    ready_for_cleanup = db.scalar(select(func.count()).select_from(Archive).where(
        Archive.company_id == company_id,
        Archive.status == "ready",
        Archive.keep_until.is_not(None),
        Archive.keep_until <= now,
    )) or 0
    failed_jobs = db.scalar(select(func.count()).select_from(ArchiveJob).where(
        ArchiveJob.company_id == company_id,
        ArchiveJob.status == "failed",
    )) or 0
    last_cleanup = db.scalar(select(func.max(Archive.cleaned_at)).where(Archive.company_id == company_id))
    return ArchiveKpis(
        archived_projects=int(archived_projects),
        storage_used=int(storage_used),
        ready_for_cleanup=int(ready_for_cleanup),
        failed_jobs=int(failed_jobs),
        last_cleanup=last_cleanup,
    )


def archive_detail(db: Session, actor: CurrentSession, archive_id: str) -> ArchiveDetail:
    row = _get_archive(db, actor, archive_id)
    meta = _load_meta(row)
    files = []
    for item in meta.get("files", []):
        if not isinstance(item, dict):
            continue
        files.append(ArchiveFileEntry(
            relative_path=str(item.get("relative_path", "")),
            name=str(item.get("name", Path(str(item.get("relative_path", ""))).name)),
            size_bytes=int(item.get("size_bytes", 0)),
            checksum=str(item.get("checksum", "")),
            mime_type=str(item.get("mime_type", "application/octet-stream")),
            source_file_id=item.get("source_file_id"),
        ))
    return ArchiveDetail(**_archive_summary(row).model_dump(), version=row.version, meta=meta, files=files)


def get_job(db: Session, actor: CurrentSession, job_id: str) -> ArchiveJobSummary:
    row = db.scalar(select(ArchiveJob).where(
        ArchiveJob.id == job_id,
        ArchiveJob.company_id == actor.membership.company_id,
    ))
    if not row:
        raise ArchiveNotFoundError("Archive job not found")
    return _job_summary(row)


def _request_key(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned[:80] or None


def _replayed_job(
    db: Session,
    actor: CurrentSession,
    request_key: str | None,
    *,
    action: str,
    archive_id: str | None = None,
    archive_type: str | None = None,
    project_id: str | None = None,
    customer_id: str | None = None,
    agent_profile_id: str | None = None,
) -> ArchiveJob | None:
    key = _request_key(request_key)
    if not key:
        return None
    job = db.scalar(select(ArchiveJob).where(
        ArchiveJob.company_id == actor.membership.company_id,
        ArchiveJob.request_key == key,
    ))
    if not job:
        return None
    archive = db.get(Archive, job.archive_id)
    matches = bool(
        archive
        and job.action == action
        and (archive_id is None or archive.id == archive_id)
        and (archive_type is None or archive.type == archive_type)
        and (project_id is None or archive.project_id == project_id)
        and (customer_id is None or archive.customer_id == customer_id)
        and (agent_profile_id is None or archive.agent_profile_id == agent_profile_id)
    )
    if not matches:
        raise ArchiveConflictError("This request key was already used for another archive action")
    return job


def _ensure_no_active_job(db: Session, archive_id: str) -> None:
    active = db.scalar(select(ArchiveJob.id).where(
        ArchiveJob.archive_id == archive_id,
        ArchiveJob.status.in_(ACTIVE_JOB_STATUSES),
    ).limit(1))
    if active:
        raise ArchiveConflictError("This archive already has an active job")


def _queue_job(db: Session, row: Archive, action: str, request_key: str | None = None) -> ArchiveJob:
    _ensure_no_active_job(db, row.id)
    job = ArchiveJob(
        company_id=row.company_id,
        archive_id=row.id,
        action=action,
        status="queued",
        progress=0,
        request_key=_request_key(request_key),
    )
    db.add(job)
    db.flush()
    return job


def create_project_archive(db: Session, actor: CurrentSession, project_id: str, request_key: str | None = None) -> ArchiveJobSummary:
    project = get_project(db, actor, project_id)
    if not is_admin(actor) and "archive.create" not in actor.permissions:
        raise ArchiveForbiddenError("Only an administrator can archive projects")
    replayed = _replayed_job(db, actor, request_key, action="archive", archive_type="project", project_id=project.id)
    if replayed:
        return _job_summary(replayed)
    if project.status != "completed":
        raise ArchiveConflictError("Complete the project timeline before archiving")
    existing = db.scalar(select(Archive).where(
        Archive.company_id == project.company_id,
        Archive.project_id == project.id,
        Archive.type == "project",
        Archive.status.not_in(["failed", "purged", "restored"]),
    ))
    if existing:
        raise ArchiveConflictError("This project already has an active archive")

    customer = db.get(AgentCustomer, project.customer_id)
    row = Archive(
        company_id=project.company_id,
        type="project",
        ref_id=project.project_number,
        project_id=project.id,
        customer_id=project.customer_id,
        agent_profile_id=customer.agent_profile_id if customer else None,
        status="queued",
        created_by=actor.membership.id,
        keep_until=_now() + timedelta(days=settings.archive_keep_days),
    )
    _save_meta(row, {
        "original_project_status": project.status,
        "customer_name": customer.customer_name if customer else "",
        "project_name": project.name,
    })
    db.add(row)
    db.flush()
    project.is_locked = True
    job = _queue_job(db, row, "archive", request_key)
    write_event(
        db,
        company_id=row.company_id,
        event="archive.created",
        entity="archive",
        entity_id=row.id,
        actor=actor,
        project_id=project.id,
        customer_id=project.customer_id,
        changes={"type": "project", "ref_id": row.ref_id},
    )
    db.commit()
    return _job_summary(job)


def _transaction_range(payload: AgentTransactionArchiveRequest) -> tuple[datetime, datetime]:
    return (
        datetime.combine(payload.from_date, time.min, tzinfo=UTC),
        datetime.combine(payload.to_date + timedelta(days=1), time.min, tzinfo=UTC),
    )


def create_transaction_archive(
    db: Session,
    actor: CurrentSession,
    payload: AgentTransactionArchiveRequest,
    request_key: str | None = None,
) -> ArchiveJobSummary:
    if not is_admin(actor) and "archive.create" not in actor.permissions:
        raise ArchiveForbiddenError("Only an administrator can archive transactions")
    membership = db.scalar(select(Membership).where(
        Membership.id == payload.agent_membership_id,
        Membership.company_id == actor.membership.company_id,
    ))
    if not membership:
        raise ArchiveNotFoundError("Agent not found")
    profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == membership.id))
    if not profile:
        raise ArchiveNotFoundError("Agent profile not found")
    replayed = _replayed_job(
        db, actor, request_key, action="archive", archive_type="agent_transactions",
        project_id=payload.project_id, agent_profile_id=profile.id,
    )
    if replayed:
        return _job_summary(replayed)

    start, end = _transaction_range(payload)
    filters = [
        AgentTransaction.company_id == actor.membership.company_id,
        AgentTransaction.agent_profile_id == profile.id,
        AgentTransaction.transaction_date >= start,
        AgentTransaction.transaction_date < end,
        AgentTransaction.archived_at.is_(None),
    ]
    if payload.transaction_type:
        filters.append(AgentTransaction.transaction_type == payload.transaction_type)
    project_name = ""
    if payload.project_id:
        project = get_project(db, actor, payload.project_id)
        project_name = project.name
        filters.append(AgentTransaction.project_id == payload.project_id)

    transactions = list(db.scalars(select(AgentTransaction).where(*filters).order_by(AgentTransaction.transaction_date)).all())
    if not transactions:
        raise ArchiveConflictError("No transactions match this range")
    ids = [row.id for row in transactions]
    approvals = {row.transaction_id: row for row in db.scalars(
        select(TransactionApproval).where(TransactionApproval.transaction_id.in_(ids))
    ).all()}
    pending = [row for row in transactions if approvals.get(row.id) is None or approvals[row.id].status != "approved"]
    if pending:
        raise ArchiveConflictError("Approve all selected transactions before archiving")

    prior_transactions = list(db.scalars(select(AgentTransaction).where(
        AgentTransaction.company_id == actor.membership.company_id,
        AgentTransaction.agent_profile_id == profile.id,
        AgentTransaction.transaction_date < start,
    )).all())
    prior_ids = [row.id for row in prior_transactions]
    prior_approvals = {row.transaction_id: row for row in db.scalars(
        select(TransactionApproval).where(TransactionApproval.transaction_id.in_(prior_ids))
    ).all()} if prior_ids else {}
    opening = Decimal(profile.opening_balance or 0)
    prior_archives = list(db.scalars(select(Archive).where(
        Archive.company_id == actor.membership.company_id,
        Archive.agent_profile_id == profile.id,
        Archive.type == "agent_transactions",
        Archive.status.in_(["ready", "cleaned"]),
    )).all())
    for archived in prior_archives:
        archived_meta = _load_meta(archived)
        archived_to = archived_meta.get("to_date")
        try:
            is_prior = date.fromisoformat(str(archived_to)) < payload.from_date
        except (TypeError, ValueError):
            is_prior = False
        if is_prior:
            finance = archived_meta.get("finance", {})
            opening += Decimal(str(finance.get("total_credit", 0))) - Decimal(str(finance.get("total_debit", 0)))
    for transaction in prior_transactions:
        if prior_approvals.get(transaction.id) and prior_approvals[transaction.id].status == "approved":
            opening += Decimal(transaction.credit or 0) - Decimal(transaction.debit or 0)
    total_debit = sum((Decimal(row.debit or 0) for row in transactions), Decimal("0"))
    total_credit = sum((Decimal(row.credit or 0) for row in transactions), Decimal("0"))

    ref_id = f"AGT-{payload.from_date.isoformat()}-{payload.to_date.isoformat()}"
    row = Archive(
        company_id=actor.membership.company_id,
        type="agent_transactions",
        ref_id=ref_id,
        agent_profile_id=profile.id,
        project_id=payload.project_id,
        status="queued",
        created_by=actor.membership.id,
        keep_until=_now() + timedelta(days=settings.archive_keep_days),
    )
    _save_meta(row, {
        "agent_membership_id": membership.id,
        "agent_name": membership.user.full_name,
        "customer_name": "",
        "project_name": project_name,
        "from_date": payload.from_date,
        "to_date": payload.to_date,
        "transaction_type": payload.transaction_type,
        "project_id": payload.project_id,
        "transaction_ids": ids,
        "finance": {
            "opening_balance": opening,
            "total_debit": total_debit,
            "total_credit": total_credit,
            "closing_balance": opening + total_credit - total_debit,
        },
    })
    db.add(row)
    db.flush()
    job = _queue_job(db, row, "archive", request_key)
    write_event(
        db,
        company_id=row.company_id,
        event="archive.created",
        entity="archive",
        entity_id=row.id,
        actor=actor,
        project_id=payload.project_id,
        changes={"type": row.type, "agent_profile_id": profile.id, "count": len(ids)},
    )
    db.commit()
    return _job_summary(job)


def create_customer_archive(db: Session, actor: CurrentSession, customer_id: str, request_key: str | None = None) -> ArchiveJobSummary:
    if not is_admin(actor) and "archive.create" not in actor.permissions:
        raise ArchiveForbiddenError("Only an administrator can archive customers")
    customer = get_customer(db, actor, customer_id)
    replayed = _replayed_job(db, actor, request_key, action="archive", archive_type="customer", customer_id=customer.id)
    if replayed:
        return _job_summary(replayed)
    if Decimal(customer.outstanding_balance or 0) > 0:
        raise ArchiveConflictError("Clear the customer outstanding balance before archiving")
    existing = db.scalar(select(Archive.id).where(
        Archive.company_id == customer.company_id,
        Archive.customer_id == customer.id,
        Archive.type == "customer",
        Archive.status.not_in(["failed", "purged", "restored"]),
    ).limit(1))
    if existing:
        raise ArchiveConflictError("This customer already has an active archive")
    active_project = db.scalar(select(CustomerProject.id).where(
        CustomerProject.customer_id == customer.id,
        CustomerProject.status != "completed",
        CustomerProject.archived_at.is_(None),
    ).limit(1))
    if active_project:
        raise ArchiveConflictError("Complete or archive all customer projects first")
    pending_quote = db.scalar(select(QuotationRequest.id).where(
        QuotationRequest.customer_id == customer.id,
        QuotationRequest.status.in_(["pending", "quotation_ready", "condition"]),
    ).limit(1))
    if pending_quote:
        raise ArchiveConflictError("Resolve pending quotations before archiving the customer")

    row = Archive(
        company_id=customer.company_id,
        type="customer",
        ref_id=customer.customer_name,
        customer_id=customer.id,
        agent_profile_id=customer.agent_profile_id,
        status="queued",
        created_by=actor.membership.id,
        keep_until=_now() + timedelta(days=settings.archive_keep_days),
    )
    customer_project_ids = list(db.scalars(select(CustomerProject.id).where(
        CustomerProject.customer_id == customer.id,
        CustomerProject.status == "completed",
        CustomerProject.archived_at.is_(None),
    )).all())
    _save_meta(row, {
        "original_customer_status": customer.status,
        "customer_name": customer.customer_name,
        "project_name": "",
        "customer_project_ids": customer_project_ids,
    })
    db.add(row)
    db.flush()
    job = _queue_job(db, row, "archive", request_key)
    write_event(
        db,
        company_id=row.company_id,
        event="archive.created",
        entity="archive",
        entity_id=row.id,
        actor=actor,
        customer_id=customer.id,
        changes={"type": "customer", "ref_id": row.ref_id},
    )
    db.commit()
    return _job_summary(job)


def queue_verify(db: Session, actor: CurrentSession, archive_id: str, request_key: str | None = None) -> ArchiveJobSummary:
    row = _get_archive(db, actor, archive_id)
    replayed = _replayed_job(db, actor, request_key, action="verify", archive_id=row.id)
    if replayed:
        return _job_summary(replayed)
    if row.status not in ARCHIVE_READY_STATUSES:
        raise ArchiveConflictError("Only a completed archive can be verified")
    job = _queue_job(db, row, "verify", request_key)
    db.commit()
    return _job_summary(job)


def queue_cleanup(db: Session, actor: CurrentSession, archive_id: str, force: bool, request_key: str | None = None) -> ArchiveJobSummary:
    row = _get_archive(db, actor, archive_id)
    replayed = _replayed_job(db, actor, request_key, action="cleanup", archive_id=row.id)
    if replayed:
        return _job_summary(replayed)
    if row.status != "ready":
        raise ArchiveConflictError("The archive must be ready before cleanup")
    if force and not actor.user.is_super_admin:
        raise ArchiveForbiddenError("Only a super administrator can override retention")
    if not force and row.keep_until and as_utc(row.keep_until) > _now():
        raise ArchiveConflictError(f"Cleanup is available after {row.keep_until.date().isoformat()}")
    meta = _load_meta(row)
    meta["cleanup_force"] = force
    _save_meta(row, meta)
    job = _queue_job(db, row, "cleanup", request_key)
    db.commit()
    return _job_summary(job)


def queue_restore(db: Session, actor: CurrentSession, archive_id: str, request_key: str | None = None) -> ArchiveJobSummary:
    row = _get_archive(db, actor, archive_id)
    replayed = _replayed_job(db, actor, request_key, action="restore", archive_id=row.id)
    if replayed:
        return _job_summary(replayed)
    if row.status not in {"ready", "cleaned"}:
        raise ArchiveConflictError("Only ready or cleaned archives can be restored")
    job = _queue_job(db, row, "restore", request_key)
    db.commit()
    return _job_summary(job)


def queue_purge(
    db: Session,
    actor: CurrentSession,
    archive_id: str,
    confirmation: str,
    reason: str,
    request_key: str | None = None,
) -> ArchiveJobSummary:
    if not actor.user.is_super_admin:
        raise ArchiveForbiddenError("Only a super administrator can permanently purge archives")
    row = _get_archive(db, actor, archive_id)
    replayed = _replayed_job(db, actor, request_key, action="purge", archive_id=row.id)
    if replayed:
        return _job_summary(replayed)
    auth_session = db.get(AuthSession, actor.auth_session_id)
    if not auth_session or as_utc(auth_session.created_at) < _now() - timedelta(minutes=15):
        raise ArchiveForbiddenError("Sign in again before permanently purging an archive")
    if row.status not in {"cleaned", "restored"}:
        raise ArchiveConflictError("Restore or clean the archive before permanent purge")
    expected = f"PURGE {row.ref_id}"
    if confirmation != expected:
        raise ArchiveConflictError(f'Type "{expected}" to confirm permanent purge')
    meta = _load_meta(row)
    meta["purge_reason"] = reason
    _save_meta(row, meta)
    job = _queue_job(db, row, "purge", request_key)
    db.commit()
    return _job_summary(job)


def archive_download_path(db: Session, actor: CurrentSession, archive_id: str) -> tuple[Archive, Path]:
    row = _get_archive(db, actor, archive_id)
    if row.status not in ARCHIVE_READY_STATUSES or not row.storage_path:
        raise ArchiveConflictError("The archive package is not ready")
    try:
        path = storage.path(row.storage_path)
    except StorageError as exc:
        raise ArchiveConflictError(str(exc)) from exc
    if not path.is_file():
        raise ArchiveNotFoundError("Archive package is missing")
    write_event(
        db,
        company_id=row.company_id,
        event="archive.downloaded",
        entity="archive",
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"file_name": row.file_name, "size_bytes": row.size_bytes},
    )
    db.commit()
    return row, path


def list_events(
    db: Session,
    actor: CurrentSession,
    *,
    project_id: str | None,
    customer_id: str | None,
    entity: str | None,
    event: str | None,
    page: int,
    page_size: int,
) -> AuditEventList:
    if project_id:
        get_project(db, actor, project_id)
    if customer_id:
        get_customer(db, actor, customer_id)
    filters = [AuditEvent.company_id == actor.membership.company_id]
    if project_id:
        filters.append(AuditEvent.project_id == project_id)
    if customer_id:
        filters.append(AuditEvent.customer_id == customer_id)
    if entity:
        filters.append(AuditEvent.entity == entity)
    if event:
        filters.append(AuditEvent.event == event)
    total = db.scalar(select(func.count()).select_from(AuditEvent).where(*filters)) or 0
    rows = list(db.scalars(
        select(AuditEvent)
        .where(*filters)
        .order_by(AuditEvent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())
    data = []
    for row in rows:
        try:
            changes = json.loads(row.changes_json or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            changes = {}
        data.append(AuditEventSummary(
            id=row.id,
            event=row.event,
            entity=row.entity,
            entity_id=row.entity_id,
            project_id=row.project_id,
            customer_id=row.customer_id,
            user_id=row.user_id,
            user_role=row.user_role,
            changes=changes if isinstance(changes, dict) else {},
            request_id=row.request_id,
            created_at=row.created_at,
        ))
    return AuditEventList(data=data, page=page, page_size=page_size, total=total)


# Worker functions

def _recover_stale_jobs(db: Session) -> None:
    cutoff = _now() - timedelta(minutes=settings.archive_job_timeout_minutes)
    rows = list(db.scalars(select(ArchiveJob).where(
        ArchiveJob.status == "running",
        ArchiveJob.started_at.is_not(None),
        ArchiveJob.started_at < cutoff,
    )).all())
    if not rows:
        return
    for job in rows:
        row = db.get(Archive, job.archive_id)
        job.status = "failed"
        job.error = "Archive worker stopped before the job completed"
        job.finished_at = _now()
        if not row:
            continue
        row.error = job.error
        if job.action == "archive":
            row.status = "failed"
            if row.type == "project" and row.project_id:
                project = db.get(CustomerProject, row.project_id)
                if project and project.archive_id is None:
                    project.is_locked = False
        write_event(
            db,
            company_id=row.company_id,
            event="archive.failed",
            entity="archive",
            entity_id=row.id,
            project_id=row.project_id,
            customer_id=row.customer_id,
            changes={"action": job.action, "error": job.error, "recovered": True},
        )
    db.commit()


def claim_next_job(db: Session, worker_id: str | None = None) -> ArchiveJob | None:
    worker = worker_id or f"{socket.gethostname()}:{os.getpid()}"
    _recover_stale_jobs(db)
    running = db.scalar(select(func.count()).select_from(ArchiveJob).where(ArchiveJob.status == "running")) or 0
    if running >= settings.archive_worker_limit:
        return None
    candidate = db.scalar(select(ArchiveJob.id).where(ArchiveJob.status == "queued").order_by(ArchiveJob.created_at).limit(1))
    if not candidate:
        return None
    result = db.execute(
        update(ArchiveJob)
        .where(ArchiveJob.id == candidate, ArchiveJob.status == "queued")
        .values(status="running", worker_id=worker, started_at=_now(), progress=1, error="")
    )
    if result.rowcount != 1:
        db.rollback()
        return None
    db.commit()
    return db.get(ArchiveJob, candidate)


def _progress(db: Session, job: ArchiveJob, row: Archive, progress: int, status: str | None = None) -> None:
    job.progress = max(0, min(100, progress))
    if status:
        row.status = status
    db.commit()


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=_json_default), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, separators=(",", ":"), default=_json_default) + "\n")


def _write_transactions_csv(path: Path, rows: list[AgentTransaction]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "date", "reference", "type", "description", "debit", "credit", "project_id"])
        for row in rows:
            writer.writerow([
                row.id,
                row.transaction_date.isoformat(),
                row.reference,
                row.transaction_type,
                row.description,
                str(row.debit),
                str(row.credit),
                row.project_id or "",
            ])


def _collect_file_entries(root: Path, source_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file() and "packages" not in item.parts and item.name not in {"manifest.json", "checksums.sha256"}):
        relative = path.relative_to(root).as_posix()
        digest = storage.checksum(path.relative_to(storage.root).as_posix())
        source = source_map.get(relative, {})
        entries.append({
            "relative_path": relative,
            "name": source.get("name", path.name),
            "size_bytes": path.stat().st_size,
            "checksum": digest,
            "mime_type": source.get("mime_type") or mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "source_file_id": source.get("source_file_id"),
            "source_storage_path": source.get("source_storage_path"),
            "source_status": source.get("source_status"),
        })
    return entries


def _copy_files(root_relative: str, files: list[StoredFile]) -> dict[str, dict[str, Any]]:
    source_map: dict[str, dict[str, Any]] = {}
    for row in files:
        if not storage.exists(row.storage_path):
            continue
        safe_name = Path(row.name).name.replace("/", "_").replace("\\", "_")
        target_relative_inside = f"documents/{row.owner_type}/{row.id}_{safe_name}"
        target = f"{root_relative}/{target_relative_inside}"
        storage.copy(row.storage_path, target)
        source_map[target_relative_inside] = {
            "name": row.name,
            "mime_type": row.mime_type,
            "source_file_id": row.id,
            "source_storage_path": row.storage_path,
            "source_status": row.status,
        }
    return source_map


def _create_zip(root: Path, package_path: Path) -> None:
    package_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(package_path, "w", allowZip64=True) as bundle:
        for path in sorted(item for item in root.rglob("*") if item.is_file() and item != package_path):
            relative = path.relative_to(root).as_posix()
            compression = zipfile.ZIP_STORED if path.suffix.lower() in COMPRESSED_EXTENSIONS else zipfile.ZIP_DEFLATED
            bundle.write(path, arcname=relative, compress_type=compression, compresslevel=6 if compression == zipfile.ZIP_DEFLATED else None)


def _project_data(db: Session, row: Archive) -> tuple[dict[str, Any], list[StoredFile]]:
    project = db.get(CustomerProject, row.project_id)
    if not project:
        raise ArchiveNotFoundError("Project no longer exists")
    customer = db.get(AgentCustomer, project.customer_id)
    quotation = db.get(CustomerQuotation, project.quotation_id)
    request = db.get(QuotationRequest, quotation.request_id) if quotation else None
    timeline = db.scalar(select(ProjectTimeline).where(ProjectTimeline.project_id == project.id))
    profile = db.get(AgentProfile, customer.agent_profile_id) if customer else None
    agent_membership = db.get(Membership, profile.membership_id) if profile else None
    transactions = list(db.scalars(select(AgentTransaction).where(AgentTransaction.project_id == project.id)).all())
    transaction_ids = [item.id for item in transactions]
    approvals = list(db.scalars(select(TransactionApproval).where(TransactionApproval.transaction_id.in_(transaction_ids))).all()) if transaction_ids else []
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.project_id == project.id).order_by(AuditEvent.created_at)).all())
    files = list(db.scalars(select(StoredFile).where(
        StoredFile.company_id == row.company_id,
        StoredFile.project_id == project.id,
        StoredFile.status != "deleted",
    )).all())
    data = {
        "project": _row_data(project),
        "customer": _row_data(customer),
        "agent": {
            "profile": _row_data(profile),
            "membership": _row_data(agent_membership),
            "user": _row_data(agent_membership.user) if agent_membership and agent_membership.user else {},
        },
        "quotation": _row_data(quotation),
        "quotation_request": _row_data(request),
        "timeline": _row_data(timeline),
        "transactions": [_row_data(item) for item in transactions],
        "approvals": [_row_data(item) for item in approvals],
        "events": [_row_data(item) for item in events],
    }
    return data, files


def _transaction_data(db: Session, row: Archive) -> tuple[dict[str, Any], list[StoredFile]]:
    meta = _load_meta(row)
    ids = [str(value) for value in meta.get("transaction_ids", [])]
    transactions = list(db.scalars(select(AgentTransaction).where(AgentTransaction.id.in_(ids)).order_by(AgentTransaction.transaction_date)).all()) if ids else []
    approvals = list(db.scalars(select(TransactionApproval).where(TransactionApproval.transaction_id.in_(ids))).all()) if ids else []
    profile = db.get(AgentProfile, row.agent_profile_id) if row.agent_profile_id else None
    membership = db.get(Membership, profile.membership_id) if profile else None
    events = list(db.scalars(select(AuditEvent).where(
        AuditEvent.company_id == row.company_id,
        AuditEvent.entity == "agent_transaction",
        AuditEvent.entity_id.in_(ids),
    ).order_by(AuditEvent.created_at)).all()) if ids else []
    data = {
        "agent": {"profile": _row_data(profile), "membership": _row_data(membership)},
        "transactions": [_row_data(item) for item in transactions],
        "approvals": [_row_data(item) for item in approvals],
        "events": [_row_data(item) for item in events],
        "finance": meta.get("finance", {}),
    }
    return data, []


def _customer_data(db: Session, row: Archive) -> tuple[dict[str, Any], list[StoredFile]]:
    customer = db.get(AgentCustomer, row.customer_id)
    if not customer:
        raise ArchiveNotFoundError("Customer no longer exists")
    projects = list(db.scalars(select(CustomerProject).where(CustomerProject.customer_id == customer.id)).all())
    project_ids = [item.id for item in projects]
    timelines = list(db.scalars(select(ProjectTimeline).where(ProjectTimeline.project_id.in_(project_ids))).all()) if project_ids else []
    quotations = list(db.scalars(select(CustomerQuotation).where(CustomerQuotation.customer_id == customer.id)).all())
    requests = list(db.scalars(select(QuotationRequest).where(QuotationRequest.customer_id == customer.id)).all())
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.customer_id == customer.id).order_by(AuditEvent.created_at)).all())
    files = list(db.scalars(select(StoredFile).where(
        StoredFile.company_id == row.company_id,
        StoredFile.customer_id == customer.id,
        StoredFile.status != "deleted",
    )).all())
    data = {
        "customer": _row_data(customer),
        "projects": [_row_data(item) for item in projects],
        "timelines": [_row_data(item) for item in timelines],
        "quotations": [_row_data(item) for item in quotations],
        "quotation_requests": [_row_data(item) for item in requests],
        "events": [_row_data(item) for item in events],
        "project_ids": project_ids,
    }
    return data, files


def _build_archive(db: Session, job: ArchiveJob, row: Archive) -> None:
    _progress(db, job, row, 8, "collecting")
    if row.type == "project":
        data, files = _project_data(db, row)
    elif row.type == "agent_transactions":
        data, files = _transaction_data(db, row)
    elif row.type == "customer":
        data, files = _customer_data(db, row)
    else:
        raise ArchiveConflictError("Unsupported archive type")

    root_relative = f"archives/{row.company_id}/{row.id}"
    root = storage.path(root_relative)
    if root.exists():
        storage.delete_tree(root_relative)
    root.mkdir(parents=True, exist_ok=True)
    data_root = root / "data"

    if row.type == "project":
        _write_json(data_root / "project.json", data["project"])
        _write_json(data_root / "customer.json", data["customer"])
        _write_json(data_root / "agent.json", data["agent"])
        _write_json(data_root / "quotations.json", {"quotation": data["quotation"], "request": data["quotation_request"]})
        _write_json(data_root / "timeline.json", data["timeline"])
        _write_json(data_root / "approvals.json", data["approvals"])
        _write_json(data_root / "transactions.json", data["transactions"])
        _write_jsonl(data_root / "events.jsonl", data["events"])
    elif row.type == "agent_transactions":
        _write_json(data_root / "agent.json", data["agent"])
        _write_json(data_root / "transactions.json", data["transactions"])
        transaction_models = [db.get(AgentTransaction, item["id"]) for item in data["transactions"]]
        _write_transactions_csv(data_root / "transactions.csv", [item for item in transaction_models if item])
        _write_json(data_root / "approvals.json", data["approvals"])
        _write_json(data_root / "financial-summary.json", data["finance"])
        _write_jsonl(data_root / "events.jsonl", data["events"])
    else:
        _write_json(data_root / "customer.json", data["customer"])
        _write_json(data_root / "projects.json", data["projects"])
        _write_json(data_root / "timelines.json", data["timelines"])
        _write_json(data_root / "quotations.json", data["quotations"])
        _write_json(data_root / "quotation-requests.json", data["quotation_requests"])
        _write_jsonl(data_root / "events.jsonl", data["events"])

    reports_root = root / "reports"
    if row.type == "project" and row.project_id:
        project_model = db.get(CustomerProject, row.project_id)
        customer_model = db.get(AgentCustomer, row.customer_id) if row.customer_id else None
        quotation_model = db.get(CustomerQuotation, project_model.quotation_id) if project_model else None
        if project_model:
            write_project_summary_pdf(reports_root / "project-summary.pdf", project_model, customer_model)
        if quotation_model:
            write_quotation_pdf(reports_root / f"{quotation_model.quotation_number}-quotation.pdf", quotation_model, customer_model)
    elif row.type == "customer" and row.customer_id:
        customer_model = db.get(AgentCustomer, row.customer_id)
        for quotation_data in data.get("quotations", []):
            quotation_model = db.get(CustomerQuotation, quotation_data.get("id")) if isinstance(quotation_data, dict) else None
            if quotation_model and quotation_model.status == "approved":
                write_quotation_pdf(reports_root / f"{quotation_model.quotation_number}-quotation.pdf", quotation_model, customer_model)

    _progress(db, job, row, 40, "packing")
    source_map = _copy_files(root_relative, files)
    entries = _collect_file_entries(root, source_map)
    checksums = "\n".join(f'{item["checksum"]}  {item["relative_path"]}' for item in entries) + "\n"
    (root / "checksums.sha256").write_text(checksums, encoding="utf-8")

    meta = _load_meta(row)
    manifest = {
        "version": row.version,
        "archive_id": row.id,
        "type": row.type,
        "ref_id": row.ref_id,
        "project_id": row.project_id,
        "customer_id": row.customer_id,
        "created_at": row.created_at,
        "created_by": row.created_by,
        "record_count": sum(len(value) if isinstance(value, list) else 1 for value in data.values()),
        "file_count": len(entries),
        "size_bytes": sum(item["size_bytes"] for item in entries),
        "files": entries,
        "meta": {key: value for key, value in meta.items() if key not in {"files"}},
    }
    _write_json(root / "manifest.json", manifest)

    safe_ref = "".join(character if character.isalnum() or character in "-_" else "-" for character in row.ref_id).strip("-")[:80] or row.id
    row.file_name = f"{safe_ref}-archive.zip"
    package_relative = f"{root_relative}/packages/{row.file_name}"
    package_path = storage.path(package_relative)
    _create_zip(root, package_path)
    row.storage_path = package_relative
    row.size_bytes = package_path.stat().st_size
    row.checksum = storage.checksum(package_relative)
    meta["root_path"] = root_relative
    meta["storage_size_bytes"] = sum(path.stat().st_size for path in root.rglob("*") if path.is_file())
    meta["files"] = entries
    meta["record_count"] = manifest["record_count"]
    meta["file_count"] = len(entries)
    _save_meta(row, meta)
    _progress(db, job, row, 82, "verifying")
    _verify_archive(db, job, row)

    now = _now()
    if row.type == "project" and row.project_id:
        project = db.get(CustomerProject, row.project_id)
        if project:
            project.archived_at = now
            project.archived_by = row.created_by
            project.archive_id = row.id
            project.is_locked = True
    elif row.type == "agent_transactions":
        ids = _load_meta(row).get("transaction_ids", [])
        db.execute(update(AgentTransaction).where(AgentTransaction.id.in_(ids)).values(
            archived_at=now,
            archived_by=row.created_by,
            archive_id=row.id,
        ))
    elif row.type == "customer" and row.customer_id:
        customer = db.get(AgentCustomer, row.customer_id)
        if customer:
            customer.archived_at = now
            customer.archived_by = row.created_by
            customer.archive_id = row.id
            customer.status = "archived"
        project_ids = [str(value) for value in meta.get("customer_project_ids", [])]
        if project_ids:
            db.execute(update(CustomerProject).where(
                CustomerProject.id.in_(project_ids),
                CustomerProject.archived_at.is_(None),
            ).values(
                archived_at=now,
                archived_by=row.created_by,
                archive_id=row.id,
                is_locked=True,
            ))

    write_event(
        db,
        company_id=row.company_id,
        event="archive.verified",
        entity="archive",
        entity_id=row.id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"checksum": row.checksum, "size_bytes": row.size_bytes},
    )
    job.status = "completed"
    job.progress = 100
    job.finished_at = now
    db.commit()


def _verify_archive(db: Session, job: ArchiveJob, row: Archive) -> None:
    previous_status = row.status
    meta = _load_meta(row)
    root_relative = meta.get("root_path")
    if not root_relative:
        raise ArchiveConflictError("Archive root is missing")
    root = storage.path(str(root_relative))
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise ArchiveConflictError("Archive manifest is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = manifest.get("files", [])
    for item in files:
        relative = safe_relative_path(str(item["relative_path"]))
        target = (root / relative).resolve()
        if root.resolve() not in target.parents or not target.is_file():
            raise ArchiveConflictError(f"Archived file is missing: {relative}")
        relative_to_storage = target.relative_to(storage.root).as_posix()
        if storage.checksum(relative_to_storage) != item["checksum"]:
            raise ArchiveConflictError(f"Checksum failed: {relative}")
    if not row.storage_path or not storage.exists(row.storage_path):
        raise ArchiveConflictError("ZIP package is missing")
    if row.checksum and storage.checksum(row.storage_path) != row.checksum:
        raise ArchiveConflictError("ZIP package checksum failed")
    row.status = previous_status if previous_status in {"cleaned", "restored"} else "ready"
    row.verified_at = _now()
    row.error = ""
    job.progress = max(job.progress, 95)
    db.commit()


def _restore_files(db: Session, row: Archive, meta: dict[str, Any]) -> None:
    root = storage.path(str(meta["root_path"]))
    for item in meta.get("files", []):
        source_file_id = item.get("source_file_id")
        source_storage_path = item.get("source_storage_path")
        if not source_file_id or not source_storage_path:
            continue
        source = root / safe_relative_path(str(item["relative_path"]))
        if not source.is_file():
            raise ArchiveConflictError(f"Archived document is missing: {item.get('name', '')}")
        source_relative = source.relative_to(storage.root).as_posix()
        storage.copy(source_relative, str(source_storage_path))
        stored = db.get(StoredFile, source_file_id)
        if stored:
            stored.status = str(item.get("source_status") or "active")
            stored.deleted_at = None
            stored.archived_at = None if stored.status == "active" else stored.archived_at


def _cleanup_archive(db: Session, job: ArchiveJob, row: Archive) -> None:
    _verify_archive(db, job, row)
    meta = _load_meta(row)
    reclaimed = 0
    if row.type in {"project", "customer"}:
        for item in meta.get("files", []):
            file_id = item.get("source_file_id")
            if not file_id:
                continue
            stored = db.get(StoredFile, file_id)
            if not stored or stored.status == "deleted":
                continue
            if storage.exists(stored.storage_path):
                reclaimed += storage.size(stored.storage_path)
                storage.delete(stored.storage_path)
            stored.status = "deleted"
            stored.deleted_at = _now()
        if row.type == "project" and row.project_id:
            timeline = db.scalar(select(ProjectTimeline).where(ProjectTimeline.project_id == row.project_id))
            if timeline:
                db.delete(timeline)
        elif row.type == "customer":
            project_ids = [str(value) for value in meta.get("customer_project_ids", [])]
            if project_ids:
                db.execute(delete(ProjectTimeline).where(ProjectTimeline.project_id.in_(project_ids)))
    elif row.type == "agent_transactions":
        ids = [str(value) for value in meta.get("transaction_ids", [])]
        if ids:
            db.execute(delete(TransactionApproval).where(TransactionApproval.transaction_id.in_(ids)))
            batch_size = 1000
            for offset in range(0, len(ids), batch_size):
                db.execute(delete(AgentTransaction).where(AgentTransaction.id.in_(ids[offset:offset + batch_size])))
                db.flush()

    meta["reclaimed_file_bytes"] = reclaimed
    _save_meta(row, meta)
    row.status = "cleaned"
    row.cleaned_at = _now()
    write_event(
        db,
        company_id=row.company_id,
        event="archive.cleaned",
        entity="archive",
        entity_id=row.id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"reclaimed_file_bytes": reclaimed, "type": row.type},
    )
    job.status = "completed"
    job.progress = 100
    job.finished_at = _now()
    db.commit()


def _restore_archive(db: Session, job: ArchiveJob, row: Archive) -> None:
    _verify_archive(db, job, row)
    meta = _load_meta(row)
    root = storage.path(str(meta["root_path"]))
    _restore_files(db, row, meta)

    if row.type == "project" and row.project_id:
        project = db.get(CustomerProject, row.project_id)
        if not project:
            project_data = json.loads((root / "data/project.json").read_text(encoding="utf-8"))
            project = CustomerProject(**_model_values(CustomerProject, project_data))
            db.add(project)
            db.flush()
        timeline_path = root / "data/timeline.json"
        if timeline_path.is_file() and not db.scalar(select(ProjectTimeline).where(ProjectTimeline.project_id == row.project_id)):
            timeline_data = json.loads(timeline_path.read_text(encoding="utf-8"))
            if timeline_data:
                db.add(ProjectTimeline(**_model_values(ProjectTimeline, timeline_data)))
        project.archived_at = None
        project.archived_by = None
        project.archive_id = None
        project.is_locked = False
        project.status = str(meta.get("original_project_status") or "completed")
    elif row.type == "agent_transactions":
        transactions = json.loads((root / "data/transactions.json").read_text(encoding="utf-8"))
        approvals = json.loads((root / "data/approvals.json").read_text(encoding="utf-8"))
        for value in transactions:
            existing = db.get(AgentTransaction, value["id"])
            if existing:
                existing.archived_at = None
                existing.archived_by = None
                existing.archive_id = None
                continue
            restored = _model_values(AgentTransaction, value)
            restored["archived_at"] = None
            restored["archived_by"] = None
            restored["archive_id"] = None
            db.add(AgentTransaction(**restored))
        db.flush()
        for value in approvals:
            if db.get(TransactionApproval, value["id"]):
                continue
            db.add(TransactionApproval(**_model_values(TransactionApproval, value)))
    elif row.type == "customer" and row.customer_id:
        customer = db.get(AgentCustomer, row.customer_id)
        if customer:
            customer.archived_at = None
            customer.archived_by = None
            customer.archive_id = None
            customer.status = str(meta.get("original_customer_status") or "active")
        timelines_path = root / "data/timelines.json"
        if timelines_path.is_file():
            for value in json.loads(timelines_path.read_text(encoding="utf-8")):
                if not db.scalar(select(ProjectTimeline.id).where(ProjectTimeline.project_id == value.get("project_id"))):
                    db.add(ProjectTimeline(**_model_values(ProjectTimeline, value)))
        project_ids = [str(value) for value in meta.get("customer_project_ids", [])]
        if project_ids:
            db.execute(update(CustomerProject).where(
                CustomerProject.id.in_(project_ids),
                CustomerProject.archive_id == row.id,
            ).values(
                archived_at=None,
                archived_by=None,
                archive_id=None,
                is_locked=False,
            ))

    row.status = "restored"
    row.restored_at = _now()
    write_event(
        db,
        company_id=row.company_id,
        event="archive.restored",
        entity="archive",
        entity_id=row.id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"type": row.type},
    )
    job.status = "completed"
    job.progress = 100
    job.finished_at = _now()
    db.commit()


def _purge_archive(db: Session, job: ArchiveJob, row: Archive) -> None:
    meta = _load_meta(row)
    root_path = meta.get("root_path")
    if root_path:
        storage.delete_tree(str(root_path))
    row.status = "purged"
    row.purged_at = _now()
    row.storage_path = ""
    row.file_name = ""
    row.size_bytes = 0
    row.checksum = ""
    write_event(
        db,
        company_id=row.company_id,
        event="archive.purged",
        entity="archive",
        entity_id=row.id,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"reason": meta.get("purge_reason", "")},
    )
    job.status = "completed"
    job.progress = 100
    job.finished_at = _now()
    db.commit()


def process_job(db: Session, job: ArchiveJob) -> None:
    row = db.get(Archive, job.archive_id)
    if not row:
        job.status = "failed"
        job.error = "Archive record not found"
        job.finished_at = _now()
        db.commit()
        return
    previous_status = row.status
    try:
        if job.action == "archive":
            _build_archive(db, job, row)
        elif job.action == "verify":
            _verify_archive(db, job, row)
            write_event(
                db,
                company_id=row.company_id,
                event="archive.verified",
                entity="archive",
                entity_id=row.id,
                project_id=row.project_id,
                customer_id=row.customer_id,
                changes={"checksum": row.checksum, "manual": True},
            )
            job.status = "completed"
            job.progress = 100
            job.finished_at = _now()
            db.commit()
        elif job.action == "cleanup":
            _cleanup_archive(db, job, row)
        elif job.action == "restore":
            _restore_archive(db, job, row)
        elif job.action == "purge":
            _purge_archive(db, job, row)
        else:
            raise ArchiveConflictError("Unknown archive job action")
    except Exception as exc:
        db.rollback()
        row = db.get(Archive, job.archive_id)
        current_job = db.get(ArchiveJob, job.id)
        if row:
            row.status = "failed" if job.action == "archive" else previous_status
            row.error = str(exc)[:600]
            if row.type == "project" and row.project_id and job.action == "archive":
                project = db.get(CustomerProject, row.project_id)
                if project and project.archive_id is None:
                    project.is_locked = False
            write_event(
                db,
                company_id=row.company_id,
                event="archive.failed",
                entity="archive",
                entity_id=row.id,
                project_id=row.project_id,
                customer_id=row.customer_id,
                changes={"action": job.action, "error": str(exc)[:300]},
            )
        if current_job:
            current_job.status = "failed"
            current_job.error = str(exc)[:600]
            current_job.finished_at = _now()
        db.commit()
        raise

