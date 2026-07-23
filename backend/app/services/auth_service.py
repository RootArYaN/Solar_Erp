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
        .where(User.email == payload.email.lower())
        .options(
            selectinload(User.memberships)
            .selectinload(Membership.roles)
            .selectinload(Role.permissions),
            selectinload(User.memberships).selectinload(Membership.company),
        )
    )
    user = db.scalar(statement)

    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        raise AuthenticationError("Invalid email or password")

    memberships = [
        membership
        for membership in user.memberships
        if membership.is_active and membership.company.is_active
    ]

    if payload.company_code:
        company_code = payload.company_code.strip().upper()
        memberships = [m for m in memberships if m.company.code.upper() == company_code]

    if not memberships:
        raise AuthenticationError("No active company access found")

    membership = memberships[0]
    role_codes = sorted({role.code for role in membership.roles})
    permission_codes = sorted(
        {permission.code for role in membership.roles for permission in role.permissions}
    )

    token, expires_at = create_access_token(
        subject=user.id,
        claims={
            "membership_id": membership.id,
            "company_id": membership.company.id,
            "roles": role_codes,
            "permissions": permission_codes,
        },
    )

    return SessionResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserSummary(id=user.id, email=user.email, full_name=user.full_name),
        company=CompanySummary(
            id=membership.company.id,
            name=membership.company.name,
            code=membership.company.code,
        ),
        roles=role_codes,
        permissions=permission_codes,
    )
