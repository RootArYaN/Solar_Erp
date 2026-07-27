from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.auth import TimestampMixin, new_id, utc_now


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="CASCADE"), index=True, nullable=False)
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    device_name: Mapped[str] = mapped_column(String(120), default="Browser", nullable=False)
    browser: Mapped[str] = mapped_column(String(80), default="Unknown", nullable=False)
    operating_system: Mapped[str] = mapped_column(String(80), default="Unknown", nullable=False)
    approximate_location: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    ip_hint: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    user_agent: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    persistent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Archive(TimestampMixin, Base):
    __tablename__ = "archives"
    __table_args__ = (
        Index("ix_archives_company_status_created", "company_id", "status", "created_at"),
        Index("ix_archives_project", "project_id"),
        Index("ix_archives_customer", "customer_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    ref_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    agent_profile_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True, nullable=False)
    file_name: Mapped[str] = mapped_column(String(240), default="", nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    keep_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    cleaned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    meta_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)


class ArchiveJob(Base):
    __tablename__ = "archive_jobs"
    __table_args__ = (
        Index("ix_archive_jobs_company_status_created", "company_id", "status", "created_at"),
        Index("uq_archive_jobs_company_request_key", "company_id", "request_key", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    archive_id: Mapped[str] = mapped_column(ForeignKey("archives.id", ondelete="CASCADE"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    worker_id: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    request_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_project_created", "project_id", "created_at"),
        Index("ix_audit_events_customer_created", "customer_id", "created_at"),
        Index("ix_audit_events_entity_pair", "entity", "entity_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    event: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    entity: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_role: Mapped[str] = mapped_column(String(80), default="system", nullable=False)
    changes_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    request_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class StoredFile(Base):
    __tablename__ = "stored_files"
    __table_args__ = (
        Index("ix_stored_files_project_status", "project_id", "status"),
        Index("ix_stored_files_customer_status", "customer_id", "status"),
        Index("ix_stored_files_checksum", "checksum"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    owner_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    owner_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    project_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream", nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
