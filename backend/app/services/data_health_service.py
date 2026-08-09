from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentTransaction
from app.models.finance import Bill, FinanceTransaction
from app.models.operations import InventoryBalance, InventoryMovement
from app.models.system import StoredFile
from app.models.workflow import CustomerProject
from app.schemas.admin import DataHealthCheck, DataHealthSummary


OPEN_PROJECT_STATUSES = {
    "planning",
    "procurement",
    "installation",
    "commissioning",
    "active",
    "on_hold",
}


def _check(
    db: Session,
    *,
    key: str,
    label: str,
    severity: str,
    description: str,
    id_statement,
) -> DataHealthCheck:
    subquery = id_statement.subquery()
    count = int(db.scalar(select(func.count()).select_from(subquery)) or 0)
    sample_ids = [str(value) for value in db.scalars(id_statement.limit(5)).all()]
    return DataHealthCheck(
        key=key,
        label=label,
        severity=severity if count else "ok",
        count=count,
        description=description,
        sample_ids=sample_ids,
    )


def inspect_data_health(db: Session, actor: CurrentSession) -> DataHealthSummary:
    company_id = actor.membership.company_id

    reversal_alias = InventoryMovement.__table__.alias("reversal_child")
    customer_alias = AgentCustomer.__table__.alias("health_customer")
    project_alias = CustomerProject.__table__.alias("health_project")

    checks = [
        _check(
            db,
            key="inventory_reserved_exceeds_on_hand",
            label="Reserved stock exceeds on-hand",
            severity="critical",
            description="Current stock is lower than its reserved quantity and needs reconciliation.",
            id_statement=select(InventoryBalance.id).where(
                InventoryBalance.company_id == company_id,
                InventoryBalance.reserved_quantity > InventoryBalance.quantity_on_hand,
            ),
        ),
        _check(
            db,
            key="completed_customer_open_balance",
            label="Completed customers with balance",
            severity="warning",
            description="Completed customers should normally have no outstanding balance.",
            id_statement=select(AgentCustomer.id).where(
                AgentCustomer.company_id == company_id,
                AgentCustomer.status == "completed",
                AgentCustomer.outstanding_balance != Decimal("0.00"),
            ),
        ),
        _check(
            db,
            key="completed_customer_open_project",
            label="Completed customers with open projects",
            severity="critical",
            description="A completed customer still has operational project work.",
            id_statement=select(AgentCustomer.id).join(
                CustomerProject,
                CustomerProject.customer_id == AgentCustomer.id,
            ).where(
                AgentCustomer.company_id == company_id,
                AgentCustomer.status == "completed",
                CustomerProject.company_id == company_id,
                CustomerProject.status.in_(OPEN_PROJECT_STATUSES),
            ).distinct(),
        ),
        _check(
            db,
            key="bill_balance_mismatch",
            label="Bill balance mismatches",
            severity="critical",
            description="Paid amount plus balance differs from the bill total by more than one paisa.",
            id_statement=select(Bill.id).where(
                Bill.company_id == company_id,
                func.abs((Bill.paid_amount + Bill.balance_amount) - Bill.total_amount) > Decimal("0.01"),
            ),
        ),
        _check(
            db,
            key="duplicate_inventory_reversal",
            label="Duplicate inventory reversals",
            severity="critical",
            description="More than one movement points to the same original reversal target.",
            id_statement=select(InventoryMovement.reversed_movement_id).where(
                InventoryMovement.company_id == company_id,
                InventoryMovement.reversed_movement_id.is_not(None),
            ).group_by(InventoryMovement.reversed_movement_id).having(func.count() > 1),
        ),
        _check(
            db,
            key="corrected_movement_missing_reversal",
            label="Corrections missing reversal rows",
            severity="critical",
            description="A movement is marked corrected but no reversal row references it.",
            id_statement=select(InventoryMovement.id).where(
                InventoryMovement.company_id == company_id,
                InventoryMovement.status == "corrected",
                ~exists(select(reversal_alias.c.id).where(
                    reversal_alias.c.company_id == company_id,
                    reversal_alias.c.reversed_movement_id == InventoryMovement.id,
                )),
            ),
        ),
        _check(
            db,
            key="deleted_customer_posted_finance",
            label="Deleted customers with posted finance",
            severity="warning",
            description="Expected for preserved history, but useful for reviewing deleted-master references.",
            id_statement=select(FinanceTransaction.id).join(
                AgentCustomer,
                AgentCustomer.id == FinanceTransaction.customer_id,
            ).where(
                FinanceTransaction.company_id == company_id,
                FinanceTransaction.status == "posted",
                AgentCustomer.company_id == company_id,
                AgentCustomer.status == "deleted",
            ),
        ),
        _check(
            db,
            key="orphaned_customer_file",
            label="Orphaned customer files",
            severity="warning",
            description="A stored file references a customer identifier that no longer exists.",
            id_statement=select(StoredFile.id).where(
                StoredFile.company_id == company_id,
                StoredFile.customer_id.is_not(None),
                ~exists(select(customer_alias.c.id).where(
                    customer_alias.c.id == StoredFile.customer_id,
                    customer_alias.c.company_id == company_id,
                )),
            ),
        ),
        _check(
            db,
            key="orphaned_agent_transaction_project",
            label="Agent transactions with missing projects",
            severity="critical",
            description="Agent transaction project_id is a logical link without a database foreign key; orphan values must be repaired before adding the FK constraint.",
            id_statement=select(AgentTransaction.id).where(
                AgentTransaction.company_id == company_id,
                AgentTransaction.project_id.is_not(None),
                ~exists(select(project_alias.c.id).where(
                    project_alias.c.id == AgentTransaction.project_id,
                    project_alias.c.company_id == company_id,
                )),
            ),
        ),
    ]
    return DataHealthSummary(
        generated_at=datetime.now(UTC),
        issue_count=sum(check.count for check in checks),
        checks=checks,
    )
