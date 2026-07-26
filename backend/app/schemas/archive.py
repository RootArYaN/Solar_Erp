from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator


class ArchiveSummary(BaseModel):
    id: str
    type: str
    ref_id: str
    project_id: str | None
    customer_id: str | None
    customer_name: str = ""
    agent_name: str = ""
    project_name: str = ""
    status: str
    file_name: str
    size_bytes: int
    checksum: str
    created_at: datetime
    verified_at: datetime | None
    keep_until: datetime | None
    cleaned_at: datetime | None
    restored_at: datetime | None
    error: str


class ArchiveList(BaseModel):
    data: list[ArchiveSummary]
    page: int
    page_size: int
    total: int


class ArchiveKpis(BaseModel):
    archived_projects: int
    storage_used: int
    ready_for_cleanup: int
    failed_jobs: int
    last_cleanup: datetime | None


class ArchiveFileEntry(BaseModel):
    relative_path: str
    name: str
    size_bytes: int
    checksum: str
    mime_type: str
    source_file_id: str | None = None


class ArchiveDetail(ArchiveSummary):
    version: int
    meta: dict[str, Any]
    files: list[ArchiveFileEntry]


class ArchiveJobSummary(BaseModel):
    id: str
    archive_id: str
    action: str
    status: str
    progress: int
    started_at: datetime | None
    finished_at: datetime | None
    error: str
    created_at: datetime


class AgentTransactionArchiveRequest(BaseModel):
    agent_membership_id: str = Field(min_length=36, max_length=36)
    from_date: date
    to_date: date
    transaction_type: str | None = Field(default=None, max_length=32)
    project_id: str | None = Field(default=None, max_length=36)

    @field_validator("transaction_type")
    @classmethod
    def clean_type(cls, value: str | None) -> str | None:
        return value.strip().lower() if value else None

    @model_validator(mode="after")
    def validate_range(self):
        if self.to_date < self.from_date:
            raise ValueError("To date must be on or after from date")
        return self


class CleanupRequest(BaseModel):
    force: bool = False


class PurgeRequest(BaseModel):
    confirmation: str = Field(min_length=5, max_length=80)
    reason: str = Field(min_length=3, max_length=300)

    @field_validator("confirmation", "reason")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class AuditEventSummary(BaseModel):
    id: str
    event: str
    entity: str
    entity_id: str
    project_id: str | None
    customer_id: str | None
    user_id: str | None
    user_role: str
    changes: dict[str, Any]
    request_id: str
    created_at: datetime


class AuditEventList(BaseModel):
    data: list[AuditEventSummary]
    page: int
    page_size: int
    total: int
