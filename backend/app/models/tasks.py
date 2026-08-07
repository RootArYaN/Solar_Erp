from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.auth import Membership, Role, TimestampMixin, new_id


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority IN ('low','normal','high','urgent')", name="ck_tasks_priority"),
        Index("ix_tasks_company_due", "company_id", "due_at"),
        Index("ix_tasks_company_priority_updated", "company_id", "priority", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    priority: Mapped[str] = mapped_column(String(12), default="normal", index=True, nullable=False)
    context_type: Mapped[str] = mapped_column(String(32), default="general", index=True, nullable=False)
    context_id: Mapped[str | None] = mapped_column(String(80), index=True, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), index=True, nullable=False)

    creator: Mapped[Membership] = relationship(foreign_keys=[created_by])
    assignments: Mapped[list[TaskAssignment]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class TaskAssignment(TimestampMixin, Base):
    __tablename__ = "task_assignments"
    __table_args__ = (
        UniqueConstraint("task_id", "membership_id", name="uq_task_assignment_member"),
        CheckConstraint("status IN ('todo','in_progress','blocked','done')", name="ck_task_assignments_status"),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_task_assignments_progress"),
        Index("ix_task_assignments_member_status", "membership_id", "status"),
        Index("ix_task_assignments_task_status", "task_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True, nullable=False)
    membership_id: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="CASCADE"), index=True, nullable=False)
    source_role_id: Mapped[str | None] = mapped_column(ForeignKey("roles.id", ondelete="SET NULL"), index=True, nullable=True)
    assigned_by: Mapped[str] = mapped_column(ForeignKey("memberships.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    note: Mapped[str] = mapped_column(String(600), default="", nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped[Task] = relationship(back_populates="assignments")
    membership: Mapped[Membership] = relationship(foreign_keys=[membership_id])
    source_role: Mapped[Role | None] = relationship(foreign_keys=[source_role_id])
    assigned_by_membership: Mapped[Membership] = relationship(foreign_keys=[assigned_by])
