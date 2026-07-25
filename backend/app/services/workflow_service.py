from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentProfile, AgentTransaction
from app.models.auth import Membership
from app.models.workflow import CustomerProject, CustomerQuotation, QuotationRequest, TransactionApproval
from app.schemas.workflow import (
    ApprovalCenterResponse,
    ApprovalDecisionRequest,
    CreateQuotationRequest,
    GenerateQuotationRequest,
    QuotationRequestSummary,
    QuotationSummary,
    TransactionApprovalSummary,
)


class WorkflowServiceError(Exception):
    status_code = 400


class WorkflowNotFoundError(WorkflowServiceError):
    status_code = 404


class WorkflowForbiddenError(WorkflowServiceError):
    status_code = 403


class WorkflowConflictError(WorkflowServiceError):
    status_code = 409


def _money(value: Decimal | float | int | None) -> float:
    return round(float(value or 0), 2)


def _is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin or actor.role in {"company_admin", "super_admin", "accounts_admin"}


def _load_customer(db: Session, actor: CurrentSession, customer_id: str) -> AgentCustomer:
    customer = db.scalar(select(AgentCustomer).where(
        AgentCustomer.id == customer_id,
        AgentCustomer.company_id == actor.membership.company_id,
    ))
    if not customer:
        raise WorkflowNotFoundError("Customer not found")
    return customer


def _assert_customer_access(db: Session, actor: CurrentSession, customer: AgentCustomer) -> None:
    if _is_admin(actor) or "agents.view_all" in actor.permissions or "agents.manage" in actor.permissions:
        return
    profile = db.scalar(select(AgentProfile).where(
        AgentProfile.id == customer.agent_profile_id,
        AgentProfile.membership_id == actor.membership.id,
    ))
    if not profile:
        raise WorkflowForbiddenError("You can only access customers assigned to you")


def create_quotation_request(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    payload: CreateQuotationRequest,
) -> QuotationRequestSummary:
    customer = _load_customer(db, actor, customer_id)
    _assert_customer_access(db, actor, customer)

    open_request = db.scalar(select(QuotationRequest).where(
        QuotationRequest.customer_id == customer.id,
        QuotationRequest.status.in_(["pending", "quotation_ready"]),
    ))
    if open_request:
        raise WorkflowConflictError("This customer already has an open quotation request")

    request = QuotationRequest(
        company_id=actor.membership.company_id,
        customer_id=customer.id,
        requested_by_membership_id=actor.membership.id,
        requirement_summary=payload.requirement_summary,
        proposed_capacity_kw=Decimal(str(payload.proposed_capacity_kw)),
        site_address=payload.site_address or customer.address,
        notes=payload.notes,
        status="pending",
    )
    customer.status = "quotation_requested"
    db.add(request)
    db.commit()
    return _quotation_request_summary(db, request)


