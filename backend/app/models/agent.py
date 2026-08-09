from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.auth import TimestampMixin, new_id, utc_now


class AgentProfile(TimestampMixin, Base):
    __tablename__ = "agent_profiles"
    __table_args__ = (UniqueConstraint("membership_id", name="uq_agent_profile_membership"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="CASCADE"), index=True, nullable=False)
    phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    alternate_phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    address_line_1: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    address_line_2: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    city: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    state: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    postal_code: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    customers: Mapped[list[AgentCustomer]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    transactions: Mapped[list[AgentTransaction]] = relationship(back_populates="agent", cascade="all, delete-orphan")


class AgentCustomer(TimestampMixin, Base):
    __tablename__ = "agent_customers"
    __table_args__ = (
        Index("ix_agent_customers_company_status_updated", "company_id", "status", "updated_at"),
        Index("ix_agent_customers_company_deleted", "company_id", "deleted_at"),
        Index("ix_agent_customers_company_completed", "company_id", "completed_at"),
        Index("ix_agent_customers_company_archived", "company_id", "archived_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    agent_profile_id: Mapped[str] = mapped_column(ForeignKey("agent_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_membership_id: Mapped[str | None] = mapped_column(
        ForeignKey("memberships.id", ondelete="SET NULL"), index=True, nullable=True
    )
    customer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    company_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)  # legacy, hidden in B2C UI
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    alternate_phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    address: Mapped[str] = mapped_column(String(320), default="", nullable=False)  # legacy site address
    billing_address: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    site_address: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    district: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    state: Mapped[str] = mapped_column(String(80), default="Gujarat", nullable=False)
    postal_code: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    consumer_number: Mapped[str] = mapped_column(String(80), default="", index=True, nullable=False)
    electricity_provider: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    customer_type: Mapped[str] = mapped_column(String(32), default="residential", index=True, nullable=False)
    lead_source: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    project_name: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True, nullable=False)
    outstanding_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True)
    delete_reason: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_by: Mapped[str | None] = mapped_column(ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True)

    agent: Mapped[AgentProfile] = relationship(back_populates="customers")


class AgentCustomerEdit(TimestampMixin, Base):
    __tablename__ = "agent_customer_edits"
    __table_args__ = (UniqueConstraint("customer_id", name="uq_agent_customer_edit_customer"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    edited_by_membership_id: Mapped[str | None] = mapped_column(
        ForeignKey("memberships.id", ondelete="SET NULL"), index=True, nullable=True
    )


class AgentTransaction(TimestampMixin, Base):
    __tablename__ = "agent_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    agent_profile_id: Mapped[str] = mapped_column(ForeignKey("agent_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    created_by_membership_id: Mapped[str | None] = mapped_column(
        ForeignKey("memberships.id", ondelete="SET NULL"), nullable=True
    )
    transaction_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    reference: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    description: Mapped[str] = mapped_column(String(240), default="", nullable=False)
    debit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)

    agent: Mapped[AgentProfile] = relationship(back_populates="transactions")
