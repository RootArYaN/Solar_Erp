from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import create_access_token, verify_password
from app.models.auth import Company, Membership, Role, User
from app.schemas.auth import CompanySummary, LoginRequest, SessionResponse, UserSummary


class AuthenticationError(Exception):
    pass


def authenticate(db: Session, payload: LoginRequest) -> SessionResponse:
    statement = (
        select(User)
        .where(User.username == payload.username)
        .options(
            selectinload(User.memberships)
            .selectinload(Membership.role)
            .selectinload(Role.permissions),
            selectinload(User.memberships).selectinload(Membership.company),
        )
    )
    user = db.scalar(statement)

    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        raise AuthenticationError("Invalid username or password")

    memberships = [
        membership
        for membership in user.memberships
        if membership.is_active and membership.company.is_active
    ]

    if not memberships:
        raise AuthenticationError("No active company access found")

    membership = memberships[0]
    role_code = membership.role.code
    permission_codes = sorted({permission.code for permission in membership.role.permissions})

    token, expires_at = create_access_token(
        subject=user.id,
        claims={
            "membership_id": membership.id,
            "company_id": membership.company.id,
            "role": role_code,
            "permissions": permission_codes,
        },
    )

    return SessionResponse(
        access_token=token,
        expires_at=expires_at,
        membership_id=membership.id,
        user=UserSummary(
            id=user.id,
            username=user.username,
            email=user.email,
            full_name=user.full_name,
        ),
        company=CompanySummary(
            id=membership.company.id,
            name=membership.company.name,
            code=membership.company.code,
        ),
        role=role_code,
        permissions=permission_codes,
    )
