from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditEventSummary(BaseModel):
    id: str
    event: str
    entity: str
    entity_id: str
    project_id: str | None
    customer_id: str | None
    user_id: str | None
    user_role: str
    actor_name: str = "System"
    changes: dict[str, Any]
    request_id: str
    created_at: datetime


class AuditEventList(BaseModel):
    data: list[AuditEventSummary]
    page: int
    page_size: int
    total: int
