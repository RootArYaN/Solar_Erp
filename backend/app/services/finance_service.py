from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import case, func, select
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
from app.models.workflow import CustomerProject
from app.schemas.finance import (
    AccountTransferRequest,
    BillCustomerOption,
    BillList,
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
    UpsertCustomerLoanRequest,
)
from app.services.access_service import get_customer, get_project
from app.services.audit_service import write_event


class FinanceServiceError(Exception):
    status_code = 400


class FinanceNotFoundError(FinanceServiceError):
    status_code = 404


class FinanceConflictError(FinanceServiceError):
    status_code = 409


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


def finance_kpis(db: Session, company_id: str, *, on_date: date | None = None) -> FinanceKpis:
    start, end = _month_bounds(on_date)
    monthly = db.execute(select(
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'credit', FinanceTransaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((FinanceTransaction.direction == 'debit', FinanceTransaction.amount), else_=0)), 0),
        func.coalesce(func.sum(case((
            (FinanceTransaction.direction == 'debit') & (FinanceTransaction.source_type == 'expense'),
            FinanceTransaction.amount,
        ), else_=0)), 0),
    ).where(
        FinanceTransaction.company_id == company_id,
        FinanceTransaction.status == 'posted',
        FinanceTransaction.transaction_date >= start,
        FinanceTransaction.transaction_date < end,
    )).one()
    receivables = db.scalar(select(func.coalesce(func.sum(Bill.balance_amount), 0)).where(
        Bill.company_id == company_id,
        Bill.bill_type == 'sales',
        Bill.status != 'cancelled',
        Bill.balance_amount > 0,
    )) or 0
    payables = db.scalar(select(func.coalesce(func.sum(Bill.balance_amount), 0)).where(
        Bill.company_id == company_id,
        Bill.bill_type == 'purchase',
        Bill.status != 'cancelled',
        Bill.balance_amount > 0,
    )) or 0
    return FinanceKpis(
        money_in_month=_float(monthly[0]),
        money_out_month=_float(monthly[1]),
        expenses_month=_float(monthly[2]),
        customer_receivables=_float(receivables),
        supplier_payables=_float(payables),
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


def list_accounts(db: Session, actor: CurrentSession) -> list[FinancialAccountSummary]:
    rows = list(db.scalars(select(FinancialAccount).where(
        FinancialAccount.company_id == actor.membership.company_id,
        FinancialAccount.is_active.is_(True),
    ).order_by(FinancialAccount.account_type, FinancialAccount.name)).all())
    return [_account_summary(db, row) for row in rows]


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
    if source_type: filters.append(FinanceTransaction.source_type == source_type)
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


def _bill_summary(db: Session, row: Bill) -> BillSummary:
    customer = db.get(AgentCustomer, row.customer_id) if row.customer_id else None
    project = db.get(CustomerProject, row.project_id) if row.project_id else None
    return BillSummary(id=row.id, bill_type=row.bill_type, bill_number=row.bill_number, bill_date=row.bill_date, customer_id=row.customer_id, customer_name=customer.customer_name if customer else '', project_id=row.project_id, project_number=project.project_number if project else '', supplier_name=row.supplier_name, subtotal=_float(row.subtotal), tax_amount=_float(row.tax_amount), total_amount=_float(row.total_amount), due_date=row.due_date, paid_amount=_float(row.paid_amount), balance_amount=_float(row.balance_amount), payment_status=row.payment_status, status=row.status, file_id=row.file_id, note=row.note, created_at=row.created_at)


def list_bills(db: Session, actor: CurrentSession, *, bill_type: str | None = None, payment_status: str | None = None, customer_id: str | None = None, project_id: str | None = None, page: int = 1, page_size: int = 50) -> BillList:
    filters = [Bill.company_id == actor.membership.company_id]
    if bill_type: filters.append(Bill.bill_type == bill_type)
    if payment_status: filters.append(Bill.payment_status == payment_status)
    if customer_id: filters.append(Bill.customer_id == customer_id)
    if project_id: filters.append(Bill.project_id == project_id)
    total = db.scalar(select(func.count()).select_from(Bill).where(*filters)) or 0
    rows = list(db.scalars(select(Bill).where(*filters).order_by(Bill.bill_date.desc(), Bill.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all())
    return BillList(data=[_bill_summary(db, row) for row in rows], page=page, page_size=page_size, total=int(total))


def list_bill_customers(db: Session, actor: CurrentSession) -> list[BillCustomerOption]:
    rows = db.scalars(
        select(AgentCustomer)
        .where(
            AgentCustomer.company_id == actor.membership.company_id,
            AgentCustomer.archived_at.is_(None),
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


def record_bill_payment(db: Session, actor: CurrentSession, bill_id: str, payload: RecordBillPaymentRequest) -> BillSummary:
    bill = db.scalar(select(Bill).where(Bill.id == bill_id, Bill.company_id == actor.membership.company_id))
    if not bill: raise FinanceNotFoundError('Bill not found')
    amount = _decimal(payload.amount)
    if bill.status == 'cancelled': raise FinanceConflictError('Cancelled bills cannot be paid')
    if amount > Decimal(bill.balance_amount): raise FinanceConflictError('Payment exceeds the bill balance')
    direction = 'credit' if bill.bill_type == 'sales' else 'debit'
    customer = db.get(AgentCustomer, bill.customer_id) if bill.customer_id else None
    tx_summary = create_transaction(db, actor, CreateFinanceTransactionRequest(transaction_date=payload.transaction_date, direction=direction, amount=float(amount), account_id=payload.account_id, payment_method=payload.payment_method, party_type='customer' if bill.bill_type == 'sales' else 'supplier', party_name=customer.customer_name if customer else bill.supplier_name, customer_id=bill.customer_id, project_id=bill.project_id, source_type=f'{bill.bill_type}_bill_payment', source_id=bill.id, reference_number=payload.reference_number, description=payload.description or f'Payment against {bill.bill_number}'), commit=False)
    bill.paid_amount = Decimal(bill.paid_amount) + amount
    bill.balance_amount = Decimal(bill.total_amount) - Decimal(bill.paid_amount)
    bill.payment_status = 'paid' if bill.balance_amount <= 0 else 'partially_paid'
    db.add(BillPayment(company_id=bill.company_id, bill_id=bill.id, transaction_id=tx_summary.id, amount=amount))
    write_event(db, company_id=bill.company_id, event='bill.payment_recorded', entity='bill', entity_id=bill.id, actor=actor, project_id=bill.project_id, customer_id=bill.customer_id, changes={'amount': str(amount), 'balance_amount': str(bill.balance_amount), 'transaction_id': tx_summary.id})
    db.commit(); return _bill_summary(db, bill)


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


def overview(db: Session, actor: CurrentSession) -> FinanceOverview:
    company_id = actor.membership.company_id
    start, end = _month_bounds()
    kpis = finance_kpis(db, company_id)
    accounts = list_accounts(db, actor)
    bank_balance = sum(row.current_balance for row in accounts if row.account_type in {'bank', 'upi'})
    cash_balance = sum(row.current_balance for row in accounts if row.account_type in {'cash', 'petty_cash'})
    recent_rows = list(db.scalars(select(FinanceTransaction).where(FinanceTransaction.company_id == company_id).order_by(FinanceTransaction.transaction_date.desc(), FinanceTransaction.created_at.desc()).limit(8)).all())
    pending_rows = list(db.scalars(select(Bill).where(Bill.company_id == company_id, Bill.balance_amount > 0, Bill.status != 'cancelled').order_by(Bill.due_date.asc().nullslast()).limit(8)).all())
    expense_rows = db.execute(select(FinanceCategory.name, func.sum(FinanceTransaction.amount)).join(FinanceTransaction, FinanceTransaction.category_id == FinanceCategory.id).where(FinanceTransaction.company_id == company_id, FinanceTransaction.direction == 'debit', FinanceTransaction.source_type == 'expense', FinanceTransaction.status == 'posted', FinanceTransaction.transaction_date >= start, FinanceTransaction.transaction_date < end).group_by(FinanceCategory.name).order_by(func.sum(FinanceTransaction.amount).desc()).limit(8)).all()
    flow_rows = db.execute(select(func.strftime('%Y-%m', FinanceTransaction.transaction_date), FinanceTransaction.direction, func.sum(FinanceTransaction.amount)).where(FinanceTransaction.company_id == company_id, FinanceTransaction.status == 'posted').group_by(func.strftime('%Y-%m', FinanceTransaction.transaction_date), FinanceTransaction.direction).order_by(func.strftime('%Y-%m', FinanceTransaction.transaction_date).desc()).limit(12)).all() if db.bind and db.bind.dialect.name == 'sqlite' else []
    flow_map: dict[str, dict[str, float | str]] = {}
    for month, direction, amount in flow_rows:
        bucket = flow_map.setdefault(str(month), {'month': str(month), 'money_in': 0.0, 'money_out': 0.0})
        bucket['money_in' if direction == 'credit' else 'money_out'] = _float(amount)
    return FinanceOverview(money_in_month=kpis.money_in_month, money_out_month=kpis.money_out_month, bank_balance=bank_balance, cash_balance=cash_balance, customer_receivables=kpis.customer_receivables, supplier_payables=kpis.supplier_payables, expenses_month=kpis.expenses_month, net_cash_flow=kpis.money_in_month - kpis.money_out_month, accounts=accounts, recent_transactions=_transaction_summaries(db, recent_rows), pending_bills=[_bill_summary(db, row) for row in pending_rows], expense_by_category=[{'category': name, 'amount': _float(amount)} for name, amount in expense_rows], monthly_flow=list(reversed(list(flow_map.values()))))


def profitability(db: Session, actor: CurrentSession) -> ProfitabilitySummary:
    sales_value = db.scalar(select(func.coalesce(func.sum(Bill.total_amount), 0)).where(Bill.company_id == actor.membership.company_id, Bill.bill_type == 'sales', Bill.status != 'cancelled')) or 0
    purchase_value = db.scalar(select(func.coalesce(func.sum(Bill.total_amount), 0)).where(Bill.company_id == actor.membership.company_id, Bill.bill_type == 'purchase', Bill.status != 'cancelled')) or 0
    tx = list_transactions(db, actor, page=1, page_size=1)
    subsidy = db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount), 0)).where(FinanceTransaction.company_id == actor.membership.company_id, FinanceTransaction.source_type == 'subsidy_received', FinanceTransaction.direction == 'credit', FinanceTransaction.status == 'posted')) or 0
    project_expenses = db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount), 0)).where(FinanceTransaction.company_id == actor.membership.company_id, FinanceTransaction.direction == 'debit', FinanceTransaction.project_id.is_not(None), FinanceTransaction.status == 'posted')) or 0
    operating = db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount), 0)).where(FinanceTransaction.company_id == actor.membership.company_id, FinanceTransaction.direction == 'debit', FinanceTransaction.project_id.is_(None), FinanceTransaction.status == 'posted')) or 0
    projects = list(db.scalars(select(CustomerProject).where(CustomerProject.company_id == actor.membership.company_id, CustomerProject.archived_at.is_(None)).order_by(CustomerProject.created_at.desc()).limit(100)).all())
    project_rows = []
    for project in projects:
        received = db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount), 0)).where(FinanceTransaction.project_id == project.id, FinanceTransaction.direction == 'credit', FinanceTransaction.status == 'posted')) or 0
        cost = db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount), 0)).where(FinanceTransaction.project_id == project.id, FinanceTransaction.direction == 'debit', FinanceTransaction.status == 'posted')) or 0
        project_rows.append({'project_id': project.id, 'project_number': project.project_number, 'project_name': project.name, 'sales_value': _float(project.approved_value), 'money_received': _float(received), 'cost': _float(cost), 'gross_profit': _float(project.approved_value) - _float(cost)})
    gross = _float(sales_value) - _float(purchase_value) - _float(project_expenses)
    return ProfitabilitySummary(sales_value=_float(sales_value), money_received=tx.money_in, subsidy_received=_float(subsidy), material_cost=_float(purchase_value), project_expenses=_float(project_expenses), operating_expenses=_float(operating), net_cash_flow=tx.money_in - tx.money_out, estimated_gross_profit=gross, projects=project_rows)
