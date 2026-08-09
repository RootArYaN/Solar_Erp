from __future__ import annotations

from typing import TYPE_CHECKING

import json
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session


if TYPE_CHECKING:
    from app.api.deps import CurrentSession

from app.core.request_context import request_id_var
from app.models.system import AuditEvent
from app.schemas.audit import AuditEventList, AuditEventSummary
from app.services.access_service import AccessError, get_customer, get_project


class AuditServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def write_event(
    db: Session,
    *,
    company_id: str,
    event: str,
    entity: str,
    entity_id: str,
    actor: CurrentSession | None = None,
    project_id: str | None = None,
    customer_id: str | None = None,
    changes: dict[str, Any] | None = None,
) -> AuditEvent:
    row = AuditEvent(
        company_id=company_id,
        event=event,
        entity=entity,
        entity_id=entity_id,
        project_id=project_id,
        customer_id=customer_id,
        user_id=actor.user.id if actor else None,
        user_role=actor.role if actor else "system",
        changes_json=json.dumps(changes or {}, separators=(",", ":"), default=str),
        request_id=request_id_var.get(),
    )
    db.add(row)
    return row


def list_events(
    db: Session,
    actor: CurrentSession,
    *,
    project_id: str | None,
    customer_id: str | None,
    entity: str | None,
    event: str | None,
    user_id: str | None,
    query: str | None,
    date_from: date | None,
    date_to: date | None,
    page: int,
    page_size: int,
) -> AuditEventList:
    try:
        if project_id:
            get_project(db, actor, project_id)
        if customer_id:
            get_customer(db, actor, customer_id)
    except AccessError as exc:
        raise AuditServiceError(str(exc), exc.status_code) from exc

    filters = [AuditEvent.company_id == actor.membership.company_id]
    if project_id:
        filters.append(AuditEvent.project_id == project_id)
    if customer_id:
        filters.append(AuditEvent.customer_id == customer_id)
    if entity:
        filters.append(AuditEvent.entity == entity)
    if event:
        filters.append(AuditEvent.event == event)
    if user_id:
        filters.append(AuditEvent.user_id == user_id)
    if date_from:
        filters.append(AuditEvent.created_at >= datetime.combine(date_from, time.min, tzinfo=UTC))
    if date_to:
        filters.append(AuditEvent.created_at < datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=UTC))
    term = (query or '').strip().lower()
    if term:
        like = f'%{term}%'
        filters.append(or_(
            func.lower(AuditEvent.event).like(like),
            func.lower(AuditEvent.entity).like(like),
            func.lower(AuditEvent.entity_id).like(like),
            func.lower(AuditEvent.user_role).like(like),
        ))

    total = db.scalar(select(func.count()).select_from(AuditEvent).where(*filters)) or 0
    rows = list(db.scalars(
        select(AuditEvent)
        .where(*filters)
        .order_by(AuditEvent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all())

    data: list[AuditEventSummary] = []
    for row in rows:
        try:
            changes = json.loads(row.changes_json or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            changes = {}
        data.append(AuditEventSummary(
            id=row.id,
            event=row.event,
            entity=row.entity,
            entity_id=row.entity_id,
            project_id=row.project_id,
            customer_id=row.customer_id,
            user_id=row.user_id,
            user_role=row.user_role,
            changes=changes if isinstance(changes, dict) else {},
            request_id=row.request_id,
            created_at=row.created_at,
        ))
    return AuditEventList(data=data, page=page, page_size=page_size, total=total)
