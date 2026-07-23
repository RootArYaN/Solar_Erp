from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.core.security import hash_password
from app.models.auth import Membership, Permission, Role, User
from app.schemas.admin import (
    CreateRoleRequest,
    CreateUserRequest,
    PermissionSummary,
    ResetPasswordRequest,
    RoleSummary,
    UpdateRoleRequest,
    UpdateUserRequest,
    UserAdminSummary,
)
from app.services.agent_service import ensure_agent_profile


class AdminServiceError(Exception):
    status_code = 400


class AdminNotFoundError(AdminServiceError):
    status_code = 404


class AdminConflictError(AdminServiceError):
    status_code = 409


class AdminForbiddenError(AdminServiceError):
    status_code = 403


def _role_codes(membership: Membership) -> list[str]:
    return sorted({role.code for role in membership.roles})


def _to_user_summary(membership: Membership) -> UserAdminSummary:
    return UserAdminSummary(
        id=membership.user.id,
        membership_id=membership.id,
        email=membership.user.email,
        full_name=membership.user.full_name,
        is_active=membership.user.is_active and membership.is_active,
        is_super_admin=membership.user.is_super_admin,
        roles=_role_codes(membership),
        created_at=membership.user.created_at,
    )


def _to_role_summary(role: Role, member_count: int | None = None) -> RoleSummary:
    return RoleSummary(
        id=role.id,
        name=role.name,
        code=role.code,
        description=role.description,
        is_system=role.is_system,
        permissions=sorted(permission.code for permission in role.permissions),
        member_count=member_count if member_count is not None else len(role.memberships),
    )


def _load_company_roles(db: Session, company_id: str, role_codes: list[str]) -> list[Role]:
    roles = list(
        db.scalars(
            select(Role)
            .where(Role.company_id == company_id, Role.code.in_(role_codes))
            .options(selectinload(Role.permissions))
        ).all()
    )
    found = {role.code for role in roles}
    missing = sorted(set(role_codes) - found)
    if missing:
        raise AdminNotFoundError(f"Unknown roles: {', '.join(missing)}")
    return roles


def _load_permissions(db: Session, permission_codes: list[str]) -> list[Permission]:
    if not permission_codes:
        return []
    permissions = list(db.scalars(select(Permission).where(Permission.code.in_(permission_codes))).all())
    found = {permission.code for permission in permissions}
    missing = sorted(set(permission_codes) - found)
    if missing:
        raise AdminNotFoundError(f"Unknown permissions: {', '.join(missing)}")
    return permissions


def _get_membership(db: Session, company_id: str, membership_id: str) -> Membership:
    membership = db.scalar(
        select(Membership)
        .where(Membership.id == membership_id, Membership.company_id == company_id)
        .options(selectinload(Membership.user), selectinload(Membership.roles))
    )
    if not membership:
        raise AdminNotFoundError("User membership not found")
    return membership


def _assert_super_admin_change_allowed(actor: CurrentSession, role_codes: list[str]) -> None:
    if "super_admin" in role_codes and not actor.user.is_super_admin:
        raise AdminForbiddenError("Only a super administrator can assign the super admin role")


def _assert_target_editable(actor: CurrentSession, target: Membership) -> None:
    if target.user.is_super_admin and not actor.user.is_super_admin:
        raise AdminForbiddenError("Only a super administrator can edit this user")


def list_users(db: Session, actor: CurrentSession, query: str | None = None) -> list[UserAdminSummary]:
    statement = (
        select(Membership)
        .join(Membership.user)
        .where(Membership.company_id == actor.membership.company_id)
        .options(selectinload(Membership.user), selectinload(Membership.roles))
        .order_by(User.full_name.asc())
    )
    if query and query.strip():
        term = f"%{query.strip().lower()}%"
        statement = statement.where(
            or_(func.lower(User.full_name).like(term), func.lower(User.email).like(term))
        )
    return [_to_user_summary(membership) for membership in db.scalars(statement).all()]


def create_user(db: Session, actor: CurrentSession, payload: CreateUserRequest) -> UserAdminSummary:
    company_id = actor.membership.company_id
    _assert_super_admin_change_allowed(actor, payload.role_codes)
    roles = _load_company_roles(db, company_id, payload.role_codes)

    email = str(payload.email).strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise AdminConflictError("A user with this email already exists")

    user = User(
        email=email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_active=True,
        is_super_admin="super_admin" in payload.role_codes,
    )
    membership = Membership(company_id=company_id, user=user, is_active=payload.is_active)
    membership.roles = roles
    db.add(membership)
    db.flush()
    if "agent" in payload.role_codes:
        ensure_agent_profile(db, membership)
    db.commit()
    db.refresh(membership)
    return _to_user_summary(_get_membership(db, company_id, membership.id))


