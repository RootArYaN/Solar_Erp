from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentCustomerEdit, AgentProfile, AgentTransaction
from app.models.auth import Membership, Role, User
from app.models.workflow import CustomerProject, CustomerQuotation, QuotationRequest, TransactionApproval
from app.schemas.agent import (
    AgentCustomerSummary,
    AgentListItem,
    AgentOverviewResponse,
    AgentProfileSummary,
    AgentTransactionSummary,
    CreateAgentCustomerRequest,
    CreateAgentTransactionRequest,
    UpdateAgentCustomerRequest,
    UpdateAgentProfileRequest,
)


class AgentServiceError(Exception):
    status_code = 400


class AgentNotFoundError(AgentServiceError):
    status_code = 404


class AgentForbiddenError(AgentServiceError):
    status_code = 403


class AgentConflictError(AgentServiceError):
    status_code = 409


def ensure_agent_profile(db: Session, membership: Membership) -> AgentProfile:
    profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == membership.id))
    if profile:
        return profile
    profile = AgentProfile(company_id=membership.company_id, membership_id=membership.id)
    db.add(profile)
    db.flush()
    return profile


def _load_agent_membership(db: Session, company_id: str, membership_id: str) -> Membership:
    membership = db.scalar(
        select(Membership)
        .join(Membership.role)
        .where(
            Membership.id == membership_id,
            Membership.company_id == company_id,
            Role.code == "agent",
        )
        .options(selectinload(Membership.user), selectinload(Membership.role))
    )
    if not membership:
        raise AgentNotFoundError("Agent not found")
    return membership


def _load_profile(db: Session, membership: Membership) -> AgentProfile:
    profile = db.scalar(
        select(AgentProfile)
        .where(AgentProfile.membership_id == membership.id)
        .options(selectinload(AgentProfile.customers), selectinload(AgentProfile.transactions))
    )
    if not profile:
        profile = ensure_agent_profile(db, membership)
        db.commit()
        profile = db.scalar(
            select(AgentProfile)
            .where(AgentProfile.id == profile.id)
            .options(selectinload(AgentProfile.customers), selectinload(AgentProfile.transactions))
        )
    if not profile:
        raise AgentNotFoundError("Agent profile not found")
    return profile


def _can_view_all(actor: CurrentSession) -> bool:
    return (
        actor.user.is_super_admin
        or "agents.manage" in actor.permissions
        or "agents.view_all" in actor.permissions
        or "users.view" in actor.permissions
    )


def _is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin or actor.role in {"company_admin", "super_admin", "accounts_admin"}


def _assert_can_view(actor: CurrentSession, membership_id: str) -> None:
    if membership_id != actor.membership.id and not _can_view_all(actor):
        raise AgentForbiddenError("You can only view your own agent overview")


def _assert_can_edit_profile(actor: CurrentSession, membership_id: str) -> None:
    if membership_id != actor.membership.id and "agents.manage" not in actor.permissions and not actor.user.is_super_admin:
        raise AgentForbiddenError("You cannot edit this agent profile")


def _assert_can_manage_customer(actor: CurrentSession, membership_id: str) -> None:
    own_customer = membership_id == actor.membership.id and "customers.create" in actor.permissions
    if not own_customer and not _is_admin(actor) and "agents.manage" not in actor.permissions:
        raise AgentForbiddenError("You cannot register customers for this agent")


def _has_unlimited_customer_edits(actor: CurrentSession) -> bool:
    return _is_admin(actor)


def _agent_edited_customer_ids(db: Session, company_id: str, customer_ids: list[str]) -> set[str]:
    if not customer_ids:
        return set()
    return set(db.scalars(select(AgentCustomerEdit.customer_id).where(
        AgentCustomerEdit.company_id == company_id,
        AgentCustomerEdit.customer_id.in_(customer_ids),
    )).all())


def _money(value: Decimal | float | int | None) -> float:
    return round(float(value or 0), 2)


