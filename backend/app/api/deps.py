from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.auth import Membership, Role, User

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentSession:
    user: User
    membership: Membership
    roles: list[str]
    permissions: list[str]


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
        if not user_id or not membership_id:
            raise unauthorized
    except jwt.PyJWTError as exc:
        raise unauthorized from exc

    statement = (
        select(Membership)
        .where(Membership.id == membership_id, Membership.user_id == user_id)
        .options(
            selectinload(Membership.user),
            selectinload(Membership.company),
            selectinload(Membership.roles).selectinload(Role.permissions),
        )
    )
    membership = db.scalar(statement)

    if (
        not membership
        or not membership.is_active
        or not membership.user.is_active
        or not membership.company.is_active
    ):
        raise unauthorized

    roles = sorted({role.code for role in membership.roles})
    permissions = sorted({permission.code for role in membership.roles for permission in role.permissions})

    return CurrentSession(
        user=membership.user,
        membership=membership,
        roles=roles,
        permissions=permissions,
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
        if (
            allowed_permissions
            and not set(allowed_permissions).intersection(session.permissions)
            and not session.user.is_super_admin
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(sorted(allowed_permissions))}",
            )
        return session

    return dependency
