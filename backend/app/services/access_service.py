from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentProfile
from app.models.workflow import CustomerProject


class AccessError(Exception):
    status_code = 403


class NotFoundError(AccessError):
    status_code = 404


def is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


def get_customer(db: Session, actor: CurrentSession, customer_id: str) -> AgentCustomer:
    customer = db.scalar(select(AgentCustomer).where(
        AgentCustomer.id == customer_id,
        AgentCustomer.company_id == actor.membership.company_id,
    ))
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
    ))
    if not project:
        raise NotFoundError("Project not found")
    get_customer(db, actor, project.customer_id)
    return project
