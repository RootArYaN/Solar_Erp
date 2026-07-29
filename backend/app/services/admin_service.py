from datetime import UTC, datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.core.security import hash_password
from app.models.auth import Membership, Permission, Role, User
from app.models.system import AuthSession
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
from app.services.audit_service import write_event


PROTECTED_ROLE_CODES = {"company_admin", "super_admin"}
SUPER_ADMIN_ROLE_CODE = "super_admin"


class AdminServiceError(Exception):
    status_code = 400


class AdminNotFoundError(AdminServiceError):
    status_code = 404


class AdminConflictError(AdminServiceError):
    status_code = 409


class AdminForbiddenError(AdminServiceError):
    status_code = 403


def _is_super_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


def _role_permission_codes(role: Role) -> set[str]:
    return {permission.code for permission in role.permissions}


def _to_user_summary(membership: Membership) -> UserAdminSummary:
    return UserAdminSummary(
        id=membership.user.id,
        membership_id=membership.id,
        username=membership.user.username,
        email=membership.user.email,
        full_name=membership.user.full_name,
        is_active=membership.user.is_active and membership.is_active,
        is_super_admin=membership.user.is_super_admin,
        role=membership.role.code,
        created_at=membership.user.created_at,
    )


def _to_role_summary(role: Role, member_count: int | None = None) -> RoleSummary:
    return RoleSummary(
        id=role.id,
        name=role.name,
        code=role.code,
        description=role.description,
        is_system=role.is_system,
        permissions=sorted(_role_permission_codes(role)),
        member_count=member_count if member_count is not None else len(role.memberships),
    )


def _load_company_role(db: Session, company_id: str, role_code: str) -> Role:
    role = db.scalar(
        select(Role)
        .where(Role.company_id == company_id, Role.code == role_code)
        .options(selectinload(Role.permissions), selectinload(Role.memberships))
    )
    if not role:
        raise AdminNotFoundError(f"Unknown role: {role_code}")
    return role


def _load_role(db: Session, company_id: str, role_id: str) -> Role:
    role = db.scalar(
        select(Role)
        .where(Role.id == role_id, Role.company_id == company_id)
        .options(selectinload(Role.permissions), selectinload(Role.memberships))
    )
    if not role:
        raise AdminNotFoundError("Role not found")
    return role


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
        .options(
            selectinload(Membership.user),
            selectinload(Membership.role).selectinload(Role.permissions),
        )
    )
    if not membership:
        raise AdminNotFoundError("User membership not found")
    return membership


def _assert_permissions_grantable(actor: CurrentSession, permission_codes: set[str]) -> None:
    if _is_super_admin(actor):
        return
    unavailable = sorted(permission_codes - set(actor.permissions))
    if unavailable:
        raise AdminForbiddenError(
            f"You cannot grant permissions you do not have: {', '.join(unavailable)}"
        )


def _assert_role_manageable(actor: CurrentSession, role: Role) -> None:
    if _is_super_admin(actor):
        return
    if role.code in PROTECTED_ROLE_CODES:
        raise AdminForbiddenError("Only a super administrator can manage protected roles")
    _assert_permissions_grantable(actor, _role_permission_codes(role))


def _assert_role_assignable(actor: CurrentSession, role: Role) -> None:
    if _is_super_admin(actor):
        return
    if role.code in PROTECTED_ROLE_CODES:
        raise AdminForbiddenError("Only a super administrator can assign administrator roles")
    _assert_permissions_grantable(actor, _role_permission_codes(role))


def _assert_target_editable(actor: CurrentSession, target: Membership) -> None:
    if _is_super_admin(actor) or target.user_id == actor.user.id:
        return
    if target.user.is_super_admin or target.role.code in PROTECTED_ROLE_CODES:
        raise AdminForbiddenError("Only a super administrator can edit this user")
    _assert_permissions_grantable(actor, _role_permission_codes(target.role))


