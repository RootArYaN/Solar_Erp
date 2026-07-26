from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions, require_permissions
from app.core.config import settings
from app.db.session import get_db
from app.schemas.archive import (
    AgentTransactionArchiveRequest,
    ArchiveDetail,
    ArchiveJobSummary,
    ArchiveKpis,
    ArchiveList,
    AuditEventList,
    CleanupRequest,
    PurgeRequest,
)
from app.services import archive_service
from app.services.archive_service import ArchiveServiceError

router = APIRouter(tags=["archives"])


def _raise(exc: ArchiveServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/archives", response_model=ArchiveList)
def get_archives(
    archive_type: str | None = Query(default=None, alias="type", pattern=r"^(project|customer|agent_transactions)$"),
    status_filter: str | None = Query(default=None, alias="status", max_length=32),
    search: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.view")),
) -> ArchiveList:
    return archive_service.list_archives(
        db,
        session,
        archive_type=archive_type,
        status=status_filter,
        search=search,
        page=page,
        page_size=page_size,
    )


@router.get("/archives/kpis", response_model=ArchiveKpis)
def get_archive_kpis(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.view")),
) -> ArchiveKpis:
    return archive_service.archive_kpis(db, session)


@router.get("/archives/{archive_id}", response_model=ArchiveDetail)
def get_archive(
    archive_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.view")),
) -> ArchiveDetail:
    try:
        return archive_service.archive_detail(db, session, archive_id)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/projects/{project_id}", response_model=ArchiveJobSummary, status_code=201)
def post_project_archive(
    project_id: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.create")),
) -> ArchiveJobSummary:
    try:
        return archive_service.create_project_archive(db, session, project_id, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/customers/{customer_id}", response_model=ArchiveJobSummary, status_code=201)
def post_customer_archive(
    customer_id: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.create")),
) -> ArchiveJobSummary:
    try:
        return archive_service.create_customer_archive(db, session, customer_id, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/agent-transactions", response_model=ArchiveJobSummary, status_code=201)
def post_transaction_archive(
    payload: AgentTransactionArchiveRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.create")),
) -> ArchiveJobSummary:
    try:
        return archive_service.create_transaction_archive(db, session, payload, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/{archive_id}/verify", response_model=ArchiveJobSummary)
def post_verify(
    archive_id: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.verify")),
) -> ArchiveJobSummary:
    try:
        return archive_service.queue_verify(db, session, archive_id, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/{archive_id}/cleanup", response_model=ArchiveJobSummary)
def post_cleanup(
    archive_id: str,
    payload: CleanupRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.cleanup")),
) -> ArchiveJobSummary:
    try:
        return archive_service.queue_cleanup(db, session, archive_id, payload.force, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/{archive_id}/restore", response_model=ArchiveJobSummary)
def post_restore(
    archive_id: str,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.restore")),
) -> ArchiveJobSummary:
    try:
        return archive_service.queue_restore(db, session, archive_id, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.post("/archives/{archive_id}/purge", response_model=ArchiveJobSummary)
def post_purge(
    archive_id: str,
    payload: PurgeRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=80),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.purge")),
) -> ArchiveJobSummary:
    try:
        return archive_service.queue_purge(db, session, archive_id, payload.confirmation, payload.reason, idempotency_key)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.get("/archives/{archive_id}/download")
def download_archive(
    archive_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.download")),
):
    try:
        row, path = archive_service.archive_download_path(db, session, archive_id)
    except ArchiveServiceError as exc:
        _raise(exc)
    return FileResponse(path=path, media_type="application/zip", filename=row.file_name)


@router.get("/archive-jobs/{job_id}", response_model=ArchiveJobSummary)
def get_archive_job(
    job_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("archive.view")),
) -> ArchiveJobSummary:
    try:
        return archive_service.get_job(db, session, job_id)
    except ArchiveServiceError as exc:
        _raise(exc)


@router.get("/events", response_model=AuditEventList)
def get_events(
    project_id: str | None = Query(default=None, max_length=36),
    customer_id: str | None = Query(default=None, max_length=36),
    entity: str | None = Query(default=None, max_length=60),
    event: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("events.view")),
) -> AuditEventList:
    try:
        return archive_service.list_events(
            db,
            session,
            project_id=project_id,
            customer_id=customer_id,
            entity=entity,
            event=event,
            page=page,
            page_size=page_size,
        )
    except ArchiveServiceError as exc:
        _raise(exc)
