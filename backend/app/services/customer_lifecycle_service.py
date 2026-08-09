from __future__ import annotations

from typing import TYPE_CHECKING

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session


if TYPE_CHECKING:
    from app.api.deps import CurrentSession

from app.models.agent import AgentCustomer
from app.models.finance import Bill, CustomerLoan, FinanceTransaction
from app.models.operations import GeneratedDocumentPack, InventoryMovement
from app.models.system import AuditEvent, StoredFile
from app.models.workflow import CustomerProject, CustomerQuotation, QuotationRequest
from app.schemas.customer_flow import CustomerDependencyPreview
from app.services.audit_service import write_event


class CustomerLifecycleError(Exception):
    status_code = 400


class CustomerLifecycleNotFoundError(CustomerLifecycleError):
    status_code = 404


class CustomerLifecycleForbiddenError(CustomerLifecycleError):
    status_code = 403


class CustomerLifecycleConflictError(CustomerLifecycleError):
    status_code = 409


OPEN_PROJECT_STATUSES = {
    "planning",
    "procurement",
    "installation",
    "commissioning",
    "active",
    "on_hold",
}


def _assert_super_admin(actor: CurrentSession) -> None:
    if not actor.user.is_super_admin:
        raise CustomerLifecycleForbiddenError("Super administrator access required")


def _assert_customer_manager(actor: CurrentSession) -> None:
    if actor.user.is_super_admin:
        return
    if {"customers.edit", "agents.manage"}.isdisjoint(actor.permissions):
        raise CustomerLifecycleForbiddenError("Customer management access required")


def _load(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    for_update: bool = False,
) -> AgentCustomer:
    statement = select(AgentCustomer).where(
        AgentCustomer.id == customer_id,
        AgentCustomer.company_id == actor.membership.company_id,
    )
    if for_update:
        statement = statement.with_for_update()
    customer = db.scalar(statement)
    if not customer:
        raise CustomerLifecycleNotFoundError("Customer not found")
    return customer


def _count(db: Session, model, *filters) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(*filters)) or 0)


def dependency_preview(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
) -> CustomerDependencyPreview:
    customer = _load(db, actor, customer_id)
    company_id = actor.membership.company_id

    projects = _count(
        db,
        CustomerProject,
        CustomerProject.company_id == company_id,
        CustomerProject.customer_id == customer.id,
    )
    open_projects = _count(
        db,
        CustomerProject,
        CustomerProject.company_id == company_id,
        CustomerProject.customer_id == customer.id,
        CustomerProject.status.in_(OPEN_PROJECT_STATUSES),
    )
    quotation_requests = _count(
        db,
        QuotationRequest,
        QuotationRequest.company_id == company_id,
        QuotationRequest.customer_id == customer.id,
    )
    quotations = _count(
        db,
        CustomerQuotation,
        CustomerQuotation.company_id == company_id,
        CustomerQuotation.customer_id == customer.id,
    )
    finance_transactions = _count(
        db,
        FinanceTransaction,
        FinanceTransaction.company_id == company_id,
        FinanceTransaction.customer_id == customer.id,
    )
    posted_finance_transactions = _count(
        db,
        FinanceTransaction,
        FinanceTransaction.company_id == company_id,
        FinanceTransaction.customer_id == customer.id,
        FinanceTransaction.status == "posted",
    )
    bills = _count(
        db,
        Bill,
        Bill.company_id == company_id,
        Bill.customer_id == customer.id,
    )
    open_bills = _count(
        db,
        Bill,
        Bill.company_id == company_id,
        Bill.customer_id == customer.id,
        Bill.status.not_in(("void", "cancelled")),
        Bill.balance_amount > 0,
    )
    inventory_movements = _count(
        db,
        InventoryMovement,
        InventoryMovement.company_id == company_id,
        InventoryMovement.customer_id == customer.id,
    )
    documents = _count(
        db,
        StoredFile,
        StoredFile.company_id == company_id,
        StoredFile.customer_id == customer.id,
    )
    generated_document_packs = _count(
        db,
        GeneratedDocumentPack,
        GeneratedDocumentPack.company_id == company_id,
        GeneratedDocumentPack.customer_id == customer.id,
    )
    customer_loans = _count(
        db,
        CustomerLoan,
        CustomerLoan.company_id == company_id,
        CustomerLoan.customer_id == customer.id,
    )
    audit_events = _count(
        db,
        AuditEvent,
        AuditEvent.company_id == company_id,
        AuditEvent.customer_id == customer.id,
    )

    completion_blockers: list[str] = []
    if Decimal(customer.outstanding_balance or 0) != 0:
        completion_blockers.append("Customer has an outstanding balance")
    if open_projects:
        completion_blockers.append(f"{open_projects} project(s) are still operational")
    if open_bills:
        completion_blockers.append(f"{open_bills} bill(s) still have an outstanding balance")

    purge_blockers: list[str] = []
    protected_counts = (
        (projects, "projects"),
        (quotation_requests, "quotation requests"),
        (quotations, "quotations"),
        (finance_transactions, "finance transactions"),
        (bills, "bills"),
        (inventory_movements, "inventory movements"),
        (documents, "documents"),
        (generated_document_packs, "generated document packs"),
        (customer_loans, "customer loans"),
    )
    for count, label in protected_counts:
        if count:
            purge_blockers.append(f"{count} {label}")

    return CustomerDependencyPreview(
        customer_id=customer.id,
        customer_name=customer.customer_name,
        status=customer.status,
        outstanding_balance=f"{Decimal(customer.outstanding_balance or 0):.2f}",
        projects=projects,
        open_projects=open_projects,
        quotation_requests=quotation_requests,
        quotations=quotations,
        finance_transactions=finance_transactions,
        posted_finance_transactions=posted_finance_transactions,
        bills=bills,
        open_bills=open_bills,
        inventory_movements=inventory_movements,
        documents=documents + generated_document_packs,
        audit_events=audit_events,
        can_complete=not completion_blockers and customer.status not in {"deleted", "archived"},
        completion_blockers=completion_blockers,
        can_purge=customer.status == "deleted" and not purge_blockers,
        purge_blockers=purge_blockers,
    )


