from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession, require_any_permissions
from app.core.config import settings
from app.db.session import get_db
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
    UpdateFinanceTransactionRequest,
    UpsertCustomerLoanRequest,
)
from app.services import finance_service
from app.services.finance_service import FinanceServiceError

router = APIRouter(prefix='/finance', tags=['finance'])


def _raise(exc: FinanceServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get('/overview', response_model=FinanceOverview)
def get_overview(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.overview(db, session)


@router.get('/accounts', response_model=list[FinancialAccountSummary])
def get_accounts(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.list_accounts(db, session)


@router.post('/accounts', response_model=FinancialAccountSummary, status_code=201)
def post_account(payload: CreateFinancialAccountRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.create_account(db, session, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.get('/categories', response_model=list[FinanceCategorySummary])
def get_categories(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.list_categories(db, session)


@router.get('/transactions', response_model=FinanceTransactionList)
def get_transactions(
    direction: str | None = Query(default=None, pattern=r'^(credit|debit)$'),
    account_id: str | None = None,
    category_id: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    source_type: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage')),
):
    return finance_service.list_transactions(db, session, direction=direction, account_id=account_id, category_id=category_id, customer_id=customer_id, project_id=project_id, source_type=source_type, status=status, date_from=date_from, date_to=date_to, page=page, page_size=page_size)


@router.post('/transactions', response_model=FinanceTransactionSummary, status_code=201)
def post_transaction(payload: CreateFinanceTransactionRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.create_transaction(db, session, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.patch('/transactions/{transaction_id}', response_model=FinanceTransactionSummary)
def patch_transaction(transaction_id: str, payload: UpdateFinanceTransactionRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.update_transaction(db, session, transaction_id, payload)
    except FinanceServiceError as exc: _raise(exc)




@router.post('/transactions/{transaction_id}/reverse', response_model=FinanceTransactionSummary, status_code=201)
def reverse_transaction(transaction_id: str, payload: ReverseFinanceTransactionRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.reverse_transaction(db, session, transaction_id, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.post('/transfers', response_model=list[FinanceTransactionSummary], status_code=201)
def post_transfer(payload: AccountTransferRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.transfer_accounts(db, session, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.get('/expenses', response_model=FinanceTransactionList)
def get_expenses(
    date_from: date | None = None,
    date_to: date | None = None,
    project_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage')),
):
    return finance_service.list_transactions(db, session, direction='debit', source_type='expense', project_id=project_id, date_from=date_from, date_to=date_to, page=page, page_size=page_size)


@router.get('/bills', response_model=BillList)
def get_bills(
    bill_type: str | None = Query(default=None, pattern=r'^(sales|purchase)$'),
    payment_status: str | None = None,
    customer_id: str | None = None,
    project_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=settings.default_page_size, ge=1, le=settings.max_page_size),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage')),
):
    return finance_service.list_bills(db, session, bill_type=bill_type, payment_status=payment_status, customer_id=customer_id, project_id=project_id, page=page, page_size=page_size)


@router.get('/bill-customers', response_model=list[BillCustomerOption])
def get_bill_customers(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.list_bill_customers(db, session)


@router.post('/bills', response_model=BillSummary, status_code=201)
def post_bill(payload: CreateBillRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.create_bill(db, session, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.post('/bills/{bill_id}/payments', response_model=BillSummary)
def post_bill_payment(bill_id: str, payload: RecordBillPaymentRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.record_bill_payment(db, session, bill_id, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.get('/customer-loans/{project_id}', response_model=CustomerLoanSummary | None)
def get_customer_loan(project_id: str, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage', 'projects.view'))):
    try: return finance_service.get_customer_loan(db, session, project_id)
    except FinanceServiceError as exc: _raise(exc)


@router.put('/customer-loans/{project_id}', response_model=CustomerLoanSummary)
def put_customer_loan(project_id: str, payload: UpsertCustomerLoanRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage', 'projects.edit'))):
    try: return finance_service.upsert_customer_loan(db, session, project_id, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.get('/company-loans', response_model=list[CompanyLoanSummary])
def get_company_loans(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.list_company_loans(db, session)


@router.post('/company-loans', response_model=CompanyLoanSummary, status_code=201)
def post_company_loan(payload: CreateCompanyLoanRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.create_company_loan(db, session, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.post('/company-loans/{loan_id}/payments', response_model=CompanyLoanSummary)
def post_company_loan_payment(loan_id: str, payload: CompanyLoanPaymentRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.manage'))):
    try: return finance_service.pay_company_loan(db, session, loan_id, payload)
    except FinanceServiceError as exc: _raise(exc)


@router.get('/profitability', response_model=ProfitabilitySummary)
def get_profitability(db: Session = Depends(get_db), session: CurrentSession = Depends(require_any_permissions('finance.view', 'finance.manage'))):
    return finance_service.profitability(db, session)
