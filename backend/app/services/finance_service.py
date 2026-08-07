from __future__ import annotations

import tempfile
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer
from app.models.auth import Membership, User
from app.models.finance import (
    Bill,
    BillPayment,
    CompanyLoan,
    CustomerLoan,
    FinanceCategory,
    FinanceTransaction,
    FinancialAccount,
)
from app.models.system import StoredFile
from app.models.workflow import CustomerProject
from app.schemas.finance import (
    AccountTransferRequest,
    BillCustomerOption,
    BillList,
    BillPaymentSummary,
    BillSummary,
    CompanyLoanPaymentRequest,
    CompanyLoanSummary,
    CreateBillRequest,
    CreateCompanyLoanRequest,
    CreateFinanceTransactionRequest,
    CreateFinancialAccountRequest,
    CustomerLoanSummary,
    FinanceCategorySummary,
    FinanceOverview,
    FinanceTransactionList,
    FinanceTransactionSummary,
    FinancialAccountSummary,
    ProfitabilitySummary,
    RecordBillPaymentRequest,
    ReverseFinanceTransactionRequest,
    UpdateBillRequest,
    UpdateCompanyLoanRequest,
    UpdateFinanceTransactionRequest,
    UpsertCustomerLoanRequest,
)
from app.services.access_service import get_customer, get_project
from app.services.audit_service import write_event
from app.services.storage import storage


class FinanceServiceError(Exception):
    status_code = 400


class FinanceNotFoundError(FinanceServiceError):
    status_code = 404


class FinanceConflictError(FinanceServiceError):
    status_code = 409


BILL_PAYMENT_SOURCE_TYPES = ('sales_bill_payment', 'purchase_bill_payment')


@dataclass(frozen=True)
class FinanceKpis:
    money_in_month: float
    money_out_month: float
    expenses_month: float
    customer_receivables: float
    supplier_payables: float


def _decimal(value: float | Decimal | int | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def _float(value: Decimal | float | int | None) -> float:
    return float(Decimal(value or 0))


def _month_bounds(on_date: date | None = None) -> tuple[date, date]:
    today = on_date or date.today()
    start = today.replace(day=1)
    if start.month == 12:
        end = date(start.year + 1, 1, 1)
    else:
        end = date(start.year, start.month + 1, 1)
    return start, end


def _resolve_date_range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    if date_from is None and date_to is None:
        current = date.today()
        return current.replace(day=1), current
    if date_from is None:
        assert date_to is not None
        date_from = date_to.replace(day=1)
    if date_to is None:
        date_to = date.today()
    if date_from > date_to:
        raise FinanceConflictError('The From date must be on or before the To date')
    return date_from, date_to


def finance_kpis(db: Session, company_id: str, *, on_date: date | None = None, date_from: date | None = None, date_to: date | None = None) -> FinanceKpis:
    explicit_range = date_from is not None or date_to is not None
    transaction_filters = [
        FinanceTransaction.company_id == company_id,
        FinanceTransaction.status == 'posted',
        FinanceTransaction.source_type.not_in(BILL_PAYMENT_SOURCE_TYPES),
    ]
    bill_date_filters = []
    if explicit_range:
        range_start, range_end = _resolve_date_range(date_from, date_to)
        transaction_filters.extend([
            FinanceTransaction.transaction_date >= range_start,
            FinanceTransaction.transaction_date <= range_end,
        ])
        bill_date_filters.extend([
            Bill.bill_date >= range_start,
            Bill.bill_date <= range_end,
        ])
    else:
        start, end = _month_bounds(on_date)
        transaction_filters.extend([
            FinanceTransaction.transaction_date >= start,
            FinanceTransaction.transaction_date < end,
        ])
    receivables = (
        select(func.coalesce(func.sum(Bill.balance_amount), 0))
        .where(
            Bill.company_id == company_id,
            Bill.bill_type == 'sales',
            Bill.status != 'cancelled',
            Bill.balance_amount > 0,
            *bill_date_filters,
        )
        .scalar_subquery()
    )
    payables = (
        select(func.coalesce(func.sum(Bill.balance_amount), 0))
        .where(
            Bill.company_id == company_id,
            Bill.bill_type == 'purchase',
            Bill.status != 'cancelled',
            Bill.balance_amount > 0,
            *bill_date_filters,
        )
        .scalar_subquery()
    )
    row = db.execute(select(
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'credit', FinanceTransaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'debit', FinanceTransaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((
            (FinanceTransaction.direction == 'debit') & (FinanceTransaction.source_type == 'expense'),
            FinanceTransaction.amount,
        ), else_=0)), 0),
        receivables,
        payables,
    ).select_from(FinanceTransaction).where(*transaction_filters)).one()
    return FinanceKpis(
        money_in_month=_float(row[0]),
        money_out_month=_float(row[1]),
        expenses_month=_float(row[2]),
        customer_receivables=_float(row[3]),
        supplier_payables=_float(row[4]),
    )


def _transaction_number(prefix: str = 'TXN') -> str:
    return f"{prefix}-{date.today():%Y%m%d}-{uuid4().hex[:8].upper()}"


def _account_balance(db: Session, account: FinancialAccount) -> Decimal:
    movement = db.execute(
        select(
            func.coalesce(func.sum(case((FinanceTransaction.direction == 'credit', FinanceTransaction.amount), else_=0)), 0),
            func.coalesce(func.sum(case((FinanceTransaction.direction == 'debit', FinanceTransaction.amount), else_=0)), 0),
        ).where(
            FinanceTransaction.company_id == account.company_id,
            FinanceTransaction.account_id == account.id,
            FinanceTransaction.status == 'posted',
        )
    ).one()
    return Decimal(account.opening_balance or 0) + Decimal(movement[0] or 0) - Decimal(movement[1] or 0)


def _account_summary(db: Session, row: FinancialAccount) -> FinancialAccountSummary:
    return FinancialAccountSummary(
        id=row.id,
        name=row.name,
        account_type=row.account_type,
        bank_name=row.bank_name,
        masked_account_number=row.masked_account_number,
        opening_balance=_float(row.opening_balance),
        current_balance=_float(_account_balance(db, row)),
        is_active=row.is_active,
        updated_at=row.updated_at,
    )


def list_accounts(db: Session, actor: CurrentSession, *, as_of: date | None = None) -> list[FinancialAccountSummary]:
    company_id = actor.membership.company_id
    movement_filters = [
        FinanceTransaction.company_id == company_id,
        FinanceTransaction.status == 'posted',
    ]
    if as_of:
        movement_filters.append(FinanceTransaction.transaction_date <= as_of)
    movement_totals = (
        select(
            FinanceTransaction.account_id.label('account_id'),
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'credit', FinanceTransaction.amount),
                else_=0,
            )), 0).label('credits'),
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'debit', FinanceTransaction.amount),
                else_=0,
            )), 0).label('debits'),
        )
        .where(*movement_filters)
        .group_by(FinanceTransaction.account_id)
        .subquery()
    )
    rows = db.execute(
        select(
            FinancialAccount,
            func.coalesce(movement_totals.c.credits, 0),
            func.coalesce(movement_totals.c.debits, 0),
        )
        .outerjoin(movement_totals, movement_totals.c.account_id == FinancialAccount.id)
        .where(
            FinancialAccount.company_id == company_id,
            FinancialAccount.is_active.is_(True),
        )
        .order_by(FinancialAccount.account_type, FinancialAccount.name)
    ).all()
    return [
        FinancialAccountSummary(
            id=account.id,
            name=account.name,
            account_type=account.account_type,
            bank_name=account.bank_name,
            masked_account_number=account.masked_account_number,
            opening_balance=_float(account.opening_balance),
            current_balance=_float(
                Decimal(account.opening_balance or 0)
                + Decimal(credits or 0)
                - Decimal(debits or 0)
            ),
            is_active=account.is_active,
            updated_at=account.updated_at,
        )
        for account, credits, debits in rows
    ]


