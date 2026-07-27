from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions, require_permissions
from app.db.session import get_db
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
from app.services import admin_service
from app.services.admin_service import AdminServiceError

router = APIRouter(prefix="/admin", tags=["administration"])


def _raise_service_error(exc: AdminServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/users", response_model=list[UserAdminSummary])
def get_users(
    q: str | None = Query(default=None, max_length=120),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("users.view")),
) -> list[UserAdminSummary]:
    return admin_service.list_users(db, session, q)


@router.post("/users", response_model=UserAdminSummary, status_code=status.HTTP_201_CREATED)
def post_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("users.manage")),
) -> UserAdminSummary:
    try:
        return admin_service.create_user(db, session, payload)
    except AdminServiceError as exc:
        _raise_service_error(exc)


@router.patch("/users/{membership_id}", response_model=UserAdminSummary)
def patch_user(
    membership_id: str,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("users.manage")),
) -> UserAdminSummary:
    try:
        return admin_service.update_user(db, session, membership_id, payload)
    except AdminServiceError as exc:
        _raise_service_error(exc)


@router.post("/users/{membership_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def post_reset_password(
    membership_id: str,
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("users.manage")),
) -> Response:
    try:
        admin_service.reset_user_password(db, session, membership_id, payload)
    except AdminServiceError as exc:
        _raise_service_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/permissions", response_model=list[PermissionSummary])
def get_permissions(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("roles.view")),
) -> list[PermissionSummary]:
    return admin_service.list_permissions(db, session)


@router.get("/roles", response_model=list[RoleSummary])
def get_roles(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("users.view", "roles.view")),
) -> list[RoleSummary]:
    return admin_service.list_roles(db, session)


@router.post("/roles", response_model=RoleSummary, status_code=status.HTTP_201_CREATED)
def post_role(
    payload: CreateRoleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("roles.manage")),
) -> RoleSummary:
    try:
        return admin_service.create_role(db, session, payload)
    except AdminServiceError as exc:
        _raise_service_error(exc)


@router.patch("/roles/{role_id}", response_model=RoleSummary)
def patch_role(
    role_id: str,
    payload: UpdateRoleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("roles.manage")),
) -> RoleSummary:
    try:
        return admin_service.update_role(db, session, role_id, payload)
    except AdminServiceError as exc:
        _raise_service_error(exc)


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_role(
    role_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("roles.manage")),
) -> Response:
    try:
        admin_service.delete_role(db, session, role_id)
    except AdminServiceError as exc:
        _raise_service_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
