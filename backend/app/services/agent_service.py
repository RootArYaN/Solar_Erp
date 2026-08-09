from __future__ import annotations

from typing import TYPE_CHECKING

import json
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

if TYPE_CHECKING:
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
    UpdateAgentTransactionRequest,
    UpdateAgentCustomerRequest,
    UpdateAgentProfileRequest,
)
from app.schemas.workflow import QuotationLineSummary, QuotationSummary
from app.services.access_service import (
    get_project,
    operational_customer_filter,
    visible_project_ids,
)
from app.services.audit_service import write_event


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
    """Load only the profile row. Large customer/transaction collections are queried explicitly.

    The old eager loading path fetched an agent's entire history even for profile edits and
    customer creation. Keeping this function lightweight prevents unnecessary memory/query
    work as an agent accumulates years of customers and transactions.
    """
    profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == membership.id))
    if not profile:
        profile = ensure_agent_profile(db, membership)
        db.commit()
    if not profile:
        raise AgentNotFoundError("Agent profile not found")
    return profile


def _operational_customers_for_profile(
    db: Session,
    company_id: str,
    profile_id: str,
    *,
    query: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[AgentCustomer], int]:
    filters = [
        operational_customer_filter(company_id),
        AgentCustomer.agent_profile_id == profile_id,
    ]
    term = (query or "").strip().lower()
    if term:
        like = f"%{term}%"
        filters.append(or_(
            func.lower(AgentCustomer.customer_name).like(like),
            func.lower(AgentCustomer.consumer_number).like(like),
            func.lower(AgentCustomer.phone).like(like),
            func.lower(AgentCustomer.alternate_phone).like(like),
            func.lower(AgentCustomer.email).like(like),
            func.lower(AgentCustomer.project_name).like(like),
        ))
    total = int(db.scalar(
        select(func.count(AgentCustomer.id)).where(*filters)
    ) or 0)
    rows = list(db.scalars(
        select(AgentCustomer)
        .where(*filters)
        .order_by(AgentCustomer.customer_name.asc(), AgentCustomer.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())
    return rows, total


def _transaction_visibility_filters(company_id: str, profile_id: str):
    return (
        AgentTransaction.company_id == company_id,
        AgentTransaction.agent_profile_id == profile_id,
        or_(
            AgentTransaction.project_id.is_(None),
            AgentTransaction.project_id.in_(visible_project_ids(company_id)),
        ),
    )


def _transaction_window(company_id: str, profile_id: str):
    """Transaction rows with approval state and a balance delta calculated in SQL."""
    posted_delta = case(
        (
            or_(TransactionApproval.id.is_(None), TransactionApproval.status == "approved"),
            AgentTransaction.credit - AgentTransaction.debit,
        ),
        else_=0,
    )
    return (
        select(
            AgentTransaction.id.label("id"),
            AgentTransaction.project_id.label("project_id"),
            AgentTransaction.transaction_date.label("transaction_date"),
            AgentTransaction.created_at.label("created_at"),
            AgentTransaction.reference.label("reference"),
            AgentTransaction.transaction_type.label("transaction_type"),
            AgentTransaction.description.label("description"),
            AgentTransaction.debit.label("debit"),
            AgentTransaction.credit.label("credit"),
            TransactionApproval.status.label("approval_status"),
            TransactionApproval.decision_comment.label("approval_comment"),
            func.sum(posted_delta).over(
                order_by=(
                    AgentTransaction.transaction_date.asc(),
                    AgentTransaction.created_at.asc(),
                    AgentTransaction.id.asc(),
                ),
                rows=(None, 0),
            ).label("running_delta"),
        )
        .outerjoin(TransactionApproval, TransactionApproval.transaction_id == AgentTransaction.id)
        .where(*_transaction_visibility_filters(company_id, profile_id))
        .subquery()
    )


def _transaction_summary_from_row(row, opening_balance: Decimal) -> AgentTransactionSummary:
    return AgentTransactionSummary(
        id=row.id,
        project_id=row.project_id,
        transaction_date=row.transaction_date,
        reference=row.reference,
        transaction_type=row.transaction_type,
        description=row.description,
        debit=_money(row.debit),
        credit=_money(row.credit),
        running_balance=_money(opening_balance + Decimal(row.running_delta or 0)),
        approval_status=row.approval_status or "approved",
        approval_comment=row.approval_comment or "Legacy approved transaction",
    )


def _paged_transaction_summaries(
    db: Session,
    company_id: str,
    profile_id: str,
    opening_balance: Decimal,
    *,
    query: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[AgentTransactionSummary], int]:
    base = _transaction_window(company_id, profile_id)
    search_filters = []
    term = (query or "").strip().lower()
    if term:
        like = f"%{term}%"
        search_filters.append(or_(
            func.lower(base.c.reference).like(like),
            func.lower(base.c.transaction_type).like(like),
            func.lower(base.c.description).like(like),
            func.lower(func.coalesce(base.c.approval_status, "approved")).like(like),
        ))

    total = int(db.scalar(
        select(func.count()).select_from(base).where(*search_filters)
    ) or 0)
    rows = db.execute(
        select(base)
        .where(*search_filters)
        .order_by(base.c.transaction_date.desc(), base.c.created_at.desc(), base.c.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    summaries = [_transaction_summary_from_row(row, opening_balance) for row in rows]
    return summaries, total


def _single_transaction_summary(
    db: Session,
    company_id: str,
    profile_id: str,
    opening_balance: Decimal,
    transaction_id: str,
) -> AgentTransactionSummary:
    base = _transaction_window(company_id, profile_id)
    row = db.execute(select(base).where(base.c.id == transaction_id)).one_or_none()
    if not row:
        raise AgentNotFoundError("Agent transaction not found")
    return _transaction_summary_from_row(row, opening_balance)


def _agent_overview_aggregates(
    db: Session,
    company_id: str,
    profile_id: str,
) -> tuple[int, int, Decimal, Decimal, Decimal]:
    customer_row = db.execute(
        select(
            func.count(AgentCustomer.id),
            func.count(AgentCustomer.id).filter(AgentCustomer.status == "active"),
            func.coalesce(func.sum(AgentCustomer.outstanding_balance), 0),
        ).where(
            operational_customer_filter(company_id),
            AgentCustomer.agent_profile_id == profile_id,
        )
    ).one()
    posted = or_(TransactionApproval.id.is_(None), TransactionApproval.status == "approved")
    transaction_row = db.execute(
        select(
            func.coalesce(func.sum(case((posted, AgentTransaction.credit - AgentTransaction.debit), else_=0)), 0),
            func.coalesce(func.sum(case((posted & (AgentTransaction.transaction_type == "commission"), AgentTransaction.credit - AgentTransaction.debit), else_=0)), 0),
        )
        .outerjoin(TransactionApproval, TransactionApproval.transaction_id == AgentTransaction.id)
        .where(*_transaction_visibility_filters(company_id, profile_id))
    ).one()
    return (
        int(customer_row[0] or 0),
        int(customer_row[1] or 0),
        Decimal(customer_row[2] or 0),
        Decimal(transaction_row[0] or 0),
        Decimal(transaction_row[1] or 0),
    )


def _can_view_all(actor: CurrentSession) -> bool:
    return (
        actor.user.is_super_admin
        or "agents.manage" in actor.permissions
        or "agents.view_all" in actor.permissions
        or "users.view" in actor.permissions
    )


def _is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


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
    return actor.user.is_super_admin or bool({"customers.edit", "agents.manage"}.intersection(actor.permissions))


def _agent_edited_customer_ids(db: Session, company_id: str, customer_ids: list[str]) -> set[str]:
    if not customer_ids:
        return set()
    return set(db.scalars(select(AgentCustomerEdit.customer_id).where(
        AgentCustomerEdit.company_id == company_id,
        AgentCustomerEdit.customer_id.in_(customer_ids),
    )).all())


def _money(value: Decimal | float | int | None) -> float:
    return round(float(value or 0), 2)


def _approved_quotation_summary(quotation: CustomerQuotation | None) -> QuotationSummary | None:
    if not quotation or quotation.status != "approved":
        return None
    try:
        raw_lines = json.loads(quotation.line_items_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        raw_lines = []
    lines = [
        QuotationLineSummary(
            description=str(item.get("description") or "Item"),
            quantity=_money(item.get("quantity")),
            unit=str(item.get("unit") or "Unit"),
            unit_price=_money(item.get("unit_price")),
            tax_rate=_money(item.get("tax_rate")),
            line_total=_money(item.get("line_total")),
        )
        for item in raw_lines
        if isinstance(item, dict)
    ] if isinstance(raw_lines, list) else []
    return QuotationSummary(
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
        approved_at=quotation.decided_at,
        lines=lines,
    )


def list_agents(db: Session, actor: CurrentSession) -> list[AgentListItem]:
    company_id = actor.membership.company_id
    customer_counts = (
        select(
            AgentCustomer.agent_profile_id.label("profile_id"),
            func.count(AgentCustomer.id).label("customer_count"),
        )
        .where(operational_customer_filter(company_id))
        .group_by(AgentCustomer.agent_profile_id)
        .subquery()
    )
    balance_totals = (
        select(
            AgentTransaction.agent_profile_id.label("profile_id"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            or_(
                                TransactionApproval.id.is_(None),
                                TransactionApproval.status == "approved",
                            ),
                            AgentTransaction.credit - AgentTransaction.debit,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("balance_delta"),
        )
        .outerjoin(
            TransactionApproval,
            TransactionApproval.transaction_id == AgentTransaction.id,
        )
        .where(
            AgentTransaction.company_id == company_id,
            or_(AgentTransaction.project_id.is_(None), AgentTransaction.project_id.in_(visible_project_ids(company_id))),
        )
        .group_by(AgentTransaction.agent_profile_id)
        .subquery()
    )
    statement = (
        select(
            Membership.id.label("membership_id"),
            Membership.is_active.label("membership_active"),
            User.full_name,
            User.email,
            User.is_active.label("user_active"),
            AgentProfile.id.label("profile_id"),
            AgentProfile.phone,
            AgentProfile.city,
            AgentProfile.opening_balance,
            func.coalesce(customer_counts.c.customer_count, 0).label("customer_count"),
            func.coalesce(balance_totals.c.balance_delta, 0).label("balance_delta"),
        )
        .join(Role, Role.id == Membership.role_id)
        .join(User, User.id == Membership.user_id)
        .outerjoin(AgentProfile, AgentProfile.membership_id == Membership.id)
        .outerjoin(customer_counts, customer_counts.c.profile_id == AgentProfile.id)
        .outerjoin(balance_totals, balance_totals.c.profile_id == AgentProfile.id)
        .where(Membership.company_id == company_id, Role.code == "agent")
        .order_by(User.full_name.asc())
    )
    if not _can_view_all(actor):
        statement = statement.where(Membership.id == actor.membership.id)

    rows = db.execute(statement).all()
    if not rows:
        return []

    missing_membership_ids = [row.membership_id for row in rows if row.profile_id is None]
    if missing_membership_ids:
        # Repair legacy agents in one flush instead of issuing a profile lookup
        # for every missing membership. A concurrent repair is harmless: the
        # membership uniqueness constraint wins and we simply reload.
        try:
            db.add_all([
                AgentProfile(company_id=company_id, membership_id=membership_id)
                for membership_id in missing_membership_ids
            ])
            db.commit()
        except IntegrityError:
            db.rollback()
        return list_agents(db, actor)

    return [
        AgentListItem(
            membership_id=row.membership_id,
            full_name=row.full_name,
            email=row.email,
            phone=row.phone or "",
            city=row.city or "",
            is_active=bool(row.membership_active and row.user_active),
            customer_count=int(row.customer_count or 0),
            current_balance=_money(
                Decimal(row.opening_balance or 0) + Decimal(row.balance_delta or 0)
            ),
        )
        for row in rows
    ]


def _customer_workflow_maps(
    db: Session,
    customers: list[AgentCustomer],
) -> tuple[dict[str, QuotationRequest], dict[str, CustomerQuotation], dict[str, CustomerProject]]:
    if not customers:
        return {}, {}, {}
    customer_ids = [customer.id for customer in customers]
    ranked_requests = (
        select(
            QuotationRequest.id.label("request_id"),
            func.row_number().over(
                partition_by=QuotationRequest.customer_id,
                order_by=(QuotationRequest.created_at.desc(), QuotationRequest.id.desc()),
            ).label("row_number"),
        )
        .where(QuotationRequest.customer_id.in_(customer_ids))
        .subquery()
    )
    requests = list(db.scalars(
        select(QuotationRequest)
        .join(ranked_requests, ranked_requests.c.request_id == QuotationRequest.id)
        .where(ranked_requests.c.row_number == 1)
    ).all())
    latest_request = {request.customer_id: request for request in requests}

    quotations = list(db.scalars(select(CustomerQuotation).where(
        CustomerQuotation.request_id.in_([request.id for request in latest_request.values()])
    )).all()) if latest_request else []
    quotation_by_request = {quotation.request_id: quotation for quotation in quotations}
    projects = list(db.scalars(select(CustomerProject).where(
        CustomerProject.quotation_id.in_([quotation.id for quotation in quotations])
    )).all()) if quotations else []
    project_by_quotation = {project.quotation_id: project for project in projects}
    return latest_request, quotation_by_request, project_by_quotation


def get_agent_overview(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    *,
    customer_page: int = 1,
    customer_page_size: int = 25,
    customer_query: str | None = None,
    transaction_page: int = 1,
    transaction_page_size: int = 25,
    transaction_query: str | None = None,
) -> AgentOverviewResponse:
    _assert_can_view(actor, membership_id)
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    company_id = actor.membership.company_id
    customer_count, active_customer_count, customer_outstanding, balance_delta, commission_total = _agent_overview_aggregates(
        db, company_id, profile.id
    )
    transaction_summaries, transaction_total = _paged_transaction_summaries(
        db,
        company_id,
        profile.id,
        Decimal(profile.opening_balance or 0),
        query=transaction_query,
        page=transaction_page,
        page_size=transaction_page_size,
    )
    customers, customer_total = _operational_customers_for_profile(
        db,
        company_id,
        profile.id,
        query=customer_query,
        page=customer_page,
        page_size=customer_page_size,
    )
    latest_requests, quotations, projects = _customer_workflow_maps(db, customers)
    agent_edited_customer_ids = _agent_edited_customer_ids(
        db,
        company_id,
        [customer.id for customer in customers],
    )
    current_balance = Decimal(profile.opening_balance or 0) + balance_delta
    customer_summaries: list[AgentCustomerSummary] = []
    for customer in customers:
        request = latest_requests.get(customer.id)
        quotation = quotations.get(request.id) if request else None
        project = projects.get(quotation.id) if quotation else None
        customer_summaries.append(AgentCustomerSummary(
            id=customer.id,
            customer_name=customer.customer_name,
            company_name="",
            email=customer.email,
            phone=customer.phone,
            alternate_phone=customer.alternate_phone,
            address=customer.site_address or customer.address,
            billing_address=customer.billing_address,
            site_address=customer.site_address or customer.address,
            district=customer.district,
            state=customer.state,
            postal_code=customer.postal_code,
            consumer_number=customer.consumer_number,
            electricity_provider=customer.electricity_provider,
            customer_type=customer.customer_type,
            lead_source=customer.lead_source,
            project_name=customer.project_name,
            status=customer.status,
            outstanding_balance=_money(customer.outstanding_balance),
            quotation_request_status=request.status if request else None,
            quotation_status=quotation.status if quotation else None,
            project_id=project.id if project else None,
            project_number=project.project_number if project else None,
            project_status=project.status if project else None,
            approved_quotation=_approved_quotation_summary(quotation),
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
        customer_count=customer_count,
        active_customer_count=active_customer_count,
        commission_total=_money(commission_total),
        customer_outstanding=_money(customer_outstanding),
        customers=customer_summaries,
        transactions=transaction_summaries,
        customer_page=customer_page,
        customer_page_size=customer_page_size,
        customer_total=customer_total,
        transaction_page=transaction_page,
        transaction_page_size=transaction_page_size,
        transaction_total=transaction_total,
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
    before = {field: getattr(profile, field) for field in payload.model_dump()}
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    write_event(
        db, company_id=profile.company_id, event="agent.profile_updated", entity="agent_profile",
        entity_id=profile.id, actor=actor, changes={"before": before, "after": payload.model_dump()},
    )
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
        company_name="",
        email=payload.email.lower(),
        phone=payload.phone,
        alternate_phone=payload.alternate_phone,
        address=payload.site_address or payload.address,
        billing_address=payload.billing_address,
        site_address=payload.site_address or payload.address,
        district=payload.district,
        state=payload.state,
        postal_code=payload.postal_code,
        consumer_number=payload.consumer_number,
        electricity_provider=payload.electricity_provider,
        customer_type=payload.customer_type,
        lead_source=payload.lead_source,
        project_name=payload.project_name,
        status="registered",
        outstanding_balance=Decimal("0.00"),
    )
    db.add(customer)
    db.flush()
    write_event(
        db, company_id=customer.company_id, event="customer.created", entity="customer",
        entity_id=customer.id, actor=actor, customer_id=customer.id,
        changes={"customer_name": customer.customer_name, "agent_profile_id": profile.id},
    )
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
    customer = db.scalar(
        select(AgentCustomer).where(
            operational_customer_filter(actor.membership.company_id),
            AgentCustomer.agent_profile_id == profile.id,
            AgentCustomer.id == customer_id,
        )
    )
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
    customer.company_name = ""
    customer.email = payload.email.lower()
    customer.phone = payload.phone
    customer.alternate_phone = payload.alternate_phone
    customer.address = payload.site_address or payload.address
    customer.billing_address = payload.billing_address
    customer.site_address = payload.site_address or payload.address
    customer.district = payload.district
    customer.state = payload.state
    customer.postal_code = payload.postal_code
    customer.consumer_number = payload.consumer_number
    customer.electricity_provider = payload.electricity_provider
    customer.customer_type = payload.customer_type
    customer.lead_source = payload.lead_source
    customer.project_name = payload.project_name
    if own_agent_edit:
        db.add(AgentCustomerEdit(
            company_id=actor.membership.company_id,
            customer_id=customer.id,
            edited_by_membership_id=actor.membership.id,
        ))
    write_event(
        db, company_id=customer.company_id, event="customer.updated", entity="customer",
        entity_id=customer.id, actor=actor, customer_id=customer.id,
        changes={"customer_name": customer.customer_name, "phone": customer.phone, "project_name": customer.project_name},
    )

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
    project = get_project(db, actor, payload.project_id) if payload.project_id else None
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
        project_id=project.id if project else None,
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
    write_event(
        db, company_id=transaction.company_id, event="transaction.created", entity="agent_transaction",
        entity_id=transaction.id, actor=actor, project_id=transaction.project_id,
        changes={"type": transaction.transaction_type, "debit": str(transaction.debit), "credit": str(transaction.credit), "approval_status": approval_status},
    )
    db.commit()
    transaction_id = transaction.id
    db.expire_all()
    return _single_transaction_summary(
        db,
        actor.membership.company_id,
        profile.id,
        Decimal(profile.opening_balance or 0),
        transaction_id,
    )


def update_agent_transaction(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    transaction_id: str,
    payload: UpdateAgentTransactionRequest,
) -> AgentTransactionSummary:
    own_edit = membership_id == actor.membership.id and "agents.transactions.submit" in actor.permissions
    privileged_edit = _is_admin(actor) or bool({"agents.manage", "finance.manage"}.intersection(actor.permissions))
    if not own_edit and not privileged_edit:
        raise AgentForbiddenError("You cannot edit agent transactions")

    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    transaction = db.scalar(select(AgentTransaction).where(
        AgentTransaction.id == transaction_id,
        AgentTransaction.company_id == actor.membership.company_id,
        AgentTransaction.agent_profile_id == profile.id,
        or_(
            AgentTransaction.project_id.is_(None),
            AgentTransaction.project_id.in_(visible_project_ids(actor.membership.company_id)),
        ),
    ))
    if not transaction:
        raise AgentNotFoundError("Agent transaction not found")
    approval = db.scalar(select(TransactionApproval).where(
        TransactionApproval.transaction_id == transaction.id,
        TransactionApproval.company_id == transaction.company_id,
    ))
    if own_edit and not privileged_edit and approval and approval.status != "pending":
        raise AgentForbiddenError("Agents can only edit their pending transactions")
    finalized = approval is None or approval.status != "pending"
    if finalized and privileged_edit:
        immutable_changed = any((
            payload.transaction_date is not None and payload.transaction_date.date() != transaction.transaction_date.date(),
            (payload.project_id or None) != (transaction.project_id or None),
            payload.transaction_type != transaction.transaction_type,
            Decimal(str(payload.debit)) != Decimal(transaction.debit or 0),
            Decimal(str(payload.credit)) != Decimal(transaction.credit or 0),
        ))
        if immutable_changed:
            raise AgentConflictError(
                "Finalized agent transaction amounts, type, date, and project cannot be rewritten. "
                "Only reference and description metadata may be corrected."
            )

    project = get_project(db, actor, payload.project_id) if payload.project_id and not finalized else None
    editable_fields = ("reference", "description") if finalized else (
        "transaction_date", "project_id", "reference", "transaction_type", "description", "debit", "credit",
    )
    before = {field: getattr(transaction, field) for field in editable_fields}
    transaction.reference = payload.reference
    transaction.description = payload.description
    if not finalized:
        transaction.transaction_date = payload.transaction_date or transaction.transaction_date
        transaction.project_id = project.id if project else None
        transaction.transaction_type = payload.transaction_type
        transaction.debit = Decimal(str(payload.debit))
        transaction.credit = Decimal(str(payload.credit))
    changes = {
        field: {"old": str(before[field]), "new": str(getattr(transaction, field))}
        for field in editable_fields
        if before[field] != getattr(transaction, field)
    }
    write_event(
        db,
        company_id=transaction.company_id,
        event="transaction.updated",
        entity="agent_transaction",
        entity_id=transaction.id,
        actor=actor,
        project_id=transaction.project_id,
        changes={"fields": changes, "approval_status": approval.status if approval else "approved"},
    )
    db.commit()
    db.expire_all()
    return _single_transaction_summary(
        db,
        actor.membership.company_id,
        profile.id,
        Decimal(profile.opening_balance or 0),
        transaction_id,
    )


def delete_agent_transaction(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    transaction_id: str,
) -> None:
    own_delete = membership_id == actor.membership.id and "agents.transactions.submit" in actor.permissions
    privileged_delete = _is_admin(actor) or bool({"agents.manage", "finance.manage"}.intersection(actor.permissions))
    if not own_delete and not privileged_delete:
        raise AgentForbiddenError("You cannot delete agent transactions")

    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)
    transaction = db.scalar(select(AgentTransaction).where(
        AgentTransaction.id == transaction_id,
        AgentTransaction.company_id == actor.membership.company_id,
        AgentTransaction.agent_profile_id == profile.id,
        or_(
            AgentTransaction.project_id.is_(None),
            AgentTransaction.project_id.in_(visible_project_ids(actor.membership.company_id)),
        ),
    ))
    if not transaction:
        raise AgentNotFoundError("Agent transaction not found")
    approval = db.scalar(select(TransactionApproval).where(
        TransactionApproval.transaction_id == transaction.id,
        TransactionApproval.company_id == transaction.company_id,
    ))
    if approval is None or approval.status != "pending":
        raise AgentConflictError(
            "Finalized agent transactions cannot be deleted. Keep the ledger history and use a controlled correction/reversal workflow."
        )
    write_event(
        db,
        company_id=transaction.company_id,
        event="transaction.deleted",
        entity="agent_transaction",
        entity_id=transaction.id,
        actor=actor,
        project_id=transaction.project_id,
        changes={
            "reference": transaction.reference,
            "type": transaction.transaction_type,
            "debit": str(transaction.debit),
            "credit": str(transaction.credit),
            "approval_status": approval.status if approval else "approved",
        },
    )
    if approval:
        db.delete(approval)
    db.delete(transaction)
    db.commit()
