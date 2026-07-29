from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, get_current_session, require_any_permissions
from app.core.config import settings
from app.db.session import get_db
from app.schemas.files import DocumentCustomerOption, StoredFileList, StoredFileSummary
from app.services import file_service
from app.services.audit_service import write_event
from app.services.file_service import FileServiceError
from app.services.storage import storage

router = APIRouter(prefix="/files", tags=["files"])


def _raise(exc: FileServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/customer-options", response_model=list[DocumentCustomerOption])
def get_customer_options(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("documents.view", "documents.manage")),
) -> list[DocumentCustomerOption]:
    return file_service.list_document_customers(db, session)


@router.get("", response_model=StoredFileList)
def get_files(
    owner_type: str | None = Query(default=None, max_length=40),
    owner_id: str | None = Query(default=None, max_length=80),
    project_id: str | None = Query(default=None, max_length=36),
    customer_id: str | None = Query(default=None, max_length=36),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(get_current_session),
) -> StoredFileList:
    try:
        return file_service.list_files(
            db,
            session,
            owner_type=owner_type,
            owner_id=owner_id,
            project_id=project_id,
            customer_id=customer_id,
            page=page,
            page_size=page_size,
        )
    except FileServiceError as exc:
        _raise(exc)


@router.post("", response_model=StoredFileSummary, status_code=201)
async def post_file(
    upload: UploadFile = File(...),
    owner_type: str = Form(..., max_length=40),
    owner_id: str = Form(..., max_length=80),
    project_id: str | None = Form(default=None),
    customer_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(get_current_session),
) -> StoredFileSummary:
    try:
        return await file_service.save_file(
            db,
            session,
            upload,
            owner_type=owner_type,
            owner_id=owner_id,
            project_id=project_id or None,
            customer_id=customer_id or None,
        )
    except FileServiceError as exc:
        _raise(exc)


@router.get("/{file_id}/download")
def download_file(
    file_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(get_current_session),
):
    try:
        row = file_service.get_file(db, session, file_id)
        file_service.ensure_file_permission(session, row.owner_type, "view")
    except FileServiceError as exc:
        _raise(exc)
    path = storage.path(row.storage_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored file is missing")
    write_event(
        db,
        company_id=row.company_id,
        event="poster.downloaded" if row.owner_type == "poster" else "document.downloaded",
        entity="stored_file",
        entity_id=row.id,
        actor=session,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={"name": row.name},
    )
    db.commit()
    return FileResponse(path=path, media_type=row.mime_type, filename=row.name, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/{file_id}", status_code=204)
def delete_file(
    file_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(get_current_session),
) -> Response:
    try:
        file_service.delete_file(db, session, file_id)
    except FileServiceError as exc:
        _raise(exc)
    return Response(status_code=204)