def update_user(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: UpdateUserRequest,
) -> UserAdminSummary:
    company_id = actor.membership.company_id
    membership = _get_membership(db, company_id, membership_id)
    _assert_target_editable(actor, membership)

    if payload.is_active is False and membership.user_id == actor.user.id:
        raise AdminForbiddenError("You cannot deactivate your own account")

    if payload.role_codes is not None:
        if membership.user_id == actor.user.id:
            raise AdminForbiddenError("You cannot change your own roles")
        _assert_super_admin_change_allowed(actor, payload.role_codes)
        membership.roles = _load_company_roles(db, company_id, payload.role_codes)
        membership.user.is_super_admin = "super_admin" in payload.role_codes
        if "agent" in payload.role_codes:
            ensure_agent_profile(db, membership)

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        duplicate = db.scalar(select(User).where(User.email == email, User.id != membership.user_id))
        if duplicate:
            raise AdminConflictError("A user with this email already exists")
        membership.user.email = email

    if payload.full_name is not None:
        membership.user.full_name = payload.full_name

    if payload.is_active is not None:
        membership.is_active = payload.is_active

    db.commit()
    return _to_user_summary(_get_membership(db, company_id, membership.id))


def reset_user_password(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: ResetPasswordRequest,
) -> None:
    membership = _get_membership(db, actor.membership.company_id, membership_id)
    _assert_target_editable(actor, membership)
    membership.user.hashed_password = hash_password(payload.new_password)
    db.commit()


def list_permissions(db: Session) -> list[PermissionSummary]:
    permissions = db.scalars(select(Permission).order_by(Permission.code.asc())).all()
    return [
        PermissionSummary(
            id=permission.id,
            code=permission.code,
            name=permission.name,
            description=permission.description,
        )
        for permission in permissions
    ]


def list_roles(db: Session, actor: CurrentSession) -> list[RoleSummary]:
    roles = db.scalars(
        select(Role)
        .where(Role.company_id == actor.membership.company_id)
        .options(selectinload(Role.permissions), selectinload(Role.memberships))
        .order_by(Role.is_system.desc(), Role.name.asc())
    ).all()
    return [_to_role_summary(role) for role in roles]


def create_role(db: Session, actor: CurrentSession, payload: CreateRoleRequest) -> RoleSummary:
    duplicate = db.scalar(
        select(Role).where(
            Role.company_id == actor.membership.company_id,
            Role.code == payload.code,
        )
    )
    if duplicate:
        raise AdminConflictError("A role with this code already exists")

    role = Role(
        company_id=actor.membership.company_id,
        name=payload.name,
        code=payload.code,
        description=payload.description,
        is_system=False,
    )
    role.permissions = _load_permissions(db, payload.permission_codes)
    db.add(role)
    db.commit()
    db.refresh(role)
    return _to_role_summary(role, 0)


def update_role(
    db: Session,
    actor: CurrentSession,
    role_id: str,
    payload: UpdateRoleRequest,
) -> RoleSummary:
    role = db.scalar(
        select(Role)
        .where(Role.id == role_id, Role.company_id == actor.membership.company_id)
        .options(selectinload(Role.permissions), selectinload(Role.memberships))
    )
    if not role:
        raise AdminNotFoundError("Role not found")
    if role.code in {"company_admin", "super_admin"}:
        raise AdminForbiddenError("Full-access administrator roles are protected")

    if payload.name is not None:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.permission_codes is not None:
        role.permissions = _load_permissions(db, payload.permission_codes)

    db.commit()
    return _to_role_summary(role)


def delete_role(db: Session, actor: CurrentSession, role_id: str) -> None:
    role = db.scalar(
        select(Role)
        .where(Role.id == role_id, Role.company_id == actor.membership.company_id)
        .options(selectinload(Role.memberships))
    )
    if not role:
        raise AdminNotFoundError("Role not found")
    if role.is_system:
        raise AdminForbiddenError("System roles cannot be deleted")
    if role.memberships:
        raise AdminConflictError("Remove this role from all users before deleting it")
    db.delete(role)
    db.commit()