def create_account(db: Session, actor: CurrentSession, payload: CreateFinancialAccountRequest) -> FinancialAccountSummary:
    row = FinancialAccount(
        company_id=actor.membership.company_id,
        name=payload.name,
        account_type=payload.account_type,
        bank_name=payload.bank_name,
        masked_account_number=payload.masked_account_number,
        opening_balance=_decimal(payload.opening_balance),
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise FinanceConflictError('An account with this name already exists') from exc
    write_event(db, company_id=row.company_id, event='finance.account_created', entity='financial_account', entity_id=row.id, actor=actor, changes={'name': row.name, 'account_type': row.account_type})
    db.commit()
    return _account_summary(db, row)


def list_categories(db: Session, actor: CurrentSession) -> list[FinanceCategorySummary]:
    rows = list(db.scalars(select(FinanceCategory).where(
        FinanceCategory.company_id == actor.membership.company_id,
        FinanceCategory.is_active.is_(True),
    ).order_by(FinanceCategory.category_type, FinanceCategory.name)).all())
    return [FinanceCategorySummary(id=row.id, code=row.code, name=row.name, category_type=row.category_type) for row in rows]


def _maps(db: Session, rows: list[FinanceTransaction]):
    category_ids = {row.category_id for row in rows if row.category_id}
    account_ids = {row.account_id for row in rows}
    customer_ids = {row.customer_id for row in rows if row.customer_id}
    project_ids = {row.project_id for row in rows if row.project_id}
    membership_ids = {row.created_by for row in rows}
    categories = {row.id: row for row in db.scalars(select(FinanceCategory).where(FinanceCategory.id.in_(category_ids))).all()} if category_ids else {}
    accounts = {row.id: row for row in db.scalars(select(FinancialAccount).where(FinancialAccount.id.in_(account_ids))).all()} if account_ids else {}
    customers = {row.id: row for row in db.scalars(select(AgentCustomer).where(AgentCustomer.id.in_(customer_ids))).all()} if customer_ids else {}
    projects = {row.id: row for row in db.scalars(select(CustomerProject).where(CustomerProject.id.in_(project_ids))).all()} if project_ids else {}
    memberships = {row.id: row for row in db.scalars(select(Membership).where(Membership.id.in_(membership_ids))).all()} if membership_ids else {}
    user_ids = {row.user_id for row in memberships.values()}
    users = {row.id: row for row in db.scalars(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}
    return categories, accounts, customers, projects, memberships, users


def _transaction_summaries(db: Session, rows: list[FinanceTransaction]) -> list[FinanceTransactionSummary]:
    categories, accounts, customers, projects, memberships, users = _maps(db, rows)
    result = []
    for row in rows:
        membership = memberships.get(row.created_by)
        user = users.get(membership.user_id) if membership else None
        result.append(FinanceTransactionSummary(
            id=row.id,
            transaction_number=row.transaction_number,
            transaction_date=row.transaction_date,
            direction=row.direction,
            category_id=row.category_id,
            category_name=categories[row.category_id].name if row.category_id in categories else '',
            amount=_float(row.amount),
            account_id=row.account_id,
            account_name=accounts[row.account_id].name if row.account_id in accounts else '',
            payment_method=row.payment_method,
            party_type=row.party_type,
            party_name=row.party_name,
            customer_id=row.customer_id,
            customer_name=customers[row.customer_id].customer_name if row.customer_id in customers else '',
            project_id=row.project_id,
            project_number=projects[row.project_id].project_number if row.project_id in projects else '',
            source_type=row.source_type,
            source_id=row.source_id,
            reference_number=row.reference_number,
            description=row.description,
            status=row.status,
            created_by_name=user.full_name if user else '',
            created_at=row.created_at,
        ))
    return result


def list_transactions(
    db: Session,
    actor: CurrentSession,
    *,
    direction: str | None = None,
    account_id: str | None = None,
    category_id: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    source_type: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = 1,
    page_size: int = 50,
) -> FinanceTransactionList:
    filters = [FinanceTransaction.company_id == actor.membership.company_id]
    if direction: filters.append(FinanceTransaction.direction == direction)
    if account_id: filters.append(FinanceTransaction.account_id == account_id)
    if category_id: filters.append(FinanceTransaction.category_id == category_id)
    if customer_id: filters.append(FinanceTransaction.customer_id == customer_id)
    if project_id: filters.append(FinanceTransaction.project_id == project_id)
    if source_type:
        filters.append(FinanceTransaction.source_type == source_type)
    else:
        filters.append(FinanceTransaction.source_type.not_in(BILL_PAYMENT_SOURCE_TYPES))
    if status: filters.append(FinanceTransaction.status == status)
    if date_from: filters.append(FinanceTransaction.transaction_date >= date_from)
    if date_to: filters.append(FinanceTransaction.transaction_date <= date_to)
    total = db.scalar(select(func.count()).select_from(FinanceTransaction).where(*filters)) or 0
    totals = db.execute(select(
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'credit', FinanceTransaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'debit', FinanceTransaction.amount), else_=0)), 0),
    ).where(*filters, FinanceTransaction.status == 'posted')).one()
    rows = list(db.scalars(select(FinanceTransaction).where(*filters).order_by(FinanceTransaction.transaction_date.desc(), FinanceTransaction.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all())
    return FinanceTransactionList(data=_transaction_summaries(db, rows), page=page, page_size=page_size, total=int(total), money_in=_float(totals[0]), money_out=_float(totals[1]))


def _load_account(db: Session, actor: CurrentSession, account_id: str) -> FinancialAccount:
    row = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.company_id == actor.membership.company_id, FinancialAccount.is_active.is_(True)))
    if not row: raise FinanceNotFoundError('Financial account not found')
    return row


def create_transaction(db: Session, actor: CurrentSession, payload: CreateFinanceTransactionRequest, *, commit: bool = True) -> FinanceTransactionSummary:
    _load_account(db, actor, payload.account_id)
    customer_id = payload.customer_id
    if customer_id:
        get_customer(db, actor, customer_id)
    if payload.project_id:
        project = get_project(db, actor, payload.project_id)
        if customer_id and project.customer_id != customer_id:
            raise FinanceConflictError('The project does not belong to the selected customer')
        customer_id = project.customer_id
    if payload.category_id:
        category = db.scalar(select(FinanceCategory).where(FinanceCategory.id == payload.category_id, FinanceCategory.company_id == actor.membership.company_id, FinanceCategory.is_active.is_(True)))
        if not category: raise FinanceNotFoundError('Finance category not found')
    row = FinanceTransaction(
        company_id=actor.membership.company_id,
        transaction_number=_transaction_number(),
        transaction_date=payload.transaction_date,
        direction=payload.direction,
        category_id=payload.category_id,
        amount=_decimal(payload.amount),
        account_id=payload.account_id,
        payment_method=payload.payment_method,
        party_type=payload.party_type,
        party_name=payload.party_name,
        customer_id=customer_id,
        project_id=payload.project_id,
        agent_id=payload.agent_id,
        supplier_id=payload.supplier_id,
        source_type=payload.source_type,
        source_id=payload.source_id,
        reference_number=payload.reference_number,
        description=payload.description,
        receipt_file_id=payload.receipt_file_id,
        status='posted',
        created_by=actor.membership.id,
    )
    db.add(row)
    db.flush()
    write_event(db, company_id=row.company_id, event='finance.transaction_posted', entity='finance_transaction', entity_id=row.id, actor=actor, project_id=row.project_id, customer_id=row.customer_id, changes={'transaction_number': row.transaction_number, 'direction': row.direction, 'amount': str(row.amount), 'source_type': row.source_type})
    if commit: db.commit()
    return _transaction_summaries(db, [row])[0]


