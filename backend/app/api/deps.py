from dataclasses import dataclass
from datetime import UTC, datetime

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import decode_access_token
from app.core.time import as_utc
from app.db.session import get_db
from app.models.auth import Membership, Role, User
from app.models.system import AuthSession

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentSession:
    user: User
    membership: Membership
    role: str
    permissions: list[str]
    auth_session_id: str


def get_current_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentSession:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials:
        raise unauthorized

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = payload.get("sub")
        membership_id = payload.get("membership_id")
        auth_session_id = payload.get("auth_session_id")
        if not user_id or not membership_id or not auth_session_id:
            raise unauthorized
    except jwt.PyJWTError as exc:
        raise unauthorized from exc

    auth_session = db.get(AuthSession, auth_session_id)
    now = datetime.now(UTC)
    if (
        not auth_session
        or auth_session.user_id != user_id
        or auth_session.membership_id != membership_id
        or auth_session.revoked_at is not None
        or as_utc(auth_session.expires_at) <= now
    ):
        raise unauthorized

    membership = db.scalar(
        select(Membership)
        .where(Membership.id == membership_id, Membership.user_id == user_id)
        .options(
            selectinload(Membership.user),
            selectinload(Membership.company),
            selectinload(Membership.role).selectinload(Role.permissions),
        )
    )
    if not membership or not membership.is_active or not membership.user.is_active or not membership.company.is_active:
        raise unauthorized

    role = membership.role.code
    permissions = sorted({permission.code for permission in membership.role.permissions})
    return CurrentSession(
        user=membership.user,
        membership=membership,
        role=role,
        permissions=permissions,
        auth_session_id=auth_session_id,
    )


def require_permissions(*required_permissions: str):
    def dependency(session: CurrentSession = Depends(get_current_session)) -> CurrentSession:
        missing = set(required_permissions) - set(session.permissions)
        if missing and not session.user.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(sorted(missing))}",
            )
        return session

    return dependency


def require_any_permissions(*allowed_permissions: str):
    def dependency(session: CurrentSession = Depends(get_current_session)) -> CurrentSession:
        if allowed_permissions and not set(allowed_permissions).intersection(session.permissions) and not session.user.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(sorted(allowed_permissions))}",
            )
        return session

    return dependency
