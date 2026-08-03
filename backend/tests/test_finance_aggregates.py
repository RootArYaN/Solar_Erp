from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace

from app.services.finance_service import list_accounts, profitability


class _Result:
    def __init__(self, *, one=None, all_rows=None):
        self._one = one
        self._all_rows = all_rows

    def one(self):
        return self._one

    def all(self):
        return self._all_rows


class _RecordingSession:
    def __init__(self, results: list[_Result]):
        self._results = iter(results)
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)
        return next(self._results)


def _actor(company_id: str = 'company-1'):
    return SimpleNamespace(membership=SimpleNamespace(company_id=company_id))


def test_list_accounts_aggregates_all_balances_in_one_query():
    account = SimpleNamespace(
        id='account-1',
        name='Main Bank',
        account_type='bank',
        bank_name='Example Bank',
        masked_account_number='****1234',
        opening_balance=Decimal('50.00'),
        is_active=True,
        updated_at=datetime(2026, 8, 3, tzinfo=UTC),
    )
    db = _RecordingSession([
        _Result(all_rows=[(account, Decimal('200.00'), Decimal('20.00'))]),
    ])

    summaries = list_accounts(db, _actor())

    assert len(db.statements) == 1
    assert len(summaries) == 1
    assert summaries[0].current_balance == 230.0


def test_profitability_uses_three_fixed_aggregate_queries():
    project = SimpleNamespace(
        id='project-1',
        project_number='PRJ-001',
        name='Rooftop Solar',
        approved_value=Decimal('1000.00'),
    )
    db = _RecordingSession([
        _Result(one=(Decimal('1000.00'), Decimal('400.00'))),
        _Result(one=(
            Decimal('700.00'),
            Decimal('250.00'),
            Decimal('50.00'),
            Decimal('150.00'),
            Decimal('100.00'),
        )),
        _Result(all_rows=[(project, Decimal('300.00'), Decimal('120.00'))]),
    ])

    summary = profitability(db, _actor())

    assert len(db.statements) == 3
    assert summary.money_received == 700.0
    assert summary.net_cash_flow == 450.0
    assert summary.estimated_gross_profit == 450.0
    assert summary.projects == [{
        'project_id': 'project-1',
        'project_number': 'PRJ-001',
        'project_name': 'Rooftop Solar',
        'sales_value': 1000.0,
        'money_received': 300.0,
        'cost': 120.0,
        'gross_profit': 880.0,
    }]