def update_transaction(
    db: Session,
    actor: CurrentSession,
    transaction_id: str,
    payload: UpdateFinanceTransactionRequest,
) -> FinanceTransactionSummary:
    row = db.scalar(select(FinanceTransaction).where(
        FinanceTransaction.id == transaction_id,
        FinanceTransaction.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FinanceNotFoundError('Finance transaction not found')
    _load_account(db, actor, payload.account_id)
    if payload.category_id:
        category = db.scalar(select(FinanceCategory).where(
            FinanceCategory.id == payload.category_id,
            FinanceCategory.company_id == actor.membership.company_id,
            FinanceCategory.is_active.is_(True),
        ))
        if not category:
            raise FinanceNotFoundError('Finance category not found')

    linked_source_types = {
        'sales_bill_payment',
        'purchase_bill_payment',
        'company_loan_disbursement',
        'company_loan_repayment',
        'transaction_reversal',
        'account_transfer',
    }
    reversal_exists = db.scalar(select(FinanceTransaction.id).where(
        FinanceTransaction.reversed_transaction_id == row.id,
        FinanceTransaction.company_id == row.company_id,
    ).limit(1))
    is_linked = row.source_type in linked_source_types or bool(row.transfer_group_id or row.reversed_transaction_id or reversal_exists)
    if is_linked and (payload.direction != row.direction or payload.source_type != row.source_type):
        raise FinanceConflictError('Direction and source cannot be changed for a linked transaction')

    next_amount = _decimal(payload.amount)
    bill_payment = db.scalar(select(BillPayment).where(
        BillPayment.transaction_id == row.id,
        BillPayment.company_id == row.company_id,
    ))
    if bill_payment:
        bill = db.scalar(select(Bill).where(
            Bill.id == bill_payment.bill_id,
            Bill.company_id == row.company_id,
        ))
        if bill:
            next_paid = Decimal(bill.paid_amount) - Decimal(bill_payment.amount) + next_amount
            if next_paid > Decimal(bill.total_amount):
                raise FinanceConflictError('Payment exceeds the bill total')
            bill_payment.amount = next_amount
            bill.paid_amount = next_paid
            bill.balance_amount = Decimal(bill.total_amount) - next_paid
            bill.payment_status = 'unpaid' if next_paid <= 0 else ('paid' if bill.balance_amount <= 0 else 'partially_paid')

    if row.source_id and row.source_type in {'company_loan_disbursement', 'company_loan_repayment'}:
        loan = db.scalar(select(CompanyLoan).where(
            CompanyLoan.id == row.source_id,
            CompanyLoan.company_id == row.company_id,
        ))
        if loan and row.source_type == 'company_loan_repayment':
            next_outstanding = Decimal(loan.outstanding_amount) + Decimal(row.amount) - next_amount
            if next_outstanding < 0:
                raise FinanceConflictError('Repayment exceeds the outstanding loan amount')
            loan.outstanding_amount = min(Decimal(loan.principal_amount), next_outstanding)
            loan.status = 'closed' if loan.outstanding_amount <= 0 else 'active'
        elif loan:
            repaid = max(Decimal('0.00'), Decimal(loan.principal_amount) - Decimal(loan.outstanding_amount))
            if next_amount < repaid:
                raise FinanceConflictError('Loan principal cannot be lower than the amount already repaid')
            loan.principal_amount = next_amount
            loan.outstanding_amount = next_amount - repaid
            loan.start_date = payload.transaction_date
            loan.status = 'closed' if loan.outstanding_amount <= 0 else 'active'

    if (row.reversed_transaction_id or reversal_exists) and next_amount != Decimal(row.amount):
        raise FinanceConflictError('A reversed transaction amount cannot be edited')

    if row.transfer_group_id:
        transfer_siblings = list(db.scalars(select(FinanceTransaction).where(
            FinanceTransaction.transfer_group_id == row.transfer_group_id,
            FinanceTransaction.company_id == row.company_id,
            FinanceTransaction.id != row.id,
        )).all())
        for sibling in transfer_siblings:
            sibling.amount = next_amount
            sibling.transaction_date = payload.transaction_date

    editable_fields = (
        'transaction_date', 'direction', 'category_id', 'amount', 'account_id',
        'payment_method', 'source_type', 'reference_number', 'description',
    )
    before = {field: getattr(row, field) for field in editable_fields}
    row.transaction_date = payload.transaction_date
    row.direction = payload.direction
    row.category_id = payload.category_id
    row.amount = next_amount
    row.account_id = payload.account_id
    row.payment_method = payload.payment_method
    row.source_type = payload.source_type
    row.reference_number = payload.reference_number
    row.description = payload.description
    changes = {
        field: {'old': str(before[field]), 'new': str(getattr(row, field))}
        for field in editable_fields
        if before[field] != getattr(row, field)
    }
    write_event(
        db,
        company_id=row.company_id,
        event='finance.transaction_updated',
        entity='finance_transaction',
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={'transaction_number': row.transaction_number, 'fields': changes},
    )
    db.commit()
    db.refresh(row)
    return _transaction_summaries(db, [row])[0]



def reverse_transaction(db: Session, actor: CurrentSession, transaction_id: str, payload: ReverseFinanceTransactionRequest) -> FinanceTransactionSummary:
    original = db.scalar(select(FinanceTransaction).where(FinanceTransaction.id == transaction_id, FinanceTransaction.company_id == actor.membership.company_id))
    if not original:
        raise FinanceNotFoundError('Finance transaction not found')
    if original.status != 'posted':
        raise FinanceConflictError('Only posted transactions can be reversed')
    existing = db.scalar(select(FinanceTransaction).where(FinanceTransaction.reversed_transaction_id == original.id, FinanceTransaction.company_id == original.company_id))
    if existing:
        raise FinanceConflictError('This transaction has already been reversed')
    reversal = FinanceTransaction(
        company_id=original.company_id, transaction_number=_transaction_number('REV'), transaction_date=payload.transaction_date,
        direction='debit' if original.direction == 'credit' else 'credit', category_id=original.category_id, amount=original.amount,
        account_id=original.account_id, payment_method=original.payment_method, party_type=original.party_type, party_name=original.party_name,
        customer_id=original.customer_id, project_id=original.project_id, agent_id=original.agent_id, supplier_id=original.supplier_id,
        source_type='transaction_reversal', source_id=original.id, reference_number=original.transaction_number,
        description=f'Reversal: {payload.reason}', status='posted', reversed_transaction_id=original.id, created_by=actor.membership.id,
    )
    db.add(reversal)
    original.status = 'reversed'
    db.flush()
    write_event(db, company_id=original.company_id, event='finance.transaction_reversed', entity='finance_transaction', entity_id=original.id, actor=actor, project_id=original.project_id, customer_id=original.customer_id, changes={'reversal_id': reversal.id, 'reason': payload.reason, 'amount': str(original.amount)})
    db.commit(); db.refresh(reversal)
    return _transaction_summaries(db, [reversal])[0]


def delete_transaction(db: Session, actor: CurrentSession, transaction_id: str, *, commit: bool = True) -> None:
    row = db.scalar(select(FinanceTransaction).where(
        FinanceTransaction.id == transaction_id,
        FinanceTransaction.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FinanceNotFoundError('Finance transaction not found')

    bill_payments = list(db.scalars(select(BillPayment).where(
        BillPayment.transaction_id == row.id,
        BillPayment.company_id == row.company_id,
    )).all())
    for payment in bill_payments:
        bill = db.scalar(select(Bill).where(
            Bill.id == payment.bill_id,
            Bill.company_id == row.company_id,
        ))
        if bill:
            bill.paid_amount = max(Decimal('0.00'), Decimal(bill.paid_amount) - Decimal(payment.amount))
            bill.balance_amount = max(Decimal('0.00'), Decimal(bill.total_amount) - Decimal(bill.paid_amount))
            bill.payment_status = 'unpaid' if bill.paid_amount <= 0 else ('paid' if bill.balance_amount <= 0 else 'partially_paid')
        db.delete(payment)

    if row.source_type == 'company_loan_repayment' and row.source_id:
        loan = db.scalar(select(CompanyLoan).where(
            CompanyLoan.id == row.source_id,
            CompanyLoan.company_id == row.company_id,
        ))
        if loan:
            loan.outstanding_amount = min(
                Decimal(loan.principal_amount),
                Decimal(loan.outstanding_amount) + Decimal(row.amount),
            )
            loan.status = 'active' if loan.outstanding_amount > 0 else loan.status

    if row.reversed_transaction_id:
        original = db.scalar(select(FinanceTransaction).where(
            FinanceTransaction.id == row.reversed_transaction_id,
            FinanceTransaction.company_id == row.company_id,
        ))
        if original:
            original.status = 'posted'
    else:
        reversals = list(db.scalars(select(FinanceTransaction).where(
            FinanceTransaction.reversed_transaction_id == row.id,
            FinanceTransaction.company_id == row.company_id,
        )).all())
        for reversal in reversals:
            reversal.reversed_transaction_id = None
            if reversal.source_id == row.id:
                reversal.source_id = None

    write_event(
        db,
        company_id=row.company_id,
        event='finance.transaction_deleted',
        entity='finance_transaction',
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={
            'transaction_number': row.transaction_number,
            'direction': row.direction,
            'amount': str(row.amount),
            'source_type': row.source_type,
        },
    )
    db.delete(row)
    if commit:
        db.commit()
    else:
        db.flush()


def _delete_transaction_tree(db: Session, actor: CurrentSession, transaction_id: str, deleted: set[str]) -> None:
    if transaction_id in deleted:
        return
    reversal_ids = list(db.scalars(select(FinanceTransaction.id).where(
        FinanceTransaction.reversed_transaction_id == transaction_id,
        FinanceTransaction.company_id == actor.membership.company_id,
    )).all())
    for reversal_id in reversal_ids:
        _delete_transaction_tree(db, actor, reversal_id, deleted)
    row_id = db.scalar(select(FinanceTransaction.id).where(
        FinanceTransaction.id == transaction_id,
        FinanceTransaction.company_id == actor.membership.company_id,
    ))
    if row_id:
        delete_transaction(db, actor, row_id, commit=False)
    deleted.add(transaction_id)


def transfer_accounts(db: Session, actor: CurrentSession, payload: AccountTransferRequest) -> list[FinanceTransactionSummary]:
    source = _load_account(db, actor, payload.source_account_id)
    destination = _load_account(db, actor, payload.destination_account_id)
    if _account_balance(db, source) < _decimal(payload.amount):
        raise FinanceConflictError('The source account does not have enough balance')
    group = str(uuid4())
    rows = []
    for direction, account, party in [('debit', source, destination.name), ('credit', destination, source.name)]:
        row = FinanceTransaction(
            company_id=actor.membership.company_id,
            transaction_number=_transaction_number('TRF'),
            transaction_date=payload.transaction_date,
            direction=direction,
            amount=_decimal(payload.amount),
            account_id=account.id,
            payment_method='transfer',
            party_type='account',
            party_name=party,
            source_type='account_transfer',
            transfer_group_id=group,
            reference_number=payload.reference_number,
            description=payload.description,
            status='posted',
            created_by=actor.membership.id,
        )
        db.add(row); rows.append(row)
    db.flush()
    write_event(db, company_id=actor.membership.company_id, event='finance.account_transfer', entity='finance_transfer', entity_id=group, actor=actor, changes={'source_account': source.id, 'destination_account': destination.id, 'amount': str(_decimal(payload.amount))})
    db.commit()
    return _transaction_summaries(db, rows)


def _bill_summary_from_related(
    row: Bill,
    customer: AgentCustomer | None,
    project: CustomerProject | None,
    payments: list[BillPaymentSummary] | None = None,
) -> BillSummary:
    return BillSummary(id=row.id, bill_type=row.bill_type, bill_number=row.bill_number, bill_date=row.bill_date, customer_id=row.customer_id, customer_name=customer.customer_name if customer else '', project_id=row.project_id, project_number=project.project_number if project else '', supplier_name=row.supplier_name, subtotal=_float(row.subtotal), tax_amount=_float(row.tax_amount), total_amount=_float(row.total_amount), due_date=row.due_date, paid_amount=_float(row.paid_amount), balance_amount=_float(row.balance_amount), payment_status=row.payment_status, status=row.status, file_id=row.file_id, note=row.note, payments=payments or [], created_at=row.created_at)


def _bill_payment_summaries(db: Session, bill_ids: set[str], company_ids: set[str]) -> dict[str, list[BillPaymentSummary]]:
    if not bill_ids:
        return {}
    rows = db.execute(
        select(FinanceTransaction, FinancialAccount, BillPayment)
        .join(FinancialAccount, FinancialAccount.id == FinanceTransaction.account_id)
        .outerjoin(
            BillPayment,
            and_(
                BillPayment.transaction_id == FinanceTransaction.id,
                BillPayment.company_id == FinanceTransaction.company_id,
            ),
        )
        .where(
            FinanceTransaction.company_id.in_(company_ids),
            FinanceTransaction.source_type.in_(BILL_PAYMENT_SOURCE_TYPES),
            or_(
                FinanceTransaction.source_id.in_(bill_ids),
                BillPayment.bill_id.in_(bill_ids),
            ),
        )
        .order_by(FinanceTransaction.transaction_date.desc(), FinanceTransaction.created_at.desc())
    ).all()
    result: dict[str, list[BillPaymentSummary]] = {}
    for transaction, account, payment in rows:
        bill_id = payment.bill_id if payment else transaction.source_id
        if not bill_id or bill_id not in bill_ids:
            continue
        result.setdefault(bill_id, []).append(BillPaymentSummary(
            id=payment.id if payment else transaction.id,
            transaction_id=transaction.id,
            transaction_number=transaction.transaction_number,
            transaction_date=transaction.transaction_date,
            amount=_float(payment.amount if payment else transaction.amount),
            account_id=account.id,
            account_name=account.name,
            payment_method=transaction.payment_method,
            reference_number=transaction.reference_number,
            description=transaction.description,
            status=transaction.status,
            created_at=payment.created_at if payment else transaction.created_at,
        ))
    return result


def _bill_summaries(db: Session, rows: list[Bill]) -> list[BillSummary]:
    if not rows:
        return []
    customer_ids = {row.customer_id for row in rows if row.customer_id}
    project_ids = {row.project_id for row in rows if row.project_id}
    customers = {row.id: row for row in db.scalars(select(AgentCustomer).where(AgentCustomer.id.in_(customer_ids))).all()} if customer_ids else {}
    projects = {row.id: row for row in db.scalars(select(CustomerProject).where(CustomerProject.id.in_(project_ids))).all()} if project_ids else {}
    payments = _bill_payment_summaries(db, {row.id for row in rows}, {row.company_id for row in rows})
    return [
        _bill_summary_from_related(
            row,
            customers.get(row.customer_id),
            projects.get(row.project_id),
            payments.get(row.id),
        )
        for row in rows
    ]


def _bill_summary(db: Session, row: Bill) -> BillSummary:
    return _bill_summaries(db, [row])[0]


def _bill_filters(
    actor: CurrentSession,
    *,
    bill_type: str | None = None,
    payment_status: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    if date_from and date_to and date_from > date_to:
        raise FinanceConflictError('The From date must be on or before the To date')
    filters = [Bill.company_id == actor.membership.company_id]
    if bill_type:
        filters.append(Bill.bill_type == bill_type)
    if payment_status:
        filters.append(Bill.payment_status == payment_status)
    if customer_id:
        filters.append(Bill.customer_id == customer_id)
    if project_id:
        filters.append(Bill.project_id == project_id)
    if date_from:
        filters.append(Bill.bill_date >= date_from)
    if date_to:
        filters.append(Bill.bill_date <= date_to)
    return filters


def list_bills(db: Session, actor: CurrentSession, *, bill_type: str | None = None, payment_status: str | None = None, customer_id: str | None = None, project_id: str | None = None, date_from: date | None = None, date_to: date | None = None, page: int = 1, page_size: int = 50) -> BillList:
    filters = _bill_filters(
        actor,
        bill_type=bill_type,
        payment_status=payment_status,
        customer_id=customer_id,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    total = db.scalar(select(func.count()).select_from(Bill).where(*filters)) or 0
    rows = list(db.scalars(select(Bill).where(*filters).order_by(Bill.bill_date.desc(), Bill.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all())
    return BillList(
        data=_bill_summaries(db, rows),
        page=page,
        page_size=page_size,
        total=int(total),
    )


def merged_bills_pdf(
    db: Session,
    actor: CurrentSession,
    *,
    bill_type: str | None = None,
    payment_status: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[Path, str, list[Bill]]:
    filters = _bill_filters(
        actor,
        bill_type=bill_type,
        payment_status=payment_status,
        customer_id=customer_id,
        project_id=project_id,
        date_from=date_from,
        date_to=date_to,
    )
    rows = list(db.execute(
        select(Bill, StoredFile)
        .join(StoredFile, StoredFile.id == Bill.file_id)
        .where(
            *filters,
            StoredFile.company_id == actor.membership.company_id,
            StoredFile.owner_type == 'finance_bill',
            StoredFile.owner_id == Bill.id,
        )
        .order_by(Bill.bill_date.asc(), Bill.created_at.asc())
    ).all())
    if not rows:
        raise FinanceConflictError('No uploaded bill documents match the selected filters')

    output_path: Path | None = None
    try:
        from PIL import Image, ImageOps
        from pypdf import PdfReader, PdfWriter

        with ExitStack() as resources:
            writer = PdfWriter()
            bills: list[Bill] = []
            for bill, attachment in rows:
                path = resources.enter_context(storage.materialize(attachment.storage_path))
                if attachment.mime_type == 'application/pdf':
                    writer.append(str(path))
                elif attachment.mime_type.startswith('image/'):
                    with Image.open(path) as source:
                        image = ImageOps.exif_transpose(source).convert('RGB')
                        image_pdf = BytesIO()
                        resources.callback(image_pdf.close)
                        image.save(image_pdf, format='PDF', resolution=150)
                        image_pdf.seek(0)
                        writer.append(PdfReader(image_pdf))
                else:
                    raise FinanceConflictError(
                        f'{attachment.name} cannot be merged. Upload bill documents as PDF, JPG, PNG, or WebP.'
                    )
                bills.append(bill)

            if len(writer.pages) == 0:
                raise FinanceConflictError('The selected bill documents do not contain any PDF pages')
            with tempfile.NamedTemporaryFile(
                prefix='merged-bills-',
                suffix='.pdf',
                dir=storage.temp_root,
                delete=False,
            ) as output:
                output_path = Path(output.name)
                writer.write(output)
    except FinanceServiceError:
        if output_path:
            output_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        if output_path:
            output_path.unlink(missing_ok=True)
        raise FinanceConflictError(f'Could not merge the selected bill documents: {exc}') from exc

    range_label = 'all-dates'
    if date_from or date_to:
        range_label = f'{date_from.isoformat() if date_from else "start"}_to_{date_to.isoformat() if date_to else "today"}'
    type_label = bill_type or 'all'
    return output_path, f'Bills_{range_label}_{type_label}.pdf', bills


def list_bill_customers(db: Session, actor: CurrentSession) -> list[BillCustomerOption]:
    rows = db.scalars(
        select(AgentCustomer)
        .where(
            AgentCustomer.company_id == actor.membership.company_id,
        )
        .order_by(AgentCustomer.customer_name)
    ).all()
    return [BillCustomerOption(id=row.id, customer_name=row.customer_name) for row in rows]


def create_bill(db: Session, actor: CurrentSession, payload: CreateBillRequest) -> BillSummary:
    if payload.customer_id: get_customer(db, actor, payload.customer_id)
    if payload.project_id:
        project = get_project(db, actor, payload.project_id)
        if payload.customer_id and project.customer_id != payload.customer_id: raise FinanceConflictError('The project does not belong to the selected customer')
    total = _decimal(payload.subtotal) + _decimal(payload.tax_amount)
    row = Bill(company_id=actor.membership.company_id, bill_type=payload.bill_type, bill_number=payload.bill_number, bill_date=payload.bill_date, customer_id=payload.customer_id, project_id=payload.project_id, supplier_name=payload.supplier_name, subtotal=_decimal(payload.subtotal), tax_amount=_decimal(payload.tax_amount), total_amount=total, due_date=payload.due_date, paid_amount=Decimal('0.00'), balance_amount=total, payment_status='unpaid', status='issued', file_id=payload.file_id, note=payload.note, created_by=actor.membership.id)
    db.add(row)
    try: db.flush()
    except IntegrityError as exc:
        db.rollback(); raise FinanceConflictError('A bill with this number already exists') from exc
    write_event(db, company_id=row.company_id, event='bill.created', entity='bill', entity_id=row.id, actor=actor, project_id=row.project_id, customer_id=row.customer_id, changes={'bill_number': row.bill_number, 'bill_type': row.bill_type, 'total_amount': str(row.total_amount)})
    db.commit(); return _bill_summary(db, row)


def update_bill(db: Session, actor: CurrentSession, bill_id: str, payload: UpdateBillRequest) -> BillSummary:
    row = db.scalar(select(Bill).where(
        Bill.id == bill_id,
        Bill.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FinanceNotFoundError('Bill not found')
    if row.bill_type == 'sales' and not payload.customer_id:
        raise FinanceConflictError('A customer is required for a sales bill')
    if row.bill_type == 'purchase' and not payload.supplier_name.strip():
        raise FinanceConflictError('A supplier is required for a purchase bill')
    if payload.customer_id:
        get_customer(db, actor, payload.customer_id)
    if payload.project_id:
        project = get_project(db, actor, payload.project_id)
        if payload.customer_id and project.customer_id != payload.customer_id:
            raise FinanceConflictError('The project does not belong to the selected customer')

    total = _decimal(payload.subtotal) + _decimal(payload.tax_amount)
    if total < Decimal(row.paid_amount):
        raise FinanceConflictError('Bill total cannot be lower than the amount already paid')
    before = {
        'bill_number': row.bill_number,
        'bill_date': str(row.bill_date),
        'customer_id': row.customer_id,
        'project_id': row.project_id,
        'supplier_name': row.supplier_name,
        'total_amount': str(row.total_amount),
        'due_date': str(row.due_date) if row.due_date else None,
    }
    row.bill_number = payload.bill_number
    row.bill_date = payload.bill_date
    row.customer_id = payload.customer_id if row.bill_type == 'sales' else None
    row.project_id = payload.project_id
    row.supplier_name = payload.supplier_name if row.bill_type == 'purchase' else ''
    row.subtotal = _decimal(payload.subtotal)
    row.tax_amount = _decimal(payload.tax_amount)
    row.total_amount = total
    row.due_date = payload.due_date
    row.balance_amount = total - Decimal(row.paid_amount)
    row.payment_status = 'unpaid' if row.paid_amount <= 0 else ('paid' if row.balance_amount <= 0 else 'partially_paid')
    row.note = payload.note
    row.version += 1
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise FinanceConflictError('A bill with this number already exists') from exc
    write_event(
        db,
        company_id=row.company_id,
        event='bill.updated',
        entity='bill',
        entity_id=row.id,
        actor=actor,
        project_id=row.project_id,
        customer_id=row.customer_id,
        changes={
            'before': before,
            'after': {
                'bill_number': row.bill_number,
                'bill_date': str(row.bill_date),
                'customer_id': row.customer_id,
                'project_id': row.project_id,
                'supplier_name': row.supplier_name,
                'total_amount': str(row.total_amount),
                'due_date': str(row.due_date) if row.due_date else None,
            },
        },
    )
    db.commit()
    return _bill_summary(db, row)


def record_bill_payment(db: Session, actor: CurrentSession, bill_id: str, payload: RecordBillPaymentRequest) -> BillSummary:
    bill = db.scalar(select(Bill).where(Bill.id == bill_id, Bill.company_id == actor.membership.company_id))
    if not bill: raise FinanceNotFoundError('Bill not found')
    amount = _decimal(payload.amount)
    if bill.status == 'cancelled': raise FinanceConflictError('Cancelled bills cannot be paid')
    if amount > Decimal(bill.balance_amount): raise FinanceConflictError('Payment exceeds the bill balance')
    if bill.bill_type == 'purchase':
        account = _load_account(db, actor, payload.account_id)
        if _account_balance(db, account) < amount:
            raise FinanceConflictError('The selected account does not have enough balance for this bill payment')
    direction = 'credit' if bill.bill_type == 'sales' else 'debit'
    customer = db.get(AgentCustomer, bill.customer_id) if bill.customer_id else None
    tx_summary = create_transaction(db, actor, CreateFinanceTransactionRequest(transaction_date=payload.transaction_date, direction=direction, amount=float(amount), account_id=payload.account_id, payment_method=payload.payment_method, party_type='customer' if bill.bill_type == 'sales' else 'supplier', party_name=customer.customer_name if customer else bill.supplier_name, customer_id=bill.customer_id, project_id=bill.project_id, source_type=f'{bill.bill_type}_bill_payment', source_id=bill.id, reference_number=payload.reference_number, description=payload.description or f'Payment against {bill.bill_number}'), commit=False)
    bill.paid_amount = Decimal(bill.paid_amount) + amount
    bill.balance_amount = Decimal(bill.total_amount) - Decimal(bill.paid_amount)
    bill.payment_status = 'paid' if bill.balance_amount <= 0 else 'partially_paid'
    db.add(BillPayment(company_id=bill.company_id, bill_id=bill.id, transaction_id=tx_summary.id, amount=amount))
    write_event(db, company_id=bill.company_id, event='bill.payment_recorded', entity='bill', entity_id=bill.id, actor=actor, project_id=bill.project_id, customer_id=bill.customer_id, changes={'amount': str(amount), 'balance_amount': str(bill.balance_amount), 'transaction_id': tx_summary.id})
    db.commit(); return _bill_summary(db, bill)


def delete_bill_payment(db: Session, actor: CurrentSession, bill_id: str, payment_id: str) -> BillSummary:
    bill = db.scalar(select(Bill).where(
        Bill.id == bill_id,
        Bill.company_id == actor.membership.company_id,
    ))
    if not bill:
        raise FinanceNotFoundError('Bill not found')
    payment = db.scalar(select(BillPayment).where(
        BillPayment.id == payment_id,
        BillPayment.bill_id == bill.id,
        BillPayment.company_id == bill.company_id,
    ))
    transaction_id = payment.transaction_id if payment else None
    legacy_transaction = None
    if not transaction_id:
        legacy_transaction = db.scalar(select(FinanceTransaction).where(
            FinanceTransaction.id == payment_id,
            FinanceTransaction.company_id == bill.company_id,
            FinanceTransaction.source_id == bill.id,
            FinanceTransaction.source_type.in_(BILL_PAYMENT_SOURCE_TYPES),
        ))
        transaction_id = legacy_transaction.id if legacy_transaction else None
    if not transaction_id:
        raise FinanceNotFoundError('Bill payment not found')
    if legacy_transaction:
        bill.paid_amount = max(
            Decimal('0.00'),
            Decimal(bill.paid_amount) - Decimal(legacy_transaction.amount),
        )
        bill.balance_amount = max(
            Decimal('0.00'),
            Decimal(bill.total_amount) - Decimal(bill.paid_amount),
        )
        bill.payment_status = (
            'unpaid' if bill.paid_amount <= 0
            else ('paid' if bill.balance_amount <= 0 else 'partially_paid')
        )
    deleted: set[str] = set()
    _delete_transaction_tree(db, actor, transaction_id, deleted)
    db.commit()
    db.refresh(bill)
    return _bill_summary(db, bill)


def delete_bill(db: Session, actor: CurrentSession, bill_id: str) -> None:
    bill = db.scalar(select(Bill).where(
        Bill.id == bill_id,
        Bill.company_id == actor.membership.company_id,
    ))
    if not bill:
        raise FinanceNotFoundError('Bill not found')

    payment_transaction_ids = list(db.scalars(select(BillPayment.transaction_id).where(
        BillPayment.bill_id == bill.id,
        BillPayment.company_id == bill.company_id,
    )).all())
    linked_transaction_ids = list(db.scalars(select(FinanceTransaction.id).where(
        FinanceTransaction.company_id == bill.company_id,
        FinanceTransaction.source_id == bill.id,
        FinanceTransaction.source_type.in_({'sales_bill_payment', 'purchase_bill_payment'}),
    )).all())
    deleted: set[str] = set()
    for transaction_id in dict.fromkeys([*payment_transaction_ids, *linked_transaction_ids]):
        _delete_transaction_tree(db, actor, transaction_id, deleted)

    remaining_payments = list(db.scalars(select(BillPayment).where(
        BillPayment.bill_id == bill.id,
        BillPayment.company_id == bill.company_id,
    )).all())
    for payment in remaining_payments:
        db.delete(payment)

    attachment = None
    staged_attachment = None
    if bill.file_id:
        attachment = db.scalar(select(StoredFile).where(
            StoredFile.id == bill.file_id,
            StoredFile.company_id == bill.company_id,
            StoredFile.owner_type == 'finance_bill',
            StoredFile.owner_id == bill.id,
        ))
        if attachment:
            staged_attachment = storage.stage_delete(attachment.storage_path)
            bill.file_id = None
            db.delete(attachment)

    write_event(
        db,
        company_id=bill.company_id,
        event='bill.deleted',
        entity='bill',
        entity_id=bill.id,
        actor=actor,
        project_id=bill.project_id,
        customer_id=bill.customer_id,
        changes={
            'bill_number': bill.bill_number,
            'bill_type': bill.bill_type,
            'total_amount': str(bill.total_amount),
            'deleted_transactions': len(deleted),
            'attachment_id': attachment.id if attachment else None,
        },
    )
    db.delete(bill)
    try:
        db.commit()
    except Exception:
        db.rollback()
        if staged_attachment and attachment:
            storage.restore_staged_delete(staged_attachment, attachment.storage_path)
        raise
    if staged_attachment:
        storage.finalize_staged_delete(staged_attachment)


def _loan_summary(row: CustomerLoan) -> CustomerLoanSummary:
    return CustomerLoanSummary(id=row.id, customer_id=row.customer_id, project_id=row.project_id, bank_name=row.bank_name, application_number=row.application_number, requested_amount=_float(row.requested_amount), approved_amount=_float(row.approved_amount), customer_contribution=_float(row.customer_contribution), application_status=row.application_status, documentation_status=row.documentation_status, approval_date=row.approval_date, first_disbursement_amount=_float(row.first_disbursement_amount), first_disbursement_date=row.first_disbursement_date, second_disbursement_amount=_float(row.second_disbursement_amount), second_disbursement_date=row.second_disbursement_date, emi_amount=_float(row.emi_amount), emi_start_date=row.emi_start_date, loan_status=row.loan_status, note=row.note, updated_at=row.updated_at)


def get_customer_loan(db: Session, actor: CurrentSession, project_id: str) -> CustomerLoanSummary | None:
    project = get_project(db, actor, project_id)
    row = db.scalar(select(CustomerLoan).where(CustomerLoan.project_id == project.id, CustomerLoan.company_id == actor.membership.company_id))
    return _loan_summary(row) if row else None


def upsert_customer_loan(db: Session, actor: CurrentSession, project_id: str, payload: UpsertCustomerLoanRequest) -> CustomerLoanSummary:
    project = get_project(db, actor, project_id)
    row = db.scalar(select(CustomerLoan).where(CustomerLoan.project_id == project.id, CustomerLoan.company_id == actor.membership.company_id))
    if not row:
        row = CustomerLoan(company_id=actor.membership.company_id, customer_id=project.customer_id, project_id=project.id)
        db.add(row)
    for field, value in payload.model_dump().items():
        if field.endswith('_amount') or field in {'requested_amount', 'approved_amount', 'customer_contribution', 'emi_amount'}:
            value = _decimal(value)
        setattr(row, field, value)
    project.payment_mode = 'loan'
    project.loan_status = row.loan_status
    db.flush()
    write_event(db, company_id=row.company_id, event='customer_loan.updated', entity='customer_loan', entity_id=row.id, actor=actor, project_id=row.project_id, customer_id=row.customer_id, changes={'loan_status': row.loan_status, 'approved_amount': str(row.approved_amount)})
    db.commit(); return _loan_summary(row)


def _company_loan_summary(row: CompanyLoan) -> CompanyLoanSummary:
    return CompanyLoanSummary(id=row.id, lender_name=row.lender_name, loan_account_number=row.loan_account_number, principal_amount=_float(row.principal_amount), interest_rate=_float(row.interest_rate), emi_amount=_float(row.emi_amount), start_date=row.start_date, end_date=row.end_date, outstanding_amount=_float(row.outstanding_amount), next_due_date=row.next_due_date, status=row.status, note=row.note, created_at=row.created_at, updated_at=row.updated_at)


def list_company_loans(db: Session, actor: CurrentSession) -> list[CompanyLoanSummary]:
    rows = list(db.scalars(select(CompanyLoan).where(CompanyLoan.company_id == actor.membership.company_id).order_by(CompanyLoan.created_at.desc())).all())
    return [_company_loan_summary(row) for row in rows]


def create_company_loan(db: Session, actor: CurrentSession, payload: CreateCompanyLoanRequest) -> CompanyLoanSummary:
    _load_account(db, actor, payload.account_id)
    row = CompanyLoan(company_id=actor.membership.company_id, lender_name=payload.lender_name, loan_account_number=payload.loan_account_number, principal_amount=_decimal(payload.principal_amount), interest_rate=Decimal(str(payload.interest_rate)), emi_amount=_decimal(payload.emi_amount), start_date=payload.start_date, end_date=payload.end_date, outstanding_amount=_decimal(payload.principal_amount), next_due_date=payload.next_due_date, status='active', note=payload.note, created_by=actor.membership.id)
    db.add(row); db.flush()
    create_transaction(db, actor, CreateFinanceTransactionRequest(transaction_date=payload.start_date, direction='credit', amount=payload.principal_amount, account_id=payload.account_id, payment_method='bank', party_type='lender', party_name=payload.lender_name, source_type='company_loan_disbursement', source_id=row.id, reference_number=payload.reference_number, description=f'Company loan disbursement from {payload.lender_name}'), commit=False)
    write_event(db, company_id=row.company_id, event='company_loan.created', entity='company_loan', entity_id=row.id, actor=actor, changes={'lender_name': row.lender_name, 'principal_amount': str(row.principal_amount)})
    db.commit(); return _company_loan_summary(row)


def update_company_loan(db: Session, actor: CurrentSession, loan_id: str, payload: UpdateCompanyLoanRequest) -> CompanyLoanSummary:
    row = db.scalar(select(CompanyLoan).where(
        CompanyLoan.id == loan_id,
        CompanyLoan.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FinanceNotFoundError('Company loan not found')

    paid_amount = max(Decimal('0.00'), Decimal(row.principal_amount) - Decimal(row.outstanding_amount))
    next_principal = _decimal(payload.principal_amount)
    if next_principal < paid_amount:
        raise FinanceConflictError('Loan principal cannot be lower than the amount already repaid')
    before = {
        'lender_name': row.lender_name,
        'loan_account_number': row.loan_account_number,
        'principal_amount': str(row.principal_amount),
        'interest_rate': str(row.interest_rate),
        'emi_amount': str(row.emi_amount),
        'start_date': str(row.start_date),
        'end_date': str(row.end_date) if row.end_date else None,
        'next_due_date': str(row.next_due_date) if row.next_due_date else None,
    }
    row.lender_name = payload.lender_name
    row.loan_account_number = payload.loan_account_number
    row.principal_amount = next_principal
    row.interest_rate = Decimal(str(payload.interest_rate))
    row.emi_amount = _decimal(payload.emi_amount)
    row.start_date = payload.start_date
    row.end_date = payload.end_date
    row.outstanding_amount = next_principal - paid_amount
    row.next_due_date = payload.next_due_date
    row.status = 'closed' if row.outstanding_amount <= 0 else 'active'
    row.note = payload.note
    row.version += 1

    linked_transactions = list(db.scalars(select(FinanceTransaction).where(
        FinanceTransaction.company_id == row.company_id,
        FinanceTransaction.source_id == row.id,
        FinanceTransaction.source_type.in_({'company_loan_disbursement', 'company_loan_repayment'}),
    )).all())
    for transaction in linked_transactions:
        transaction.party_name = row.lender_name
        if transaction.source_type == 'company_loan_disbursement':
            transaction.transaction_date = row.start_date
            transaction.amount = row.principal_amount
            transaction.description = f'Company loan disbursement from {row.lender_name}'

    write_event(
        db,
        company_id=row.company_id,
        event='company_loan.updated',
        entity='company_loan',
        entity_id=row.id,
        actor=actor,
        changes={
            'before': before,
            'after': {
                'lender_name': row.lender_name,
                'loan_account_number': row.loan_account_number,
                'principal_amount': str(row.principal_amount),
                'interest_rate': str(row.interest_rate),
                'emi_amount': str(row.emi_amount),
                'start_date': str(row.start_date),
                'end_date': str(row.end_date) if row.end_date else None,
                'next_due_date': str(row.next_due_date) if row.next_due_date else None,
            },
        },
    )
    db.commit()
    return _company_loan_summary(row)


def pay_company_loan(db: Session, actor: CurrentSession, loan_id: str, payload: CompanyLoanPaymentRequest) -> CompanyLoanSummary:
    row = db.scalar(select(CompanyLoan).where(CompanyLoan.id == loan_id, CompanyLoan.company_id == actor.membership.company_id))
    if not row: raise FinanceNotFoundError('Company loan not found')
    amount = _decimal(payload.amount)
    if amount > Decimal(row.outstanding_amount): raise FinanceConflictError('Payment exceeds the outstanding loan amount')
    create_transaction(db, actor, CreateFinanceTransactionRequest(transaction_date=payload.transaction_date, direction='debit', amount=payload.amount, account_id=payload.account_id, payment_method='bank', party_type='lender', party_name=row.lender_name, source_type='company_loan_repayment', source_id=row.id, reference_number=payload.reference_number, description=payload.note or f'Company loan repayment to {row.lender_name}'), commit=False)
    row.outstanding_amount = Decimal(row.outstanding_amount) - amount
    if row.outstanding_amount <= 0: row.status = 'closed'
    write_event(db, company_id=row.company_id, event='company_loan.payment_recorded', entity='company_loan', entity_id=row.id, actor=actor, changes={'amount': str(amount), 'outstanding_amount': str(row.outstanding_amount)})
    db.commit(); return _company_loan_summary(row)


def delete_company_loan(db: Session, actor: CurrentSession, loan_id: str) -> None:
    row = db.scalar(select(CompanyLoan).where(
        CompanyLoan.id == loan_id,
        CompanyLoan.company_id == actor.membership.company_id,
    ))
    if not row:
        raise FinanceNotFoundError('Company loan not found')

    linked_transaction_ids = list(db.scalars(select(FinanceTransaction.id).where(
        FinanceTransaction.company_id == row.company_id,
        FinanceTransaction.source_id == row.id,
        FinanceTransaction.source_type.in_({'company_loan_disbursement', 'company_loan_repayment'}),
    )).all())
    deleted: set[str] = set()
    for transaction_id in linked_transaction_ids:
        _delete_transaction_tree(db, actor, transaction_id, deleted)

    write_event(
        db,
        company_id=row.company_id,
        event='company_loan.deleted',
        entity='company_loan',
        entity_id=row.id,
        actor=actor,
        changes={
            'lender_name': row.lender_name,
            'principal_amount': str(row.principal_amount),
            'outstanding_amount': str(row.outstanding_amount),
            'deleted_transactions': len(deleted),
        },
    )
    db.delete(row)
    db.commit()


def overview(db: Session, actor: CurrentSession, *, date_from: date | None = None, date_to: date | None = None) -> FinanceOverview:
    company_id = actor.membership.company_id
    range_start, range_end = _resolve_date_range(date_from, date_to)
    kpis = finance_kpis(db, company_id, date_from=range_start, date_to=range_end)
    accounts = list_accounts(db, actor, as_of=range_end)
    bank_balance = sum(row.current_balance for row in accounts if row.account_type in {'bank', 'upi'})
    cash_balance = sum(row.current_balance for row in accounts if row.account_type in {'cash', 'petty_cash'})
    recent_rows = list(db.scalars(select(FinanceTransaction).where(FinanceTransaction.company_id == company_id, FinanceTransaction.source_type.not_in(BILL_PAYMENT_SOURCE_TYPES), FinanceTransaction.transaction_date >= range_start, FinanceTransaction.transaction_date <= range_end).order_by(FinanceTransaction.transaction_date.desc(), FinanceTransaction.created_at.desc()).limit(8)).all())
    pending_rows = list(db.scalars(select(Bill).where(Bill.company_id == company_id, Bill.balance_amount > 0, Bill.status != 'cancelled', Bill.bill_date >= range_start, Bill.bill_date <= range_end).order_by(Bill.due_date.asc().nullslast()).limit(8)).all())
    expense_rows = db.execute(select(FinanceCategory.name, func.sum(FinanceTransaction.amount)).join(FinanceTransaction, FinanceTransaction.category_id == FinanceCategory.id).where(FinanceTransaction.company_id == company_id, FinanceTransaction.direction == 'debit', FinanceTransaction.source_type == 'expense', FinanceTransaction.status == 'posted', FinanceTransaction.transaction_date >= range_start, FinanceTransaction.transaction_date <= range_end).group_by(FinanceCategory.name).order_by(func.sum(FinanceTransaction.amount).desc()).limit(8)).all()
    month_bucket = func.to_char(func.date_trunc('month', FinanceTransaction.transaction_date), 'YYYY-MM')
    flow_rows = db.execute(select(month_bucket, FinanceTransaction.direction, func.sum(FinanceTransaction.amount)).where(FinanceTransaction.company_id == company_id, FinanceTransaction.status == 'posted', FinanceTransaction.source_type.not_in(BILL_PAYMENT_SOURCE_TYPES), FinanceTransaction.transaction_date >= range_start, FinanceTransaction.transaction_date <= range_end).group_by(month_bucket, FinanceTransaction.direction).order_by(month_bucket.desc()).limit(24)).all()
    flow_map: dict[str, dict[str, float | str]] = {}
    for month, direction, amount in flow_rows:
        bucket = flow_map.setdefault(str(month), {'month': str(month), 'money_in': 0.0, 'money_out': 0.0})
        bucket['money_in' if direction == 'credit' else 'money_out'] = _float(amount)
    return FinanceOverview(money_in_month=kpis.money_in_month, money_out_month=kpis.money_out_month, bank_balance=bank_balance, cash_balance=cash_balance, customer_receivables=kpis.customer_receivables, supplier_payables=kpis.supplier_payables, expenses_month=kpis.expenses_month, net_cash_flow=kpis.money_in_month - kpis.money_out_month, accounts=accounts, recent_transactions=_transaction_summaries(db, recent_rows), pending_bills=_bill_summaries(db, pending_rows), expense_by_category=[{'category': name, 'amount': _float(amount)} for name, amount in expense_rows], monthly_flow=list(reversed(list(flow_map.values()))))


def profitability(db: Session, actor: CurrentSession, *, date_from: date | None = None, date_to: date | None = None) -> ProfitabilitySummary:
    company_id = actor.membership.company_id
    bill_filters = [Bill.company_id == company_id, Bill.status != 'cancelled']
    transaction_filters = [FinanceTransaction.company_id == company_id, FinanceTransaction.status == 'posted']
    if date_from:
        bill_filters.append(Bill.bill_date >= date_from)
        transaction_filters.append(FinanceTransaction.transaction_date >= date_from)
    if date_to:
        bill_filters.append(Bill.bill_date <= date_to)
        transaction_filters.append(FinanceTransaction.transaction_date <= date_to)
    if date_from and date_to and date_from > date_to:
        raise FinanceConflictError('The From date must be on or before the To date')
    sales_value, purchase_value = db.execute(
        select(
            func.coalesce(func.sum(case(
                (Bill.bill_type == 'sales', Bill.total_amount),
                else_=0,
            )), 0),
            func.coalesce(func.sum(case(
                (Bill.bill_type == 'purchase', Bill.total_amount),
                else_=0,
            )), 0),
        ).where(*bill_filters)
    ).one()

    money_in, money_out, subsidy, project_expenses, operating = db.execute(
        select(
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'credit', FinanceTransaction.amount),
                else_=0,
            )), 0),
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'debit', FinanceTransaction.amount),
                else_=0,
            )), 0),
            func.coalesce(func.sum(case((
                (FinanceTransaction.direction == 'credit')
                & (FinanceTransaction.source_type == 'subsidy_received'),
                FinanceTransaction.amount,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                (FinanceTransaction.direction == 'debit')
                & FinanceTransaction.project_id.is_not(None),
                FinanceTransaction.amount,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                (FinanceTransaction.direction == 'debit')
                & FinanceTransaction.project_id.is_(None),
                FinanceTransaction.amount,
            ), else_=0)), 0),
        ).where(*transaction_filters)
    ).one()

    project_sales = (
        select(
            Bill.project_id.label('project_id'),
            func.coalesce(func.sum(Bill.total_amount), 0).label('sales_value'),
        )
        .where(
            *bill_filters,
            Bill.bill_type == 'sales',
            Bill.project_id.is_not(None),
        )
        .group_by(Bill.project_id)
        .subquery()
    )
    project_totals = (
        select(
            FinanceTransaction.project_id.label('project_id'),
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'credit', FinanceTransaction.amount),
                else_=0,
            )), 0).label('received'),
            func.coalesce(func.sum(case(
                (FinanceTransaction.direction == 'debit', FinanceTransaction.amount),
                else_=0,
            )), 0).label('cost'),
        )
        .where(*transaction_filters, FinanceTransaction.project_id.is_not(None))
        .group_by(FinanceTransaction.project_id)
        .subquery()
    )
    projects = db.execute(
        select(
            CustomerProject,
            func.coalesce(project_sales.c.sales_value, 0),
            func.coalesce(project_totals.c.received, 0),
            func.coalesce(project_totals.c.cost, 0),
        )
        .outerjoin(project_sales, project_sales.c.project_id == CustomerProject.id)
        .outerjoin(project_totals, project_totals.c.project_id == CustomerProject.id)
        .where(
            CustomerProject.company_id == company_id,
            or_(project_sales.c.project_id.is_not(None), project_totals.c.project_id.is_not(None)),
        )
        .order_by(CustomerProject.created_at.desc())
        .limit(100)
    ).all()
    project_rows = [
        {
            'project_id': project.id,
            'project_number': project.project_number,
            'project_name': project.name,
            'sales_value': _float(project_sales_value),
            'money_received': _float(received),
            'cost': _float(cost),
            'gross_profit': _float(project_sales_value) - _float(cost),
        }
        for project, project_sales_value, received, cost in projects
    ]
    gross = _float(sales_value) - _float(purchase_value) - _float(project_expenses)
    return ProfitabilitySummary(
        sales_value=_float(sales_value),
        money_received=_float(money_in),
        subsidy_received=_float(subsidy),
        material_cost=_float(purchase_value),
        project_expenses=_float(project_expenses),
        operating_expenses=_float(operating),
        net_cash_flow=_float(money_in) - _float(money_out),
        estimated_gross_profit=gross,
        projects=project_rows,
    )
