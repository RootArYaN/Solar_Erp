from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentProfile, AgentTransaction
from app.models.auth import Membership, Role, User
from app.schemas.agent import (
    AgentCustomerSummary,
    AgentListItem,
    AgentOverviewResponse,
    AgentProfileSummary,
    AgentTransactionSummary,
    CreateAgentTransactionRequest,
    UpdateAgentProfileRequest,
)


class AgentServiceError(Exception):
    status_code = 400


class AgentNotFoundError(AgentServiceError):
    status_code = 404


class AgentForbiddenError(AgentServiceError):
    status_code = 403


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
        .join(Membership.roles)
        .where(
            Membership.id == membership_id,
            Membership.company_id == company_id,
            Role.code == "agent",
        )
        .options(selectinload(Membership.user), selectinload(Membership.roles))
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


def _assert_can_view(actor: CurrentSession, membership_id: str) -> None:
    if membership_id != actor.membership.id and not _can_view_all(actor):
        raise AgentForbiddenError("You can only view your own agent overview")


def _assert_can_edit_profile(actor: CurrentSession, membership_id: str) -> None:
    if membership_id != actor.membership.id and "agents.manage" not in actor.permissions and not actor.user.is_super_admin:
        raise AgentForbiddenError("You cannot edit this agent profile")


def _money(value: Decimal | float | int | None) -> float:
    return round(float(value or 0), 2)


def _current_balance(profile: AgentProfile) -> Decimal:
    return Decimal(profile.opening_balance or 0) + sum(
        (Decimal(transaction.credit or 0) - Decimal(transaction.debit or 0) for transaction in profile.transactions),
        Decimal("0.00"),
    )


def list_agents(db: Session, actor: CurrentSession) -> list[AgentListItem]:
    statement = (
        select(Membership)
        .join(Membership.roles)
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
        result.append(
            AgentListItem(
                membership_id=membership.id,
                full_name=membership.user.full_name,
                email=membership.user.email,
                phone=profile.phone,
                city=profile.city,
                is_active=membership.is_active and membership.user.is_active,
                customer_count=len(profile.customers),
                current_balance=_money(_current_balance(profile)),
            )
        )
    if created_profile:
        db.commit()
    return result


def get_agent_overview(db: Session, actor: CurrentSession, membership_id: str) -> AgentOverviewResponse:
    _assert_can_view(actor, membership_id)
    membership = _load_agent_membership(db, actor.membership.company_id, membership_id)
    profile = _load_profile(db, membership)

    ordered_transactions = sorted(profile.transactions, key=lambda item: (item.transaction_date, item.created_at))
    running_balance = Decimal(profile.opening_balance or 0)
    transaction_summaries: list[AgentTransactionSummary] = []
    for transaction in ordered_transactions:
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
            )
        )

    customers = sorted(profile.customers, key=lambda item: item.customer_name.lower())
    current_balance = _current_balance(profile)
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
        customers=[
            AgentCustomerSummary(
                id=customer.id,
                customer_name=customer.customer_name,
                company_name=customer.company_name,
                email=customer.email,
                phone=customer.phone,
                address=customer.address,
                project_name=customer.project_name,
                status=customer.status,
                outstanding_balance=_money(customer.outstanding_balance),
            )
            for customer in customers
        ],
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


def create_agent_transaction(
    db: Session,
    actor: CurrentSession,
    membership_id: str,
    payload: CreateAgentTransactionRequest,
) -> AgentTransactionSummary:
    if not actor.user.is_super_admin and not {"agents.manage", "finance.manage"}.intersection(actor.permissions):
        raise AgentForbiddenError("You cannot post agent transactions")

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
    db.commit()
    transaction_id = transaction.id
    db.expire_all()

    overview = get_agent_overview(db, actor, membership_id)
    return next(item for item in overview.transactions if item.id == transaction_id)
