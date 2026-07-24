from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, get_current_session
from app.db.session import get_db
from app.schemas.auth import CompanySummary, LoginRequest, MeResponse, SessionResponse, UserSummary
from app.services.auth_service import AuthenticationError, authenticate

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login", response_model=SessionResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> SessionResponse:
    try:
        return authenticate(db, payload)
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


@router.get("/me", response_model=MeResponse)
def me(session: CurrentSession = Depends(get_current_session)) -> MeResponse:
    return MeResponse(
        membership_id=session.membership.id,
        user=UserSummary(
            id=session.user.id,
            username=session.user.username,
            email=session.user.email,
            full_name=session.user.full_name,
        ),
        company=CompanySummary(
            id=session.membership.company.id,
            name=session.membership.company.name,
            code=session.membership.company.code,
        ),
        role=session.role,
        permissions=session.permissions,
    )