def _approval_map(db: Session, transactions: list[AgentTransaction]) -> dict[str, TransactionApproval]:
    if not transactions:
        return {}
    approvals = list(db.scalars(select(TransactionApproval).where(
        TransactionApproval.transaction_id.in_([transaction.id for transaction in transactions])
    )).all())
    return {approval.transaction_id: approval for approval in approvals}


def _is_posted(transaction: AgentTransaction, approvals: dict[str, TransactionApproval]) -> bool:
    approval = approvals.get(transaction.id)
    return approval is None or approval.status == "approved"


def _current_balance(profile: AgentProfile, approvals: dict[str, TransactionApproval] | None = None) -> Decimal:
    approval_by_transaction = approvals if approvals is not None else {}
    return Decimal(profile.opening_balance or 0) + sum(
        (
            Decimal(transaction.credit or 0) - Decimal(transaction.debit or 0)
            for transaction in profile.transactions
            if _is_posted(transaction, approval_by_transaction)
        ),
        Decimal("0.00"),
    )


def list_agents(db: Session, actor: CurrentSession) -> list[AgentListItem]:
    statement = (
        select(Membership)
        .join(Membership.role)
        .join(Membership.user)
        .where(Membership.company_id == actor.membership.company_id, Role.code == "agent")
        .options(selectinload(Membership.user))
        .order_by(User.full_name.asc())
    )
    if not _can_view_all(actor):
        statement = statement.where(Membership.id == actor.membership.id)

    memberships = list(db.scalars(statement).unique().all())
    if not memberships:
        return []

    profiles = list(
        db.scalars(
            select(AgentProfile)
            .where(AgentProfile.membership_id.in_([membership.id for membership in memberships]))
            .options(selectinload(AgentProfile.customers), selectinload(AgentProfile.transactions))
        ).all()
    )
    profile_by_membership = {profile.membership_id: profile for profile in profiles}

    result: list[AgentListItem] = []
    created_profile = False
    for membership in memberships:
        profile = profile_by_membership.get(membership.id)
        if not profile:
            profile = ensure_agent_profile(db, membership)
            created_profile = True
        approvals = _approval_map(db, list(profile.transactions))
        result.append(
            AgentListItem(
                membership_id=membership.id,
                full_name=membership.user.full_name,
                email=membership.user.email,
                phone=profile.phone,
                city=profile.city,
                is_active=membership.is_active and membership.user.is_active,
                customer_count=len(profile.customers),
                current_balance=_money(_current_balance(profile, approvals)),
            )
        )
    if created_profile:
        db.commit()
    return result


def _customer_workflow_maps(
    db: Session,
    customers: list[AgentCustomer],
) -> tuple[dict[str, QuotationRequest], dict[str, CustomerQuotation], dict[str, CustomerProject]]:
    if not customers:
        return {}, {}, {}
    customer_ids = [customer.id for customer in customers]
    requests = list(db.scalars(
        select(QuotationRequest)
        .where(QuotationRequest.customer_id.in_(customer_ids))
        .order_by(QuotationRequest.created_at.desc())
    ).all())
    latest_request: dict[str, QuotationRequest] = {}
    for request in requests:
        latest_request.setdefault(request.customer_id, request)

    quotations = list(db.scalars(select(CustomerQuotation).where(
        CustomerQuotation.request_id.in_([request.id for request in latest_request.values()])
    )).all()) if latest_request else []
    quotation_by_request = {quotation.request_id: quotation for quotation in quotations}
    projects = list(db.scalars(select(CustomerProject).where(
        CustomerProject.quotation_id.in_([quotation.id for quotation in quotations])
    )).all()) if quotations else []
    project_by_quotation = {project.quotation_id: project for project in projects}
    return latest_request, quotation_by_request, project_by_quotation


