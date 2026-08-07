from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, get_current_session
from app.db.session import get_db
from app.schemas.notifications import WorkspaceNotificationSummary
from app.services.notifications_service import notification_summary

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/summary", response_model=WorkspaceNotificationSummary)
def get_notification_summary(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(get_current_session),
) -> WorkspaceNotificationSummary:
    return notification_summary(db, session)
