from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions
from app.db.session import get_db
from app.schemas.workflow import (
    ApprovalCenterResponse,
    ApprovalDecisionRequest,
    CreateQuotationRequest,
    GenerateQuotationRequest,
    QuotationRequestSummary,
    TransactionApprovalSummary,
)
from app.services import workflow_service
from app.services.workflow_service import WorkflowServiceError

router = APIRouter(prefix="/workflow", tags=["workflow"])


def _raise_service_error(exc: WorkflowServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/approvals", response_model=ApprovalCenterResponse)
def get_approval_center(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions(
        "quotations.approve", "agents.transactions.approve", "finance.manage"
    )),
) -> ApprovalCenterResponse:
    try:
        return workflow_service.get_approval_center(db, session)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.post("/customers/{customer_id}/quotation-requests", response_model=QuotationRequestSummary, status_code=201)
def create_quotation_request(
    customer_id: str,
    payload: CreateQuotationRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("quotations.create", "quotations.approve")),
) -> QuotationRequestSummary:
    try:
        return workflow_service.create_quotation_request(db, session, customer_id, payload)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.post("/quotation-requests/{request_id}/quotation", response_model=QuotationRequestSummary)
def generate_quotation(
    request_id: str,
    payload: GenerateQuotationRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("quotations.approve")),
) -> QuotationRequestSummary:
    try:
        return workflow_service.generate_quotation(db, session, request_id, payload)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.post("/quotations/{quotation_id}/decision", response_model=QuotationRequestSummary)
def decide_quotation(
    quotation_id: str,
    payload: ApprovalDecisionRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("quotations.approve")),
) -> QuotationRequestSummary:
    try:
        return workflow_service.decide_quotation(db, session, quotation_id, payload)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.post("/transactions/{approval_id}/decision", response_model=TransactionApprovalSummary)
def decide_transaction(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("agents.transactions.approve", "finance.manage")),
) -> TransactionApprovalSummary:
    try:
        return workflow_service.decide_transaction(db, session, approval_id, payload)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)