def get_agent_overview(db: Session, actor: CurrentSession, membership_id: str) -> AgentOverviewResponse:
    _assert_can_view(actor, membership_id)
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)

    ordered_transactions = sorted(profile.transactions, key=lambda item: (item.transaction_date, item.created_at))
    approvals = _approval_map(db, ordered_transactions)
    running_balance = Decimal(profile.opening_balance or 0)
    transaction_summaries: list[AgentTransactionSummary] = []
    for transaction in ordered_transactions:
        approval = approvals.get(transaction.id)
        approval_status = approval.status if approval else "approved"
        if approval_status == "approved":
            running_balance += Decimal(transaction.credit or 0) - Decimal(transaction.debit or 0)
        transaction_summaries.append(
            AgentTransactionSummary(
                id=transaction.id,
                transaction_date=transaction.transaction_date,
                reference=transaction.reference,
                transaction_type=transaction.transaction_type,
                description=transaction.description,
                debit=_money(transaction.debit),
                credit=_money(transaction.credit),
                running_balance=_money(running_balance),
                approval_status=approval_status,
                approval_comment=approval.decision_comment if approval else "Legacy approved transaction",
            )
        )

    customers = sorted(profile.customers, key=lambda item: item.customer_name.lower())
    latest_requests, quotations, projects = _customer_workflow_maps(db, customers)
    agent_edited_customer_ids = _agent_edited_customer_ids(
        db,
        actor.membership.company_id,
        [customer.id for customer in customers],
    )
    current_balance = _current_balance(profile, approvals)
    customer_summaries: list[AgentCustomerSummary] = []
    for customer in customers:
        request = latest_requests.get(customer.id)
        quotation = quotations.get(request.id) if request else None
        project = projects.get(quotation.id) if quotation else None
        customer_summaries.append(AgentCustomerSummary(
            id=customer.id,
            customer_name=customer.customer_name,
            company_name=customer.company_name,
            email=customer.email,
            phone=customer.phone,
            address=customer.address,
            project_name=customer.project_name,
            status=customer.status,
            outstanding_balance=_money(customer.outstanding_balance),
            quotation_request_status=request.status if request else None,
            quotation_status=quotation.status if quotation else None,
            project_number=project.project_number if project else None,
            project_status=project.status if project else None,
            can_edit=(
                _has_unlimited_customer_edits(actor)
                or (
                    actor.role == "agent"
                    and actor.membership.id == membership.id
                    and customer.id not in agent_edited_customer_ids
                )
            ),
        ))

    return AgentOverviewResponse(
        profile=AgentProfileSummary(
            id=profile.id,
            membership_id=membership.id,
            full_name=membership.user.full_name,
            email=membership.user.email,
            phone=profile.phone,
            alternate_phone=profile.alternate_phone,
            address_line_1=profile.address_line_1,
            address_line_2=profile.address_line_2,
            city=profile.city,
            state=profile.state,
            postal_code=profile.postal_code,
            is_active=membership.is_active and membership.user.is_active,
            opening_balance=_money(profile.opening_balance),
            current_balance=_money(current_balance),
        ),
        customer_count=len(customers),
        active_customer_count=sum(customer.status == "active" for customer in customers),
        customer_outstanding=_money(sum((Decimal(customer.outstanding_balance or 0) for customer in customers), Decimal("0.00"))),
        customers=customer_summaries,
        transactions=list(reversed(transaction_summaries)),
    )


def update_agent_profile(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: UpdateAgentProfileRequest,
) -> AgentOverviewResponse:
    _assert_can_edit_profile(actor, membership_id)
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    return get_agent_overview(db, actor, membership_id)


def create_agent_customer(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: CreateAgentCustomerRequest,
) -> AgentOverviewResponse:
    _assert_can_manage_customer(actor, membership_id)
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)

    duplicate_filters = []
    if payload.email:
        duplicate_filters.append(AgentCustomer.email == payload.email)
    if payload.phone:
        duplicate_filters.append(AgentCustomer.phone == payload.phone)
    if duplicate_filters:
        duplicate = db.scalar(select(AgentCustomer).where(
            AgentCustomer.company_id == actor.membership.company_id,
            or_(*duplicate_filters),
        ))
        if duplicate:
            raise AgentConflictError("A customer with this phone or email already exists")

    customer = AgentCustomer(
        company_id=actor.membership.company_id,
        agent_profile_id=profile.id,
        customer_name=payload.customer_name,
        company_name=payload.company_name,
        email=payload.email.lower(),
        phone=payload.phone,
        address=payload.address,
        project_name=payload.project_name,
        status="registered",
        outstanding_balance=Decimal("0.00"),
    )
    db.add(customer)
    db.commit()
    db.expire_all()
    return get_agent_overview(db, actor, membership_id)


