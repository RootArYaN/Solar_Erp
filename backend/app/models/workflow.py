from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.auth import TimestampMixin, new_id


class QuotationRequest(TimestampMixin, Base):
    __tablename__ = "quotation_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    requested_by_membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), index=True, nullable=False)
    requirement_summary: Mapped[str] = mapped_column(String(240), nullable=False)
    proposed_capacity_kw: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    site_address: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    notes: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True, nullable=False)
    reviewed_by_membership_id: Mapped[str | None] = mapped_column(ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_comment: Mapped[str] = mapped_column(String(400), default="", nullable=False)


class CustomerQuotation(TimestampMixin, Base):
    __tablename__ = "customer_quotations"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_customer_quotation_request"),
        UniqueConstraint("company_id", "quotation_number", name="uq_company_quotation_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    request_id: Mapped[str] = mapped_column(ForeignKey("quotation_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    quotation_number: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    line_items_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    grand_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending_approval", index=True, nullable=False)
    created_by_membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    decided_by_membership_id: Mapped[str | None] = mapped_column(ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str] = mapped_column(String(400), default="", nullable=False)


class CustomerProject(TimestampMixin, Base):
    __tablename__ = "customer_projects"
    __table_args__ = (
        UniqueConstraint("quotation_id", name="uq_customer_project_quotation"),
        UniqueConstraint("company_id", "project_number", name="uq_company_project_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    quotation_id: Mapped[str] = mapped_column(ForeignKey("customer_quotations.id", ondelete="RESTRICT"), index=True, nullable=False)
    project_number: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="planning", index=True, nullable=False)
    capacity_kw: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    approved_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)


class TransactionApproval(TimestampMixin, Base):
    __tablename__ = "transaction_approvals"
    __table_args__ = (UniqueConstraint("transaction_id", name="uq_transaction_approval_transaction"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("agent_transactions.id", ondelete="CASCADE"), index=True, nullable=False)
    submitted_by_membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True, nullable=False)
    decided_by_membership_id: Mapped[str | None] = mapped_column(ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_comment: Mapped[str] = mapped_column(String(400), default="", nullable=False)