def complete_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str = "",
    force: bool = False,
) -> AgentCustomer:
    _assert_customer_manager(actor)
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status == "deleted":
        raise CustomerLifecycleConflictError("Restore the customer before completing it")
    if customer.status == "archived":
        raise CustomerLifecycleConflictError("Restore/reactivate the customer before completing it")
    if customer.status == "completed":
        raise CustomerLifecycleConflictError("Customer is already completed")

    preview = dependency_preview(db, actor, customer.id)
    if preview.completion_blockers and not force:
        raise CustomerLifecycleConflictError("; ".join(preview.completion_blockers))
    cleaned_reason = reason.strip()
    if force and not actor.user.is_super_admin:
        raise CustomerLifecycleForbiddenError("Only Super Admin can force customer completion")
    if preview.completion_blockers and force and not cleaned_reason:
        raise CustomerLifecycleConflictError("A reason is required to force customer completion")

    previous = customer.status
    customer.status = "completed"
    customer.completed_at = datetime.now(UTC)
    customer.archived_at = None
    customer.deleted_at = None
    write_event(
        db,
        company_id=customer.company_id,
        event="customer.completed",
        entity="customer",
        entity_id=customer.id,
        actor=actor,
        customer_id=customer.id,
        changes={
            "before_status": previous,
            "after_status": "completed",
            "forced": bool(preview.completion_blockers),
            "reason": cleaned_reason,
            "blockers": preview.completion_blockers,
        },
    )
    db.commit()
    return customer


def reactivate_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str = "",
    commit: bool = True,
    source: str = "manual",
) -> AgentCustomer:
    _assert_customer_manager(actor)
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status == "deleted":
        raise CustomerLifecycleConflictError("Deleted customers must be restored by Super Admin")
    if customer.status == "archived":
        if not actor.user.is_super_admin:
            raise CustomerLifecycleConflictError("Archived customers must be restored by Super Admin")
        customer.archived_at = None
    if customer.status not in {"completed", "archived"}:
        return customer

    previous = customer.status
    customer.status = "active"
    customer.completed_at = None
    customer.archived_at = None
    write_event(
        db,
        company_id=customer.company_id,
        event="customer.reactivated",
        entity="customer",
        entity_id=customer.id,
        actor=actor,
        customer_id=customer.id,
        changes={"before_status": previous, "after_status": "active", "reason": reason.strip(), "source": source},
    )
    if commit:
        db.commit()
    return customer


