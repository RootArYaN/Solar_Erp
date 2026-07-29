from datetime import datetime

from pydantic import BaseModel


class StoredFileSummary(BaseModel):
    id: str
    owner_type: str
    owner_id: str
    project_id: str | None
    customer_id: str | None
    name: str
    mime_type: str
    size_bytes: int
    checksum: str
    created_at: datetime


class StoredFileList(BaseModel):
    data: list[StoredFileSummary]
    page: int
    page_size: int
    total: int


class DocumentCustomerOption(BaseModel):
    id: str
    customer_name: str
    project_id: str | None = None
    project_number: str | None = None
    project_status: str | None = None