def generate_quotation(
    db: Session,
    actor: CurrentSession,
    request_id: str,
    payload: GenerateQuotationRequest,
) -> QuotationRequestSummary:
    if not _is_admin(actor) and "quotations.approve" not in actor.permissions:
        raise WorkflowForbiddenError("Only an administrator can generate customer quotations")

    request = db.scalar(select(QuotationRequest).where(
        QuotationRequest.id == request_id,
        QuotationRequest.company_id == actor.membership.company_id,
    ))
    if not request:
        raise WorkflowNotFoundError("Quotation request not found")
    if request.status not in {"pending", "quotation_ready", "rejected"}:
        raise WorkflowConflictError("This quotation request cannot be edited")

    items: list[dict[str, object]] = []
    subtotal = Decimal("0.00")
    tax_total = Decimal("0.00")
    for line in payload.lines:
        quantity = Decimal(str(line.quantity))
        unit_price = Decimal(str(line.unit_price))
        tax_rate = Decimal(str(line.tax_rate))
        base = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        tax = (base * tax_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        subtotal += base
        tax_total += tax
        items.append({
            "description": line.description,
            "quantity": float(quantity),
            "unit": line.unit,
            "unit_price": float(unit_price),
            "tax_rate": float(tax_rate),
            "line_total": float(base + tax),
        })

    quotation = db.scalar(select(CustomerQuotation).where(CustomerQuotation.request_id == request.id))
    if not quotation:
        quote_id = __import__("uuid").uuid4().hex
        quotation = CustomerQuotation(
            id=f"{quote_id[0:8]}-{quote_id[8:12]}-{quote_id[12:16]}-{quote_id[16:20]}-{quote_id[20:32]}",
            company_id=request.company_id,
            request_id=request.id,
            customer_id=request.customer_id,
            quotation_number=f"QUO-{datetime.now(UTC).year}-{quote_id[:8].upper()}",
            created_by_membership_id=actor.membership.id,
            title=payload.title,
        )
        db.add(quotation)

    quotation.title = payload.title
    quotation.line_items_json = json.dumps(items, separators=(",", ":"))
    quotation.subtotal = subtotal
    quotation.tax_total = tax_total
    quotation.grand_total = subtotal + tax_total
    quotation.valid_until = payload.valid_until
    quotation.status = "pending_approval"
    quotation.decided_by_membership_id = None
    quotation.decided_at = None
    quotation.decision_comment = ""
    request.status = "quotation_ready"
    request.reviewed_by_membership_id = actor.membership.id
    request.reviewed_at = datetime.now(UTC)
    request.review_comment = "Quotation prepared and awaiting final approval."
    db.commit()
    return _quotation_request_summary(db, request)


def decide_quotation(
    db: Session,
    actor: CurrentSession,
    quotation_id: str,
    payload: ApprovalDecisionRequest,
) -> QuotationRequestSummary:
    if not _is_admin(actor) and "quotations.approve" not in actor.permissions:
        raise WorkflowForbiddenError("You cannot approve quotations")

    quotation = db.scalar(select(CustomerQuotation).where(
        CustomerQuotation.id == quotation_id,
        CustomerQuotation.company_id == actor.membership.company_id,
    ))
    if not quotation:
        raise WorkflowNotFoundError("Quotation not found")
    if quotation.status != "pending_approval":
        raise WorkflowConflictError("Only pending quotations can be approved or rejected")

    request = db.get(QuotationRequest, quotation.request_id)
    customer = db.get(AgentCustomer, quotation.customer_id)
    if not request or not customer:
        raise WorkflowNotFoundError("Quotation workflow is incomplete")

    quotation.status = payload.decision
    quotation.decided_by_membership_id = actor.membership.id
    quotation.decided_at = datetime.now(UTC)
    quotation.decision_comment = payload.comment
    request.status = payload.decision
    request.reviewed_by_membership_id = actor.membership.id
    request.reviewed_at = quotation.decided_at
    request.review_comment = payload.comment

    if payload.decision == "approved":
        project = db.scalar(select(CustomerProject).where(CustomerProject.quotation_id == quotation.id))
        if not project:
            project_id = __import__("uuid").uuid4().hex
            project = CustomerProject(
                id=f"{project_id[0:8]}-{project_id[8:12]}-{project_id[12:16]}-{project_id[16:20]}-{project_id[20:32]}",
                company_id=quotation.company_id,
                customer_id=customer.id,
                quotation_id=quotation.id,
                project_number=f"PRJ-{datetime.now(UTC).year}-{project_id[:8].upper()}",
                name=quotation.title,
                status="planning",
                capacity_kw=request.proposed_capacity_kw,
                approved_value=quotation.grand_total,
            )
            db.add(project)
        customer.status = "active"
        customer.project_name = quotation.title
        customer.outstanding_balance = quotation.grand_total
    else:
        customer.status = "quotation_rejected"

    db.commit()
    return _quotation_request_summary(db, request)


def decide_transaction(
    db: Session,
    actor: CurrentSession,
    approval_id: str,
    payload: ApprovalDecisionRequest,
) -> TransactionApprovalSummary:
    if not _is_admin(actor) and not {"agents.transactions.approve", "finance.manage"}.intersection(actor.permissions):
        raise WorkflowForbiddenError("You cannot approve agent transactions")

    approval = db.scalar(select(TransactionApproval).where(
        TransactionApproval.id == approval_id,
        TransactionApproval.company_id == actor.membership.company_id,
    ))
    if not approval:
        raise WorkflowNotFoundError("Transaction approval not found")
    if approval.status != "pending":
        raise WorkflowConflictError("Only pending transactions can be approved or rejected")

    approval.status = payload.decision
    approval.decided_by_membership_id = actor.membership.id
    approval.decided_at = datetime.now(UTC)
    approval.decision_comment = payload.comment
    db.commit()
    return _transaction_summary(db, approval)


def get_approval_center(db: Session, actor: CurrentSession) -> ApprovalCenterResponse:
    if not _is_admin(actor) and not {
        "quotations.approve",
        "agents.transactions.approve",
        "finance.manage",
    }.intersection(actor.permissions):
        raise WorkflowForbiddenError("You cannot view the approval center")

    quotation_requests = list(db.scalars(
        select(QuotationRequest)
        .where(QuotationRequest.company_id == actor.membership.company_id)
        .order_by(QuotationRequest.created_at.desc())
        .limit(100)
    ).all())
    transaction_approvals = list(db.scalars(
        select(TransactionApproval)
        .where(
            TransactionApproval.company_id == actor.membership.company_id,
            TransactionApproval.status == "pending",
        )
        .order_by(TransactionApproval.created_at.asc())
        .limit(100)
    ).all())

    return ApprovalCenterResponse(
        quotation_requests=[_quotation_request_summary(db, item) for item in quotation_requests],
        transactions=[_transaction_summary(db, item) for item in transaction_approvals],
    )


def _quotation_request_summary(db: Session, request: QuotationRequest) -> QuotationRequestSummary:
    customer = db.get(AgentCustomer, request.customer_id)
    profile = db.get(AgentProfile, customer.agent_profile_id) if customer else None
    membership = db.scalar(select(Membership).where(Membership.id == (profile.membership_id if profile else "")).options(selectinload(Membership.user))) if profile else None
    quotation = db.scalar(select(CustomerQuotation).where(CustomerQuotation.request_id == request.id))
    project = db.scalar(select(CustomerProject).where(CustomerProject.quotation_id == quotation.id)) if quotation else None
    quotation_summary = None
    if quotation:
        quotation_summary = QuotationSummary(
            id=quotation.id,
            quotation_number=quotation.quotation_number,
            title=quotation.title,
            subtotal=_money(quotation.subtotal),
            tax_total=_money(quotation.tax_total),
            grand_total=_money(quotation.grand_total),
            valid_until=quotation.valid_until,
            status=quotation.status,
            decision_comment=quotation.decision_comment,
            created_at=quotation.created_at,
        )
    return QuotationRequestSummary(
        id=request.id,
        customer_id=request.customer_id,
        customer_name=customer.customer_name if customer else "Unknown customer",
        company_name=customer.company_name if customer else "",
        agent_membership_id=profile.membership_id if profile else "",
        agent_name=membership.user.full_name if membership else "Unknown agent",
        requirement_summary=request.requirement_summary,
        proposed_capacity_kw=_money(request.proposed_capacity_kw),
        site_address=request.site_address,
        notes=request.notes,
        status=request.status,
        review_comment=request.review_comment,
        created_at=request.created_at,
        quotation=quotation_summary,
        project_number=project.project_number if project else None,
        project_status=project.status if project else None,
    )


def _transaction_summary(db: Session, approval: TransactionApproval) -> TransactionApprovalSummary:
    transaction = db.get(AgentTransaction, approval.transaction_id)
    profile = db.get(AgentProfile, transaction.agent_profile_id) if transaction else None
    membership = db.scalar(select(Membership).where(Membership.id == (profile.membership_id if profile else "")).options(selectinload(Membership.user))) if profile else None
    if not transaction:
        raise WorkflowNotFoundError("Transaction not found")
    return TransactionApprovalSummary(
        approval_id=approval.id,
        transaction_id=transaction.id,
        agent_membership_id=profile.membership_id if profile else "",
        agent_name=membership.user.full_name if membership else "Unknown agent",
        transaction_date=transaction.transaction_date,
        reference=transaction.reference,
        transaction_type=transaction.transaction_type,
        description=transaction.description,
        debit=_money(transaction.debit),
        credit=_money(transaction.credit),
        status=approval.status,
        decision_comment=approval.decision_comment,
        created_at=approval.created_at,
    )
