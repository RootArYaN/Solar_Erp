from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.schemas.finance import RecordBillPaymentRequest
from app.services import finance_service


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _PaymentSummarySession:
    def __init__(self, rows):
        self.rows = rows
        self.statement = None

    def execute(self, statement):
        self.statement = statement
        return _Rows(self.rows)


def test_bill_payment_summary_exposes_the_hidden_ledger_details():
    created_at = datetime(2026, 8, 6, tzinfo=UTC)
    payment = SimpleNamespace(id='payment-1', bill_id='bill-1', amount=Decimal('1250.00'), created_at=created_at)
    transaction = SimpleNamespace(
        id='transaction-1', transaction_number='TXN-001', transaction_date=date(2026, 8, 5),
        source_id='bill-1', amount=Decimal('1250.00'), created_at=created_at,
        payment_method='bank', reference_number='UTR-001', description='Supplier payment', status='posted',
    )
    account = SimpleNamespace(id='account-1', name='Main Bank')
    db = _PaymentSummarySession([(transaction, account, payment)])

    result = finance_service._bill_payment_summaries(db, {'bill-1'}, {'company-1'})

    summary = result['bill-1'][0]
    assert summary.transaction_number == 'TXN-001'
    assert summary.account_name == 'Main Bank'
    assert summary.amount == 1250.0
    assert 'finance_transactions.source_type' in str(db.statement)


def test_bill_payment_summary_recovers_a_legacy_transaction_without_a_payment_link():
    created_at = datetime(2026, 7, 1, tzinfo=UTC)
    transaction = SimpleNamespace(
        id='legacy-transaction', transaction_number='TXN-OLD', transaction_date=date(2026, 7, 1),
        source_id='bill-1', amount=Decimal('3680217.00'), created_at=created_at,
        payment_method='bank', reference_number='', description='Legacy supplier payment', status='posted',
    )
    account = SimpleNamespace(id='account-1', name='Main Bank')
    db = _PaymentSummarySession([(transaction, account, None)])

    result = finance_service._bill_payment_summaries(db, {'bill-1'}, {'company-1'})

    summary = result['bill-1'][0]
    assert summary.id == 'legacy-transaction'
    assert summary.transaction_id == 'legacy-transaction'
    assert summary.amount == 3680217.0


def test_deleting_a_bill_payment_recalculates_through_its_linked_transaction(monkeypatch):
    bill = SimpleNamespace(id='bill-1', company_id='company-1')
    payment = SimpleNamespace(id='payment-1', bill_id='bill-1', company_id='company-1', transaction_id='transaction-1')

    class _Session:
        def __init__(self):
            self.rows = iter([bill, payment])
            self.committed = False
            self.refreshed = None

        def scalar(self, _statement):
            return next(self.rows)

        def commit(self):
            self.committed = True

        def refresh(self, row):
            self.refreshed = row

    db = _Session()
    deleted: list[str] = []
    monkeypatch.setattr(finance_service, '_delete_transaction_tree', lambda _db, _actor, transaction_id, _seen: deleted.append(transaction_id))
    monkeypatch.setattr(finance_service, '_bill_summary', lambda _db, row: {'id': row.id})
    actor = SimpleNamespace(membership=SimpleNamespace(company_id='company-1'))

    result = finance_service.delete_bill_payment(db, actor, 'bill-1', 'payment-1')

    assert deleted == ['transaction-1']
    assert db.committed is True
    assert db.refreshed is bill
    assert result == {'id': 'bill-1'}


def test_deleting_a_legacy_bill_payment_recalculates_the_bill(monkeypatch):
    bill = SimpleNamespace(
        id='bill-1', company_id='company-1', paid_amount=Decimal('1500.00'),
        total_amount=Decimal('2000.00'), balance_amount=Decimal('500.00'),
        payment_status='partially_paid',
    )
    transaction = SimpleNamespace(id='transaction-1', amount=Decimal('1000.00'))

    class _Session:
        def __init__(self):
            self.rows = iter([bill, None, transaction])

        def scalar(self, _statement):
            return next(self.rows)

        def commit(self):
            pass

        def refresh(self, _row):
            pass

    deleted: list[str] = []
    monkeypatch.setattr(finance_service, '_delete_transaction_tree', lambda _db, _actor, transaction_id, _seen: deleted.append(transaction_id))
    monkeypatch.setattr(finance_service, '_bill_summary', lambda _db, row: {'id': row.id})
    actor = SimpleNamespace(membership=SimpleNamespace(company_id='company-1'))

    result = finance_service.delete_bill_payment(_Session(), actor, 'bill-1', 'transaction-1')

    assert deleted == ['transaction-1']
    assert bill.paid_amount == Decimal('500.00')
    assert bill.balance_amount == Decimal('1500.00')
    assert bill.payment_status == 'partially_paid'
    assert result == {'id': 'bill-1'}


def test_purchase_bill_payment_cannot_overdraw_the_selected_account(monkeypatch):
    bill = SimpleNamespace(
        id='bill-1', company_id='company-1', status='issued', bill_type='purchase',
        balance_amount=Decimal('2000.00'),
    )
    db = SimpleNamespace(scalar=lambda _statement: bill)
    actor = SimpleNamespace(membership=SimpleNamespace(company_id='company-1'))
    account = SimpleNamespace(id='account-1')
    monkeypatch.setattr(finance_service, '_load_account', lambda _db, _actor, _account_id: account)
    monkeypatch.setattr(finance_service, '_account_balance', lambda _db, _account: Decimal('500.00'))
    payload = RecordBillPaymentRequest(
        transaction_date=date(2026, 8, 6), amount=1000, account_id='account-1',
    )

    with pytest.raises(finance_service.FinanceConflictError, match='does not have enough balance'):
        finance_service.record_bill_payment(db, actor, 'bill-1', payload)
