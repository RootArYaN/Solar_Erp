from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions
from app.db.session import get_db
from app.schemas.workflow import (
    ApprovalCenterResponse,
    ApprovalDecisionRequest,
    CreateQuotationRequest,
    GenerateQuotationRequest,
    ProjectPaymentModeRequest,
    ProjectTimelineListItem,
    ProjectTimelineResponse,
    ProjectTimelineUpdateRequest,
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
    quotation_limit: int = Query(default=50, ge=1, le=100),
    transaction_limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions(
        "quotations.approve", "agents.transactions.approve", "finance.manage"
    )),
) -> ApprovalCenterResponse:
    try:
        return workflow_service.get_approval_center(
            db,
            session,
            quotation_limit=quotation_limit,
            transaction_limit=transaction_limit,
        )
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


@router.get("/projects/timelines", response_model=list[ProjectTimelineListItem])
def list_project_timelines(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("projects.view")),
) -> list[ProjectTimelineListItem]:
    try:
        return workflow_service.list_project_timelines(db, session, page=page, page_size=page_size)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.get("/projects/{project_id}/timeline", response_model=ProjectTimelineResponse)
def get_project_timeline(
    project_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("projects.view")),
) -> ProjectTimelineResponse:
    try:
        return workflow_service.get_project_timeline(db, session, project_id)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.patch("/projects/{project_id}/payment-mode", response_model=ProjectTimelineResponse)
def set_project_payment_mode(
    project_id: str,
    payload: ProjectPaymentModeRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("projects.view")),
) -> ProjectTimelineResponse:
    try:
        return workflow_service.set_project_payment_mode(db, session, project_id, payload.payment_mode)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)


@router.patch("/projects/{project_id}/timeline/{step_key}", response_model=ProjectTimelineResponse)
def update_project_timeline_step(
    project_id: str,
    step_key: str,
    payload: ProjectTimelineUpdateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("projects.view")),
) -> ProjectTimelineResponse:
    try:
        return workflow_service.update_project_timeline_step(db, session, project_id, step_key, payload)
    except WorkflowServiceError as exc:
        _raise_service_error(exc)
