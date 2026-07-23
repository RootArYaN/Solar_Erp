from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    agent_profile_id: Mapped[str] = mapped_column(ForeignKey("agent_profiles.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_membership_id: Mapped[str | None] = mapped_column(
        ForeignKey("memberships.id", ondelete="SET NULL"), index=True, nullable=True
    )
    customer_name: Mapped[str] = mapped_column(String(160), nullable=False)
    company_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    address: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    project_name: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True, nullable=False)
    outstanding_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    agent: Mapped[AgentProfile] = relationship(back_populates="customers")


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

    agent: Mapped[AgentProfile] = relationship(back_populates="transactions")