def reactivate_for_activity(
    db: Session,
    actor: CurrentSession,
    customer_id: str | None,
    *,
    source: str,
) -> None:
    if not customer_id:
        return
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status == "completed":
        reactivate_customer(db, actor, customer.id, commit=False, source=source)
    elif customer.status == "deleted":
        raise CustomerLifecycleConflictError("Cannot create activity for a deleted customer")
    elif customer.status == "archived":
        raise CustomerLifecycleConflictError("Reactivate the archived customer before creating new activity")


def archive_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str = "",
) -> AgentCustomer:
    _assert_super_admin(actor)
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status == "deleted":
        raise CustomerLifecycleConflictError("Customer is deleted")
    if customer.status == "archived":
        raise CustomerLifecycleConflictError("Customer is already archived")
    previous = customer.status
    customer.status = "archived"
    customer.archived_at = datetime.now(UTC)
    write_event(
        db,
        company_id=customer.company_id,
        event="customer.archived",
        entity="customer",
        entity_id=customer.id,
        actor=actor,
        customer_id=customer.id,
        changes={"before_status": previous, "after_status": "archived", "reason": reason.strip()},
    )
    db.commit()
    return customer


def soft_delete_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str,
) -> AgentCustomer:
    _assert_super_admin(actor)
    cleaned_reason = reason.strip()
    if not cleaned_reason:
        raise CustomerLifecycleConflictError("A reason is required to delete a customer")
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status == "deleted":
        raise CustomerLifecycleConflictError("Customer is already deleted")
    preview = dependency_preview(db, actor, customer.id)
    previous = customer.status
    customer.status = "deleted"
    customer.deleted_at = datetime.now(UTC)
    customer.deleted_by = actor.membership.id
    customer.delete_reason = cleaned_reason
    customer.restored_at = None
    customer.restored_by = None
    write_event(
        db,
        company_id=customer.company_id,
        event="customer.deleted",
        entity="customer",
        entity_id=customer.id,
        actor=actor,
        customer_id=customer.id,
        changes={
            "before_status": previous,
            "after_status": "deleted",
            "reason": cleaned_reason,
            "impact": preview.model_dump(exclude={"customer_name"}),
        },
    )
    db.commit()
    return customer


def restore_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str = "",
) -> AgentCustomer:
    _assert_super_admin(actor)
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status != "deleted":
        raise CustomerLifecycleConflictError("Only deleted customers can be restored")
    preview = dependency_preview(db, actor, customer.id)
    next_status = "active" if (
        preview.open_projects
        or preview.open_bills
        or Decimal(customer.outstanding_balance or 0) != 0
    ) else ("completed" if customer.completed_at else "active")
    customer.status = next_status
    customer.deleted_at = None
    customer.deleted_by = None
    customer.delete_reason = ""
    customer.restored_at = datetime.now(UTC)
    customer.restored_by = actor.membership.id
    write_event(
        db,
        company_id=customer.company_id,
        event="customer.restored",
        entity="customer",
        entity_id=customer.id,
        actor=actor,
        customer_id=customer.id,
        changes={"after_status": next_status, "reason": reason.strip()},
    )
    db.commit()
    return customer


def purge_customer(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    *,
    reason: str,
) -> None:
    _assert_super_admin(actor)
    cleaned_reason = reason.strip()
    if not cleaned_reason:
        raise CustomerLifecycleConflictError("A reason is required for permanent purge")
    customer = _load(db, actor, customer_id, for_update=True)
    if customer.status != "deleted":
        raise CustomerLifecycleConflictError("Soft delete the customer before permanent purge")
    preview = dependency_preview(db, actor, customer.id)
    if not preview.can_purge:
        raise CustomerLifecycleConflictError(
            "Permanent purge blocked because historical dependencies exist: "
            + ", ".join(preview.purge_blockers)
        )

    company_id = customer.company_id
    internal_id = customer.id
    # Keep only a minimal, non-personal audit marker for the destructive action.
    write_event(
        db,
        company_id=company_id,
        event="customer.purged",
        entity="customer",
        entity_id=internal_id,
        actor=actor,
        changes={"reason": cleaned_reason},
    )
    db.delete(customer)
    db.commit()
