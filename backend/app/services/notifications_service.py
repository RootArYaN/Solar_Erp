from __future__ import annotations

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.api.deps import CurrentSession
from app.models.agent import AgentTransaction
from app.models.finance import Bill
from app.models.operations import GeneratedDocumentPack
from app.models.tasks import Task, TaskAssignment
from app.models.workflow import CustomerQuotation, QuotationRequest, TransactionApproval
from app.schemas.notifications import WorkspaceNotificationChannel, WorkspaceNotificationSummary
from app.services.access_service import operational_reference_filter, visible_customer_ids, visible_project_ids
from app.services.tasks_service import _operational_task_filter


def _can(actor: CurrentSession, permission: str) -> bool:
    return actor.user.is_super_admin or permission in actor.permissions


def notification_summary(db: Session, actor: CurrentSession) -> WorkspaceNotificationSummary:
    company_id = actor.membership.company_id
    channels: list[WorkspaceNotificationChannel] = []

    if _can(actor, "tasks.view"):
        now = datetime.now(UTC)
        open_count, overdue_count = db.execute(
            select(
                func.count(TaskAssignment.id).filter(TaskAssignment.status != "done"),
                func.count(TaskAssignment.id).filter(
                    TaskAssignment.status != "done", Task.due_at.is_not(None), Task.due_at < now
                ),
            )
            .select_from(TaskAssignment)
            .join(Task, Task.id == TaskAssignment.task_id)
            .where(
                Task.company_id == company_id,
                TaskAssignment.membership_id == actor.membership.id,
                _operational_task_filter(company_id),
            )
        ).one()
        task_count = int(open_count or 0)
        overdue = int(overdue_count or 0)
        if task_count:
            channels.append(WorkspaceNotificationChannel(
                key="tasks",
                title="Tasks",
                detail=f"{overdue} overdue task{'s' if overdue != 1 else ''}" if overdue else "Assigned work is ready to continue",
                count=task_count,
            ))

    approval_count = 0
    if _can(actor, "quotations.approve"):
        pending_requests = db.scalar(
            select(func.count()).select_from(QuotationRequest).where(
                QuotationRequest.company_id == company_id,
                QuotationRequest.status == "pending",
                QuotationRequest.customer_id.in_(visible_customer_ids(company_id)),
            )
        ) or 0
        pending_quotations = db.scalar(
            select(func.count()).select_from(CustomerQuotation).where(
                CustomerQuotation.company_id == company_id,
                CustomerQuotation.status == "pending_approval",
                CustomerQuotation.customer_id.in_(visible_customer_ids(company_id)),
            )
        ) or 0
        approval_count += int(pending_requests) + int(pending_quotations)
    if _can(actor, "agents.transactions.approve"):
        approval_count += int(db.scalar(
            select(func.count())
            .select_from(TransactionApproval)
            .join(AgentTransaction, AgentTransaction.id == TransactionApproval.transaction_id)
            .where(
                TransactionApproval.company_id == company_id,
                TransactionApproval.status == "pending",
                AgentTransaction.company_id == company_id,
                or_(
                    AgentTransaction.project_id.is_(None),
                    AgentTransaction.project_id.in_(visible_project_ids(company_id)),
                ),
            )
        ) or 0)
    if approval_count:
        channels.append(WorkspaceNotificationChannel(
            key="approvals",
            title="Approvals",
            detail="Quotation and transaction decisions need attention",
            count=approval_count,
        ))

    if _can(actor, "finance.view") or _can(actor, "finance.manage"):
        finance_count = int(db.scalar(
            select(func.count()).select_from(Bill).where(
                Bill.company_id == company_id,
                Bill.status == "issued",
                Bill.payment_status.in_(("unpaid", "partial")),
                Bill.due_date.is_not(None),
                Bill.due_date <= date.today(),
                operational_reference_filter(
                    company_id,
                    customer_column=Bill.customer_id,
                    project_column=Bill.project_id,
                ),
            )
        ) or 0)
        if finance_count:
            channels.append(WorkspaceNotificationChannel(
                key="finance",
                title="Finance",
                detail="Bills are due or still awaiting payment",
                count=finance_count,
            ))

    if _can(actor, "documents.approve") or _can(actor, "documents.manage"):
        document_count = int(db.scalar(
            select(func.count()).select_from(GeneratedDocumentPack).where(
                GeneratedDocumentPack.company_id == company_id,
                GeneratedDocumentPack.status == "generated",
                GeneratedDocumentPack.customer_id.in_(visible_customer_ids(company_id)),
            )
        ) or 0)
        if document_count:
            channels.append(WorkspaceNotificationChannel(
                key="documents",
                title="Documents",
                detail="Generated document packs are ready to finalize",
                count=document_count,
            ))

    return WorkspaceNotificationSummary(
        channels=channels,
        total=sum(channel.count for channel in channels),
    )
