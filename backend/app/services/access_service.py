from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session


if TYPE_CHECKING:
    from app.api.deps import CurrentSession

from app.models.agent import AgentCustomer, AgentProfile
from app.models.workflow import CustomerProject, CustomerQuotation, QuotationRequest


class AccessError(Exception):
    status_code = 403


class NotFoundError(AccessError):
    status_code = 404


def is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


def operational_customer_filter(company_id: str):
    """Authoritative predicate for records that may appear in normal ERP screens.

    We deliberately check both lifecycle fields. ``status`` is the business state
    while ``deleted_at`` is the tombstone. Requiring both to be operational keeps
    partially migrated/legacy soft-deleted rows from leaking into projects,
    quotations, agents, reports, counts, or selectors.
    """
    return and_(
        AgentCustomer.company_id == company_id,
        AgentCustomer.status != "deleted",
        AgentCustomer.deleted_at.is_(None),
    )


def soft_deleted_customer_filter(company_id: str):
    """Rows that belong only in Super Admin recovery/audit paths."""
    return and_(
        AgentCustomer.company_id == company_id,
        or_(
            AgentCustomer.status == "deleted",
            AgentCustomer.deleted_at.is_not(None),
        ),
    )


def visible_customer_ids(company_id: str):
    """Customer ids allowed to participate in normal operational screens/counts."""
    return select(AgentCustomer.id).where(operational_customer_filter(company_id))


def visible_project_ids(company_id: str):
    """Project ids whose owning customer is still operationally visible."""
    return (
        select(CustomerProject.id)
        .where(
            CustomerProject.company_id == company_id,
            CustomerProject.customer_id.in_(visible_customer_ids(company_id)),
        )
    )


def visible_quotation_request_ids(company_id: str):
    """Quotation requests whose owning customer is operationally visible."""
    return select(QuotationRequest.id).where(
        QuotationRequest.company_id == company_id,
        QuotationRequest.customer_id.in_(visible_customer_ids(company_id)),
    )


def visible_quotation_ids(company_id: str):
    """Quotations whose owning customer is operationally visible."""
    return select(CustomerQuotation.id).where(
        CustomerQuotation.company_id == company_id,
        CustomerQuotation.customer_id.in_(visible_customer_ids(company_id)),
    )


def operational_reference_filter(
    company_id: str,
    *,
    customer_column: Any | None = None,
    project_column: Any | None = None,
):
    """Hide rows linked to soft-deleted customers without mutating history.

    Unlinked company-level rows remain visible. Historical records stay in the
    database and are available through lifecycle/audit control paths.
    """
    clauses = []
    if customer_column is not None:
        clauses.append(or_(customer_column.is_(None), customer_column.in_(visible_customer_ids(company_id))))
    if project_column is not None:
        clauses.append(or_(project_column.is_(None), project_column.in_(visible_project_ids(company_id))))
    return and_(*clauses) if clauses else and_(True)


def get_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    include_deleted: bool = False,
) -> AgentCustomer:
    filters = [
        AgentCustomer.id == customer_id,
        AgentCustomer.company_id == actor.membership.company_id,
    ]
    if not include_deleted:
        filters.extend((
            AgentCustomer.status != "deleted",
            AgentCustomer.deleted_at.is_(None),
        ))
    customer = db.scalar(select(AgentCustomer).where(*filters))
    if not customer:
        raise NotFoundError("Customer not found")
    if is_admin(actor) or "agents.view_all" in actor.permissions or "agents.manage" in actor.permissions:
        return customer
    if actor.role == "customer" and customer.customer_membership_id == actor.membership.id:
        return customer
    profile = db.scalar(select(AgentProfile).where(
        AgentProfile.id == customer.agent_profile_id,
        AgentProfile.membership_id == actor.membership.id,
    ))
    if not profile:
        raise AccessError("You can only access assigned customers")
    return customer


def get_project(db: Session, actor: CurrentSession, project_id: str) -> CustomerProject:
    project = db.scalar(select(CustomerProject).where(
        CustomerProject.id == project_id,
        CustomerProject.company_id == actor.membership.company_id,
        CustomerProject.id.in_(visible_project_ids(actor.membership.company_id)),
    ))
    if not project:
        raise NotFoundError("Project not found")
    get_customer(db, actor, project.customer_id)
    return project
