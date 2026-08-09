from dataclasses import dataclass
from datetime import UTC, datetime

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, load_only

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.auth import Company, Membership, Permission, Role, User
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
    request: Request,
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
        cached_token = getattr(request.state, "access_token", "")
        cached_claims = getattr(request.state, "access_claims", None)
        payload = (
            cached_claims
            if cached_token == credentials.credentials and isinstance(cached_claims, dict)
            else decode_access_token(credentials.credentials)
        )
        user_id = payload.get("sub")
        membership_id = payload.get("membership_id")
        auth_session_id = payload.get("auth_session_id")
        if not user_id or not membership_id or not auth_session_id:
            raise unauthorized
    except jwt.PyJWTError as exc:
        raise unauthorized from exc

    now = datetime.now(UTC)
    membership = db.scalar(
        select(Membership)
        .join(AuthSession, AuthSession.membership_id == Membership.id)
        .where(
            AuthSession.id == auth_session_id,
            AuthSession.user_id == user_id,
            AuthSession.membership_id == membership_id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
            Membership.id == membership_id,
            Membership.user_id == user_id,
        )
        .options(
            load_only(
                Membership.id,
                Membership.user_id,
                Membership.company_id,
                Membership.role_id,
                Membership.is_active,
            ),
            joinedload(Membership.user).load_only(
                User.id,
                User.username,
                User.email,
                User.full_name,
                User.is_active,
                User.is_super_admin,
            ),
            joinedload(Membership.company).load_only(
                Company.id,
                Company.name,
                Company.code,
                Company.is_active,
            ),
            joinedload(Membership.role)
            .load_only(Role.id, Role.code)
            .selectinload(Role.permissions)
            .load_only(Permission.code),
        )
    )
    if membership is None:
        raise unauthorized

    if not membership.is_active or not membership.user.is_active or not membership.company.is_active:
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
    required = frozenset(required_permissions)

    def dependency(session: CurrentSession = Depends(get_current_session)) -> CurrentSession:
        missing = required.difference(session.permissions)
        if missing and not session.user.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permissions: {', '.join(sorted(missing))}",
            )
        return session

    return dependency


def require_any_permissions(*allowed_permissions: str):
    allowed = frozenset(allowed_permissions)

    def dependency(session: CurrentSession = Depends(get_current_session)) -> CurrentSession:
        if allowed and allowed.isdisjoint(session.permissions) and not session.user.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(sorted(allowed))}",
            )
        return session

    return dependency


def require_super_admin(
    session: CurrentSession = Depends(get_current_session),
) -> CurrentSession:
    """Backend-authoritative guard for destructive/recovery operations."""
    if not session.user.is_super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super administrator access required",
        )
    return session
