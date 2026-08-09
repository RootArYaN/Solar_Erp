from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.schemas.finance import ReverseFinanceTransactionRequest, UpdateFinanceTransactionRequest
from app.services import finance_service, operations_service


class ScalarDB:
    def __init__(self, values):
        self.values = iter(values)
        self.committed = False

    def scalar(self, _statement):
        return next(self.values)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.committed = False


def actor():
    return SimpleNamespace(
        user=SimpleNamespace(is_super_admin=True),
        membership=SimpleNamespace(company_id="company-1", id="membership-1"),
        permissions=["finance.manage", "inventory.manage"],
    )


def movement(**overrides):
    values = dict(
        id="movement-1",
        company_id="company-1",
        status="completed",
        movement_type="inward",
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_inventory_double_reversal_is_rejected():
    db = ScalarDB(["existing-reversal-id"])
    with pytest.raises(operations_service.OperationsConflictError, match="already been reversed"):
        operations_service._assert_movement_reversible(db, movement())


def test_inventory_non_finalized_movement_is_rejected_before_lookup():
    db = ScalarDB([])
    with pytest.raises(operations_service.OperationsConflictError, match="Only completed"):
        operations_service._assert_movement_reversible(db, movement(status="draft"))


def test_inventory_absolute_adjustment_requires_new_adjustment():
    db = ScalarDB([])
    with pytest.raises(operations_service.OperationsConflictError, match="cannot be safely reversed"):
        operations_service._assert_movement_reversible(db, movement(movement_type="adjustment"))


def test_finalized_finance_amount_cannot_be_overwritten():
    row = SimpleNamespace(
        id="txn-1",
        company_id="company-1",
        status="posted",
        transaction_date=date(2026, 8, 7),
        direction="credit",
        category_id=None,
        amount=Decimal("100.00"),
        account_id="account-1",
        source_type="customer_payment",
    )
    db = ScalarDB([row])
    payload = UpdateFinanceTransactionRequest(
        transaction_date=date(2026, 8, 7),
        direction="credit",
        category_id=None,
        amount=80,
        account_id="account-1",
        payment_method="bank",
        source_type="customer_payment",
        reference_number="REF",
        description="Correction attempt",
    )
    with pytest.raises(finance_service.FinanceConflictError, match="Reverse the transaction"):
        finance_service.update_transaction(db, actor(), row.id, payload)
    assert db.committed is False


def test_deleted_finance_transaction_cannot_be_deleted_twice():
    row = SimpleNamespace(
        id="txn-deleted",
        company_id="company-1",
        status="deleted",
        reversed_transaction_id=None,
    )
    db = ScalarDB([row])
    payload = ReverseFinanceTransactionRequest(
        transaction_date=date(2026, 8, 8),
        reason="Duplicate delete guard",
    )
    with pytest.raises(finance_service.FinanceConflictError, match="already been deleted"):
        finance_service.delete_transaction(db, actor(), row.id, payload)