def update_agent_customer(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    customer_id: str,
    payload: UpdateAgentCustomerRequest,
) -> AgentOverviewResponse:
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    customer = next((item for item in profile.customers if item.id == customer_id), None)
    if not customer:
        raise AgentNotFoundError("Customer not found")

    unlimited_edits = _has_unlimited_customer_edits(actor)
    own_agent_edit = actor.role == "agent" and actor.membership.id == membership_id
    if not unlimited_edits and not own_agent_edit:
        raise AgentForbiddenError("You cannot edit this customer")

    if own_agent_edit and db.scalar(select(AgentCustomerEdit.id).where(
        AgentCustomerEdit.company_id == actor.membership.company_id,
        AgentCustomerEdit.customer_id == customer.id,
    )):
        raise AgentConflictError("This customer has already used the one-time agent edit")

    duplicate_filters = [AgentCustomer.phone == payload.phone]
    if payload.email:
        duplicate_filters.append(AgentCustomer.email == payload.email.lower())
    duplicate = db.scalar(select(AgentCustomer.id).where(
        AgentCustomer.company_id == actor.membership.company_id,
        AgentCustomer.id != customer.id,
        or_(*duplicate_filters),
    ))
    if duplicate:
        raise AgentConflictError("A customer with this phone or email already exists")

    customer.customer_name = payload.customer_name
    customer.company_name = payload.company_name
    customer.email = payload.email.lower()
    customer.phone = payload.phone
    customer.address = payload.address
    customer.project_name = payload.project_name
    if own_agent_edit:
        db.add(AgentCustomerEdit(
            company_id=actor.membership.company_id,
            customer_id=customer.id,
            edited_by_membership_id=actor.membership.id,
        ))

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AgentConflictError("This customer has already used the one-time agent edit") from exc
    db.expire_all()
    return get_agent_overview(db, actor, membership_id)


def create_agent_transaction(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: CreateAgentTransactionRequest,
) -> AgentTransactionSummary:
    own_submission = membership_id == actor.membership.id and "agents.transactions.submit" in actor.permissions
    privileged_submission = _is_admin(actor) or bool({"agents.manage", "finance.manage"}.intersection(actor.permissions))
    if not own_submission and not privileged_submission:
        raise AgentForbiddenError("You cannot submit agent transactions")

    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    transaction = AgentTransaction(
        company_id=actor.membership.company_id,
        agent_profile_id=profile.id,
        created_by_membership_id=actor.membership.id,
        transaction_date=payload.transaction_date or datetime.now(UTC),
        reference=payload.reference,
        transaction_type=payload.transaction_type,
        description=payload.description,
        debit=Decimal(str(payload.debit)),
        credit=Decimal(str(payload.credit)),
    )
    db.add(transaction)
    db.flush()

    approval_status = "approved" if privileged_submission and not (actor.role == "agent" and own_submission) else "pending"
    approval = TransactionApproval(
        company_id=actor.membership.company_id,
        transaction_id=transaction.id,
        submitted_by_membership_id=actor.membership.id,
        status=approval_status,
        decided_by_membership_id=actor.membership.id if approval_status == "approved" else None,
        decided_at=datetime.now(UTC) if approval_status == "approved" else None,
        decision_comment="Entered by an authorized administrator" if approval_status == "approved" else "Awaiting administrator approval",
    )
    db.add(approval)
    db.commit()
    transaction_id = transaction.id
    db.expire_all()

    overview = get_agent_overview(db, actor, membership_id)
    return next(item for item in overview.transactions if item.id == transaction_id)
