from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class FinancialAccountSummary(BaseModel):
    id: str
    name: str
    account_type: str
    bank_name: str
    masked_account_number: str
    opening_balance: float
    current_balance: float
    is_active: bool
    updated_at: datetime


class CreateFinancialAccountRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    account_type: Literal['bank', 'cash', 'upi', 'petty_cash'] = 'bank'
    bank_name: str = Field(default='', max_length=120)
    masked_account_number: str = Field(default='', max_length=40)
    opening_balance: float = Field(default=0, ge=-999999999999.99, le=999999999999.99)

    @field_validator('name', 'bank_name', 'masked_account_number')
    @classmethod
    def clean(cls, value: str) -> str:
        return ' '.join(value.split())


class FinanceCategorySummary(BaseModel):
    id: str
    code: str
    name: str
    category_type: str


class FinanceTransactionSummary(BaseModel):
    id: str
    transaction_number: str
    transaction_date: date
    direction: str
    category_id: str | None
    category_name: str
    amount: float
    account_id: str
    account_name: str
    payment_method: str
    party_type: str
    party_name: str
    customer_id: str | None
    customer_name: str
    project_id: str | None
    project_number: str
    source_type: str
    source_id: str | None
    reference_number: str
    description: str
    status: str
    created_by_name: str
    created_at: datetime


class FinanceTransactionList(BaseModel):
    data: list[FinanceTransactionSummary]
    page: int
    page_size: int
    total: int
    money_in: float
    money_out: float


class CreateFinanceTransactionRequest(BaseModel):
    transaction_date: date
    direction: Literal['credit', 'debit']
    category_id: str | None = None
    amount: float = Field(gt=0, le=999999999999.99)
    account_id: str
    payment_method: str = Field(default='bank', max_length=24)
    party_type: str = Field(default='other', max_length=24)
    party_name: str = Field(default='', max_length=160)
    customer_id: str | None = None
    project_id: str | None = None
    agent_id: str | None = None
    supplier_id: str | None = None
    source_type: str = Field(default='manual_adjustment', pattern=r'^[a-z][a-z0-9_]{1,39}$')
    source_id: str | None = None
    reference_number: str = Field(default='', max_length=80)
    description: str = Field(default='', max_length=320)
    receipt_file_id: str | None = None

    @field_validator('payment_method', 'party_type', 'party_name', 'reference_number', 'description')
    @classmethod
    def clean(cls, value: str) -> str:
        return ' '.join(value.split())


class UpdateFinanceTransactionRequest(BaseModel):
    transaction_date: date
    direction: Literal['credit', 'debit']
    category_id: str | None = None
    amount: float = Field(gt=0, le=999999999999.99)
    account_id: str
    payment_method: str = Field(max_length=24)
    source_type: str = Field(pattern=r'^[a-z][a-z0-9_]{1,39}$')
    reference_number: str = Field(default='', max_length=80)
    description: str = Field(default='', max_length=320)

    @field_validator('payment_method', 'reference_number', 'description')
    @classmethod
    def clean(cls, value: str) -> str:
        return ' '.join(value.split())




class ReverseFinanceTransactionRequest(BaseModel):
    transaction_date: date
    reason: str = Field(min_length=3, max_length=320)

    @field_validator('reason')
    @classmethod
    def clean_reason(cls, value: str) -> str:
        return ' '.join(value.split())


class AccountTransferRequest(BaseModel):
    transaction_date: date
    source_account_id: str
    destination_account_id: str
    amount: float = Field(gt=0, le=999999999999.99)
    reference_number: str = Field(default='', max_length=80)
    description: str = Field(default='Account transfer', max_length=320)

    @model_validator(mode='after')
    def different_accounts(self):
        if self.source_account_id == self.destination_account_id:
            raise ValueError('Source and destination accounts must be different')
        return self


class BillSummary(BaseModel):
    id: str
    bill_type: str
    bill_number: str
    bill_date: date
    customer_id: str | None
    customer_name: str
    project_id: str | None
    project_number: str
    supplier_name: str
    subtotal: float
    tax_amount: float
    total_amount: float
    due_date: date | None
    paid_amount: float
    balance_amount: float
    payment_status: str
    status: str
    file_id: str | None
    note: str
    created_at: datetime


class BillList(BaseModel):
    data: list[BillSummary]
    page: int
    page_size: int
    total: int


class BillCustomerOption(BaseModel):
    id: str
    customer_name: str


