from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions, require_super_admin
from app.db.session import get_db
from app.schemas.customer_flow import (
    CustomerFlowList,
    CustomerFlowSnapshot,
    CustomerDependencyPreview,
    CustomerLifecycleRequest,
    SaveMaterialDraftRequest,
    UpdateCustomerRequest,
)
from app.services import customer_flow_service
from app.services.customer_flow_service import CustomerFlowError
from app.services import customer_lifecycle_service
from app.services.customer_lifecycle_service import CustomerLifecycleError


router = APIRouter(prefix="/customer-flow", tags=["customer-flow"])


def _raise_service_error(exc: CustomerFlowError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/customers", response_model=CustomerFlowList)
def list_customers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    status: str | None = Query(default=None, max_length=32),
    query: str | None = Query(default=None, max_length=160),
    payment_mode: str | None = Query(default=None, max_length=24),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.view", "documents.view")),
) -> CustomerFlowList:
    try:
        return customer_flow_service.list_customers(
            db,
            session,
            page=page,
            page_size=page_size,
            status=status,
            query=query,
            payment_mode=payment_mode,
        )
    except CustomerFlowError as exc:
        _raise_service_error(exc)


@router.get("/customers/{customer_id}", response_model=CustomerFlowSnapshot)
def get_customer_snapshot(
    customer_id: str,
    sections: str | None = Query(default=None, max_length=160),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.view", "documents.view")),
) -> CustomerFlowSnapshot:
    try:
        requested_sections = {part.strip().lower() for part in (sections or "overview").split(",") if part.strip()}
        return customer_flow_service.get_snapshot(db, session, customer_id, sections=requested_sections)
    except CustomerFlowError as exc:
        _raise_service_error(exc)


@router.patch("/customers/{customer_id}", response_model=CustomerFlowSnapshot)
def patch_customer(
    customer_id: str,
    payload: UpdateCustomerRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.edit", "agents.manage")),
) -> CustomerFlowSnapshot:
    try:
        return customer_flow_service.update_customer(db, session, customer_id, payload)
    except CustomerFlowError as exc:
        _raise_service_error(exc)


@router.put("/customers/{customer_id}/material-request", response_model=CustomerFlowSnapshot)
def save_material_request_draft(
    customer_id: str,
    payload: SaveMaterialDraftRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("material_requests.create", "material_requests.edit")),
) -> CustomerFlowSnapshot:
    try:
        return customer_flow_service.save_material_draft(db, session, customer_id, payload)
    except CustomerFlowError as exc:
        _raise_service_error(exc)


def _raise_lifecycle_error(exc: CustomerLifecycleError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get(
    "/customers/{customer_id}/dependency-preview",
    response_model=CustomerDependencyPreview,
)
def get_customer_dependency_preview(
    customer_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
) -> CustomerDependencyPreview:
    try:
        return customer_lifecycle_service.dependency_preview(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.post("/customers/{customer_id}/complete", response_model=CustomerFlowSnapshot)
def complete_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.edit", "agents.manage")),
) -> CustomerFlowSnapshot:
    try:
        customer_lifecycle_service.complete_customer(
            db,
            session,
            customer_id,
            reason=payload.reason,
            force=payload.force,
        )
        return customer_flow_service.get_snapshot(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.post("/customers/{customer_id}/reactivate", response_model=CustomerFlowSnapshot)
def reactivate_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.edit", "agents.manage")),
) -> CustomerFlowSnapshot:
    try:
        customer_lifecycle_service.reactivate_customer(
            db,
            session,
            customer_id,
            reason=payload.reason,
        )
        return customer_flow_service.get_snapshot(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.post("/customers/{customer_id}/archive", response_model=CustomerDependencyPreview)
def archive_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
) -> CustomerDependencyPreview:
    try:
        customer_lifecycle_service.archive_customer(db, session, customer_id, reason=payload.reason)
        return customer_lifecycle_service.dependency_preview(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.delete("/customers/{customer_id}", response_model=CustomerDependencyPreview)
def delete_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
) -> CustomerDependencyPreview:
    try:
        customer_lifecycle_service.soft_delete_customer(db, session, customer_id, reason=payload.reason)
        return customer_lifecycle_service.dependency_preview(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.post("/customers/{customer_id}/restore", response_model=CustomerFlowSnapshot)
def restore_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
) -> CustomerFlowSnapshot:
    try:
        customer_lifecycle_service.restore_customer(db, session, customer_id, reason=payload.reason)
        return customer_flow_service.get_snapshot(db, session, customer_id)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


@router.delete("/customers/{customer_id}/purge", status_code=204)
def purge_customer(
    customer_id: str,
    payload: CustomerLifecycleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_super_admin),
) -> None:
    try:
        customer_lifecycle_service.purge_customer(db, session, customer_id, reason=payload.reason)
    except CustomerLifecycleError as exc:
        _raise_lifecycle_error(exc)


