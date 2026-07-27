from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.auth import TimestampMixin, new_id


class FinancialAccount(TimestampMixin, Base):
    __tablename__ = "financial_accounts"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_financial_account_company_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    account_type: Mapped[str] = mapped_column(String(24), default="bank", index=True, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    masked_account_number: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FinanceCategory(TimestampMixin, Base):
    __tablename__ = "finance_categories"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_finance_category_company_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    category_type: Mapped[str] = mapped_column(String(24), default="expense", index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FinanceTransaction(TimestampMixin, Base):
    __tablename__ = "finance_transactions"
    __table_args__ = (
        UniqueConstraint("company_id", "transaction_number", name="uq_finance_transaction_company_number"),
        Index("ix_finance_transactions_company_date", "company_id", "transaction_date"),
        Index("ix_finance_transactions_customer_project", "customer_id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    transaction_number: Mapped[str] = mapped_column(String(48), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    direction: Mapped[str] = mapped_column(String(12), index=True, nullable=False)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("finance_categories.id", ondelete="SET NULL"), index=True, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    account_id: Mapped[str] = mapped_column(ForeignKey("financial_accounts.id", ondelete="RESTRICT"), index=True, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(24), default="bank", nullable=False)
    party_type: Mapped[str] = mapped_column(String(24), default="other", nullable=False)
    party_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("agent_customers.id", ondelete="SET NULL"), index=True, nullable=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("customer_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    agent_id: Mapped[str | None] = mapped_column(ForeignKey("agent_profiles.id", ondelete="SET NULL"), index=True, nullable=True)
    supplier_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    source_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    transfer_group_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    reference_number: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    description: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="posted", index=True, nullable=False)
    receipt_file_id: Mapped[str | None] = mapped_column(ForeignKey("stored_files.id", ondelete="SET NULL"), nullable=True)
    reversed_transaction_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class Bill(TimestampMixin, Base):
    __tablename__ = "bills"
    __table_args__ = (
        UniqueConstraint("company_id", "bill_type", "bill_number", name="uq_bill_company_type_number"),
        Index("ix_bills_company_due_status", "company_id", "due_date", "payment_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    bill_type: Mapped[str] = mapped_column(String(16), index=True, nullable=False)
    bill_number: Mapped[str] = mapped_column(String(48), nullable=False)
    bill_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("agent_customers.id", ondelete="SET NULL"), index=True, nullable=True)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("customer_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    balance_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(24), default="unpaid", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="issued", index=True, nullable=False)
    file_id: Mapped[str | None] = mapped_column(ForeignKey("stored_files.id", ondelete="SET NULL"), nullable=True)
    note: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class BillPayment(TimestampMixin, Base):
    __tablename__ = "bill_payments"
    __table_args__ = (UniqueConstraint("bill_id", "transaction_id", name="uq_bill_payment_transaction"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    bill_id: Mapped[str] = mapped_column(ForeignKey("bills.id", ondelete="CASCADE"), index=True, nullable=False)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("finance_transactions.id", ondelete="RESTRICT"), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)


class CustomerLoan(TimestampMixin, Base):
    __tablename__ = "customer_loans"
    __table_args__ = (UniqueConstraint("project_id", name="uq_customer_loan_project"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("customer_projects.id", ondelete="CASCADE"), index=True, nullable=False)
    bank_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    application_number: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    requested_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    approved_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    customer_contribution: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    application_status: Mapped[str] = mapped_column(String(32), default="draft", index=True, nullable=False)
    documentation_status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    approval_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    first_disbursement_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    first_disbursement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    second_disbursement_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    second_disbursement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    emi_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    emi_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loan_status: Mapped[str] = mapped_column(String(32), default="draft", index=True, nullable=False)
    note: Mapped[str] = mapped_column(String(500), default="", nullable=False)


class CompanyLoan(TimestampMixin, Base):
    __tablename__ = "company_loans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    lender_name: Mapped[str] = mapped_column(String(160), nullable=False)
    loan_account_number: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    interest_rate: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=Decimal("0.000"), nullable=False)
    emi_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    outstanding_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    next_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True, nullable=False)
    note: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
