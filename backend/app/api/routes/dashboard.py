from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions
from app.db.session import get_db
from app.schemas.dashboard import DashboardSummary
from app.services.dashboard_service import get_summary

router = APIRouter(prefix='/dashboard', tags=['dashboard'])


@router.get('/summary', response_model=DashboardSummary)
def summary(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('dashboard.view'))):
    return get_summary(db, session)
