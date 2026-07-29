from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions
from app.db.session import get_db
from app.schemas.customer_flow import (
    CustomerFlowList,
    CustomerFlowSnapshot,
    SaveMaterialDraftRequest,
    UpdateCustomerRequest,
)
from app.services import customer_flow_service
from app.services.customer_flow_service import CustomerFlowError


router = APIRouter(prefix="/customer-flow", tags=["customer-flow"])


def _raise_service_error(exc: CustomerFlowError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/customers", response_model=CustomerFlowList)
def list_customers(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.view", "documents.view")),
) -> CustomerFlowList:
    return customer_flow_service.list_customers(db, session, page=page, page_size=page_size)


@router.get("/customers/{customer_id}", response_model=CustomerFlowSnapshot)
def get_customer_snapshot(
    customer_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.view", "documents.view")),
) -> CustomerFlowSnapshot:
    try:
        return customer_flow_service.get_snapshot(db, session, customer_id)
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