def _active_super_admin_count(db: Session, company_id: str) -> int:
    return int(db.scalar(
        select(func.count(Membership.id))
        .select_from(Membership)
        .join(User, Membership.user_id == User.id)
        .join(Role, Membership.role_id == Role.id)
        .where(
            Membership.company_id == company_id,
            Membership.is_active.is_(True),
            User.is_active.is_(True),
            User.is_super_admin.is_(True),
            Role.code == SUPER_ADMIN_ROLE_CODE,
        )
    ) or 0)


def _assert_not_last_super_admin(db: Session, target: Membership) -> None:
    is_active_super_admin = (
        target.is_active
        and target.user.is_active
        and target.user.is_super_admin
        and target.role.code == SUPER_ADMIN_ROLE_CODE
    )
    if is_active_super_admin and _active_super_admin_count(db, target.company_id) <= 1:
        raise AdminConflictError("At least one active super administrator must remain")


def list_users(db: Session, actor: CurrentSession, query: str | None = None) -> list[UserAdminSummary]:
    statement = (
        select(Membership)
        .join(Membership.user)
        .where(Membership.company_id == actor.membership.company_id)
        .options(
            selectinload(Membership.user),
            selectinload(Membership.role).selectinload(Role.permissions),
        )
        .order_by(User.full_name.asc())
    )
    if query and query.strip():
        term = f"%{query.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(User.full_name).like(term),
                func.lower(User.username).like(term),
                func.lower(User.email).like(term),
            )
        )
    return [_to_user_summary(membership) for membership in db.scalars(statement).all()]


def create_user(db: Session, actor: CurrentSession, payload: CreateUserRequest) -> UserAdminSummary:
    company_id = actor.membership.company_id
    role = _load_company_role(db, company_id, payload.role_code)
    _assert_role_assignable(actor, role)

    email = str(payload.email).strip().lower()
    if db.scalar(select(User).where(User.username == payload.username)):
        raise AdminConflictError("A user with this username already exists")
    if db.scalar(select(User).where(User.email == email)):
        raise AdminConflictError("A user with this email already exists")

    user = User(
        username=payload.username,
        email=email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_active=True,
        is_super_admin=role.code == SUPER_ADMIN_ROLE_CODE,
    )
    membership = Membership(
        company_id=company_id,
        user=user,
        role=role,
        is_active=payload.is_active,
    )
    db.add(membership)
    db.flush()
    if role.code == "agent":
        ensure_agent_profile(db, membership)
    write_event(
        db,
        company_id=company_id,
        event="user.created",
        entity="membership",
        entity_id=membership.id,
        actor=actor,
        changes={"username": user.username, "role": role.code, "is_active": membership.is_active},
    )
    db.commit()
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

    before = {
        "full_name": membership.user.full_name,
        "username": membership.user.username,
        "email": membership.user.email,
        "role": membership.role.code,
        "is_active": membership.is_active,
    }

    changing_role = payload.role_code is not None and payload.role_code != membership.role.code
    deactivating = payload.is_active is False and membership.is_active

    if deactivating and membership.user_id == actor.user.id:
        raise AdminForbiddenError("You cannot deactivate your own account")
    if changing_role and membership.user_id == actor.user.id:
        raise AdminForbiddenError("You cannot change your own role")
    if (deactivating or changing_role) and membership.role.code == SUPER_ADMIN_ROLE_CODE:
        _assert_not_last_super_admin(db, membership)

    if changing_role:
        next_role = _load_company_role(db, company_id, payload.role_code or "")
        _assert_role_assignable(actor, next_role)
        membership.role = next_role
        membership.user.is_super_admin = next_role.code == SUPER_ADMIN_ROLE_CODE
        if next_role.code == "agent":
            ensure_agent_profile(db, membership)

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        duplicate = db.scalar(select(User).where(User.email == email, User.id != membership.user_id))
        if duplicate:
            raise AdminConflictError("A user with this email already exists")
        membership.user.email = email

    if payload.username is not None:
        duplicate = db.scalar(
            select(User).where(
                User.username == payload.username,
                User.id != membership.user_id,
            )
        )
        if duplicate:
            raise AdminConflictError("A user with this username already exists")
        membership.user.username = payload.username

    if payload.full_name is not None:
        membership.user.full_name = payload.full_name

    if payload.is_active is not None:
        membership.is_active = payload.is_active

    after = {
        "full_name": membership.user.full_name,
        "username": membership.user.username,
        "email": membership.user.email,
        "role": membership.role.code,
        "is_active": membership.is_active,
    }
    write_event(
        db,
        company_id=company_id,
        event="user.updated",
        entity="membership",
        entity_id=membership.id,
        actor=actor,
        changes={"before": before, "after": after},
    )
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
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == membership.user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    write_event(
        db,
        company_id=membership.company_id,
        event="user.password_reset",
        entity="membership",
        entity_id=membership.id,
        actor=actor,
        changes={},
    )
    db.commit()


