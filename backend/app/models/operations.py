from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.auth import TimestampMixin, new_id


class InventoryItem(TimestampMixin, Base):
    __tablename__ = "inventory_items"
    __table_args__ = (UniqueConstraint("company_id", "sku", name="uq_inventory_item_company_sku"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    sku: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="General", index=True, nullable=False)
    unit: Mapped[str] = mapped_column(String(24), default="Nos", nullable=False)
    supplier_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    reorder_level: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class InventoryLocation(TimestampMixin, Base):
    __tablename__ = "inventory_locations"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_inventory_location_company_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location_type: Mapped[str] = mapped_column(String(32), default="warehouse", nullable=False)
    address: Mapped[str] = mapped_column(String(320), default="", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class InventoryBalance(TimestampMixin, Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (UniqueConstraint("item_id", "location_id", name="uq_inventory_balance_item_location"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id", ondelete="CASCADE"), index=True, nullable=False)
    location_id: Mapped[str] = mapped_column(ForeignKey("inventory_locations.id", ondelete="CASCADE"), index=True, nullable=False)
    quantity_on_hand: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"), nullable=False)
    reserved_quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("0.000"), nullable=False)


class InventoryMovement(TimestampMixin, Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        Index("ix_inventory_movement_company_created", "company_id", "created_at"),
        Index("ix_inventory_movement_company_status_created", "company_id", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey("inventory_items.id", ondelete="RESTRICT"), index=True, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    source_location_id: Mapped[str | None] = mapped_column(ForeignKey("inventory_locations.id", ondelete="RESTRICT"), index=True, nullable=True)
    destination_location_id: Mapped[str | None] = mapped_column(ForeignKey("inventory_locations.id", ondelete="RESTRICT"), index=True, nullable=True)
    source_location_manual: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    destination_location_manual: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("customer_projects.id", ondelete="SET NULL"), index=True, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("agent_customers.id", ondelete="SET NULL"), index=True, nullable=True)
    challan_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    movement_group_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    reference_number: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    challan_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    supplier_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    transporter_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    vehicle_number: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    driver_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    driver_phone: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    eway_bill_number: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    note: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="completed", index=True, nullable=False)
    reversed_movement_id: Mapped[str | None] = mapped_column(
        ForeignKey("inventory_movements.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    correction_of_movement_id: Mapped[str | None] = mapped_column(
        ForeignKey("inventory_movements.id", ondelete="RESTRICT"), index=True, nullable=True
    )
    reason: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class PricingBook(TimestampMixin, Base):
    __tablename__ = "pricing_books"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    updated_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class PricingItem(TimestampMixin, Base):
    __tablename__ = "pricing_items"
    __table_args__ = (UniqueConstraint("pricing_book_id", "name", name="uq_pricing_item_book_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    pricing_book_id: Mapped[str] = mapped_column(ForeignKey("pricing_books.id", ondelete="CASCADE"), index=True, nullable=False)
    inventory_item_id: Mapped[str | None] = mapped_column(ForeignKey("inventory_items.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="General", index=True, nullable=False)
    unit: Mapped[str] = mapped_column(String(24), default="Nos", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1.000"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 3), default=Decimal("0.000"), nullable=False)
    calculation_type: Mapped[str] = mapped_column(String(32), default="quantity", nullable=False)
    calculation_value: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=Decimal("1.000"), nullable=False)
    display_order: Mapped[int] = mapped_column(default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Poster(TimestampMixin, Base):
    __tablename__ = "posters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    file_id: Mapped[str] = mapped_column(ForeignKey("stored_files.id", ondelete="RESTRICT"), index=True, nullable=False)
    thumbnail_file_id: Mapped[str | None] = mapped_column(ForeignKey("stored_files.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(80), default="General", index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class GeneratedDocumentPack(TimestampMixin, Base):
    __tablename__ = "generated_document_packs"
    __table_args__ = (
        UniqueConstraint("company_id", "customer_id", "version", name="uq_document_pack_company_customer_version"),
        Index("ix_document_pack_company_customer_status", "company_id", "customer_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(ForeignKey("agent_customers.id", ondelete="CASCADE"), index=True, nullable=False)
    project_id: Mapped[str] = mapped_column(ForeignKey("customer_projects.id", ondelete="CASCADE"), index=True, nullable=False)
    quotation_id: Mapped[str] = mapped_column(ForeignKey("customer_quotations.id", ondelete="RESTRICT"), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True, nullable=False)
    input_snapshot_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    template_snapshot_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    updated_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)


class DocumentTemplate(TimestampMixin, Base):
    __tablename__ = "document_templates"
    __table_args__ = (UniqueConstraint("company_id", "template_type", name="uq_document_template_company_type"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    template_type: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    settings_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
