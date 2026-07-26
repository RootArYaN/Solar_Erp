from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, get_current_session, require_permissions
from app.core.config import settings
from app.core.rate_limit import check_login_limit, clear_login_limit
from app.db.session import get_db
from app.schemas.auth import ActiveDeviceSummary, CompanySummary, LoginRequest, MeResponse, SessionResponse, UserSummary
from app.services import auth_service
from app.services.auth_service import AuthenticationError

router = APIRouter(prefix="/auth", tags=["authentication"])


def _ip_hint(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    address = forwarded or (request.client.host if request.client else "")
    if not address:
        return ""
    if ":" in address:
        return address.split(":")[0] + ":*"
    parts = address.split(".")
    return ".".join(parts[:3] + ["*"]) if len(parts) == 4 else address


def _set_refresh_cookie(response: Response, token: str, persistent: bool) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/api/v1/auth",
        max_age=int(timedelta(days=settings.refresh_token_days).total_seconds()) if persistent else None,
    )


@router.post("/login", response_model=SessionResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> SessionResponse:
    limit_key = f"{_ip_hint(request)}:{payload.username}"
    check_login_limit(limit_key)
    try:
        session, refresh_token, auth_session = auth_service.authenticate(
            db,
            payload,
            user_agent=request.headers.get("user-agent", "")[:400],
            ip_hint=_ip_hint(request),
        )
    except AuthenticationError as exc:
        auth_service.record_login_failure(db, payload.username, _ip_hint(request))
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    clear_login_limit(limit_key)
    _set_refresh_cookie(response, refresh_token, auth_session.persistent)
    return session


@router.post("/refresh", response_model=SessionResponse)
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
    db: Session = Depends(get_db),
) -> SessionResponse:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session not found")
    try:
        session, next_token, auth_session = auth_service.refresh_session(db, refresh_token)
    except AuthenticationError as exc:
        response.delete_cookie(settings.session_cookie_name, path="/api/v1/auth")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    _set_refresh_cookie(response, next_token, auth_session.persistent)
    return session


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session: CurrentSession = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> Response:
    auth_service.revoke_session(db, session.auth_session_id)
    response.delete_cookie(settings.session_cookie_name, path="/api/v1/auth")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=MeResponse)
def me(session: CurrentSession = Depends(get_current_session)) -> MeResponse:
    return MeResponse(
        membership_id=session.membership.id,
        user=UserSummary(
            id=session.user.id,
            username=session.user.username,
            email=session.user.email,
            full_name=session.user.full_name,
            is_super_admin=session.user.is_super_admin,
        ),
        company=CompanySummary(
            id=session.membership.company.id,
            name=session.membership.company.name,
            code=session.membership.company.code,
        ),
        role=session.role,
        permissions=session.permissions,
    )


@router.get("/devices", response_model=list[ActiveDeviceSummary])
def devices(
    session: CurrentSession = Depends(require_permissions("security.sessions.view")),
    db: Session = Depends(get_db),
) -> list[ActiveDeviceSummary]:
    return auth_service.list_devices(db, session.membership.id, session.auth_session_id)


@router.delete("/devices/others", status_code=status.HTTP_204_NO_CONTENT)
def remove_other_devices(
    session: CurrentSession = Depends(require_permissions("security.sessions.manage")),
    db: Session = Depends(get_db),
) -> Response:
    auth_service.revoke_other_devices(db, session.membership.id, session.auth_session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