def list_permissions(db: Session, actor: CurrentSession) -> list[PermissionSummary]:
    statement = select(Permission)
    if not _is_super_admin(actor):
        statement = statement.where(Permission.code.in_(actor.permissions))
    permissions = db.scalars(statement.order_by(Permission.code.asc())).all()
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

    permission_codes = set(payload.permission_codes)
    _assert_permissions_grantable(actor, permission_codes)
    role = Role(
        company_id=actor.membership.company_id,
        name=payload.name,
        code=payload.code,
        description=payload.description,
        is_system=False,
    )
    role.permissions = _load_permissions(db, payload.permission_codes)
    db.add(role)
    db.flush()
    write_event(
        db,
        company_id=role.company_id,
        event="role.created",
        entity="role",
        entity_id=role.id,
        actor=actor,
        changes={"code": role.code, "permissions": sorted(permission_codes)},
    )
    db.commit()
    db.refresh(role)
    return _to_role_summary(role, 0)


def update_role(
    db: Session,
    actor: CurrentSession,
    role_id: str,
    payload: UpdateRoleRequest,
) -> RoleSummary:
    role = _load_role(db, actor.membership.company_id, role_id)
    _assert_role_manageable(actor, role)

    if role.code == SUPER_ADMIN_ROLE_CODE and payload.permission_codes is not None:
        requested = set(payload.permission_codes)
        current = _role_permission_codes(role)
        if requested != current:
            raise AdminForbiddenError("Super Admin permissions are unrestricted and cannot be reduced")

    before = {
        "name": role.name,
        "description": role.description,
        "permissions": sorted(_role_permission_codes(role)),
    }

    if payload.name is not None:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.permission_codes is not None and role.code != SUPER_ADMIN_ROLE_CODE:
        permission_codes = set(payload.permission_codes)
        _assert_permissions_grantable(actor, permission_codes)
        role.permissions = _load_permissions(db, payload.permission_codes)

    after = {
        "name": role.name,
        "description": role.description,
        "permissions": sorted(_role_permission_codes(role)),
    }
    write_event(
        db,
        company_id=role.company_id,
        event="role.updated",
        entity="role",
        entity_id=role.id,
        actor=actor,
        changes={"before": before, "after": after, "affected_users": len(role.memberships)},
    )
    db.commit()
    return _to_role_summary(role)


def delete_role(db: Session, actor: CurrentSession, role_id: str) -> None:
    role = _load_role(db, actor.membership.company_id, role_id)
    _assert_role_manageable(actor, role)
    if role.is_system:
        raise AdminForbiddenError("System roles cannot be deleted")
    if role.memberships:
        raise AdminConflictError("Remove this role from all users before deleting it")
    write_event(
        db,
        company_id=role.company_id,
        event="role.deleted",
        entity="role",
        entity_id=role.id,
        actor=actor,
        changes={"code": role.code},
    )
    db.delete(role)
    db.commit()
