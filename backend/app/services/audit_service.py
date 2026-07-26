from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.core.request_context import request_id_var
from app.models.system import AuditEvent


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