class CreateBillRequest(BaseModel):
    bill_type: Literal['sales', 'purchase']
    bill_number: str = Field(min_length=2, max_length=48)
    bill_date: date
    customer_id: str | None = None
    project_id: str | None = None
    supplier_name: str = Field(default='', max_length=160)
    subtotal: float = Field(ge=0, le=999999999999.99)
    tax_amount: float = Field(default=0, ge=0, le=999999999999.99)
    due_date: date | None = None
    file_id: str | None = None
    note: str = Field(default='', max_length=400)

    @model_validator(mode='after')
    def validate_party(self):
        if self.bill_type == 'sales' and not self.customer_id:
            raise ValueError('A customer is required for a sales bill')
        if self.bill_type == 'purchase' and not self.supplier_name.strip():
            raise ValueError('A supplier is required for a purchase bill')
        return self


class UpdateBillRequest(BaseModel):
    bill_number: str = Field(min_length=2, max_length=48)
    bill_date: date
    customer_id: str | None = None
    project_id: str | None = None
    supplier_name: str = Field(default='', max_length=160)
    subtotal: float = Field(ge=0, le=999999999999.99)
    tax_amount: float = Field(default=0, ge=0, le=999999999999.99)
    due_date: date | None = None
    note: str = Field(default='', max_length=400)


class RecordBillPaymentRequest(BaseModel):
    transaction_date: date
    amount: float = Field(gt=0, le=999999999999.99)
    account_id: str
    payment_method: str = Field(default='bank', max_length=24)
    reference_number: str = Field(default='', max_length=80)
    description: str = Field(default='', max_length=320)


class CustomerLoanSummary(BaseModel):
    id: str
    customer_id: str
    project_id: str
    bank_name: str
    application_number: str
    requested_amount: float
    approved_amount: float
    customer_contribution: float
    application_status: str
    documentation_status: str
    approval_date: date | None
    first_disbursement_amount: float
    first_disbursement_date: date | None
    second_disbursement_amount: float
    second_disbursement_date: date | None
    emi_amount: float
    emi_start_date: date | None
    loan_status: str
    note: str
    updated_at: datetime


class UpsertCustomerLoanRequest(BaseModel):
    bank_name: str = Field(default='', max_length=120)
    application_number: str = Field(default='', max_length=80)
    requested_amount: float = Field(default=0, ge=0)
    approved_amount: float = Field(default=0, ge=0)
    customer_contribution: float = Field(default=0, ge=0)
    application_status: str = Field(default='draft', max_length=32)
    documentation_status: str = Field(default='pending', max_length=32)
    approval_date: date | None = None
    first_disbursement_amount: float = Field(default=0, ge=0)
    first_disbursement_date: date | None = None
    second_disbursement_amount: float = Field(default=0, ge=0)
    second_disbursement_date: date | None = None
    emi_amount: float = Field(default=0, ge=0)
    emi_start_date: date | None = None
    loan_status: str = Field(default='draft', max_length=32)
    note: str = Field(default='', max_length=500)


class CompanyLoanSummary(BaseModel):
    id: str
    lender_name: str
    loan_account_number: str
    principal_amount: float
    interest_rate: float
    emi_amount: float
    start_date: date
    end_date: date | None
    outstanding_amount: float
    next_due_date: date | None
    status: str
    note: str
    created_at: datetime
    updated_at: datetime


class CreateCompanyLoanRequest(BaseModel):
    lender_name: str = Field(min_length=2, max_length=160)
    loan_account_number: str = Field(default='', max_length=80)
    principal_amount: float = Field(gt=0)
    interest_rate: float = Field(default=0, ge=0, le=100)
    emi_amount: float = Field(default=0, ge=0)
    start_date: date
    end_date: date | None = None
    next_due_date: date | None = None
    account_id: str
    reference_number: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=500)


class UpdateCompanyLoanRequest(BaseModel):
    lender_name: str = Field(min_length=2, max_length=160)
    loan_account_number: str = Field(default='', max_length=80)
    principal_amount: float = Field(gt=0, le=999999999999.99)
    interest_rate: float = Field(default=0, ge=0, le=100)
    emi_amount: float = Field(default=0, ge=0, le=999999999999.99)
    start_date: date
    end_date: date | None = None
    next_due_date: date | None = None
    note: str = Field(default='', max_length=500)


class CompanyLoanPaymentRequest(BaseModel):
    transaction_date: date
    amount: float = Field(gt=0)
    account_id: str
    reference_number: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=320)


class FinanceOverview(BaseModel):
    money_in_month: float
    money_out_month: float
    bank_balance: float
    cash_balance: float
    customer_receivables: float
    supplier_payables: float
    expenses_month: float
    net_cash_flow: float
    accounts: list[FinancialAccountSummary]
    recent_transactions: list[FinanceTransactionSummary]
    pending_bills: list[BillSummary]
    expense_by_category: list[dict[str, float | str]]
    monthly_flow: list[dict[str, float | str]]


class ProfitabilitySummary(BaseModel):
    sales_value: float
    money_received: float
    subsidy_received: float
    material_cost: float
    project_expenses: float
    operating_expenses: float
    net_cash_flow: float
    estimated_gross_profit: float
    projects: list[dict[str, float | str]]
