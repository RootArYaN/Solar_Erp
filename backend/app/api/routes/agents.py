from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions, require_permissions
from app.db.session import get_db
from app.schemas.agent import (
    AgentListItem,
    AgentOverviewResponse,
    AgentTransactionSummary,
    CreateAgentCustomerRequest,
    CreateAgentTransactionRequest,
    UpdateAgentProfileRequest,
    UpdateAgentCustomerRequest,
    UpdateAgentTransactionRequest,
)
from app.services import agent_service
from app.services.agent_service import AgentServiceError

router = APIRouter(prefix="/agents", tags=["agents"])


def _raise_service_error(exc: AgentServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("", response_model=list[AgentListItem])
def get_agents(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("agents.view")),
) -> list[AgentListItem]:
    return agent_service.list_agents(db, session)


@router.get("/{membership_id}/overview", response_model=AgentOverviewResponse)
def get_agent_overview(
    membership_id: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("agents.view")),
) -> AgentOverviewResponse:
    try:
        return agent_service.get_agent_overview(db, session, membership_id)
    except AgentServiceError as exc:
        _raise_service_error(exc)


@router.patch("/{membership_id}/profile", response_model=AgentOverviewResponse)
def patch_agent_profile(
    membership_id: str,
    payload: UpdateAgentProfileRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_permissions("agents.view")),
) -> AgentOverviewResponse:
    try:
        return agent_service.update_agent_profile(db, session, membership_id, payload)
    except AgentServiceError as exc:
        _raise_service_error(exc)


@router.post(
    "/{membership_id}/transactions",
    response_model=AgentTransactionSummary,
    status_code=status.HTTP_201_CREATED,
)
def post_agent_transaction(
    membership_id: str,
    payload: CreateAgentTransactionRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("agents.transactions.submit", "agents.manage", "finance.manage")),
) -> AgentTransactionSummary:
    try:
        return agent_service.create_agent_transaction(db, session, membership_id, payload)
    except AgentServiceError as exc:
        _raise_service_error(exc)


@router.patch(
    "/{membership_id}/transactions/{transaction_id}",
    response_model=AgentTransactionSummary,
)
def patch_agent_transaction(
    membership_id: str,
    transaction_id: str,
    payload: UpdateAgentTransactionRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("agents.transactions.submit", "agents.manage", "finance.manage")),
) -> AgentTransactionSummary:
    try:
        return agent_service.update_agent_transaction(db, session, membership_id, transaction_id, payload)
    except AgentServiceError as exc:
        _raise_service_error(exc)


@router.post(
    "/{membership_id}/customers",
    response_model=AgentOverviewResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_agent_customer(
    membership_id: str,
    payload: CreateAgentCustomerRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.create", "agents.manage")),
) -> AgentOverviewResponse:
    try:
        return agent_service.create_agent_customer(db, session, membership_id, payload)
    except AgentServiceError as exc:
        _raise_service_error(exc)


@router.patch(
    "/{membership_id}/customers/{customer_id}",
    response_model=AgentOverviewResponse,
)
def patch_agent_customer(
    membership_id: str,
    customer_id: str,
    payload: UpdateAgentCustomerRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions("customers.create", "customers.edit", "agents.manage")),
) -> AgentOverviewResponse:
    try:
        return agent_service.update_agent_customer(db, session, membership_id, customer_id, payload)
    except AgentServiceError as exc:
        _raise_service_error(exc)
