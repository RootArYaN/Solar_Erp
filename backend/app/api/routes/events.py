from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_permissions
from app.core.config import settings
from app.db.session import get_db
from app.schemas.audit import AuditEventList
from app.services import audit_service
from app.services.audit_service import AuditServiceError

router = APIRouter(tags=["events"])


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
        return audit_service.list_events(
            db,
            session,
            project_id=project_id,
            customer_id=customer_id,
            entity=entity,
            event=event,
            page=page,
            page_size=page_size,
        )
    except AuditServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
