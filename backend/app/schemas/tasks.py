from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

TaskPriority = Literal["low", "normal", "high", "urgent"]
TaskStatus = Literal["todo", "in_progress", "blocked", "done"]
TaskContext = Literal["general", "customers", "projects", "finance", "inventory", "documents"]
TaskScope = Literal["mine", "team"]


class TaskAssignmentSummary(BaseModel):
    id: str
    membership_id: str
    assignee_name: str
    role_code: str
    source_role_id: str | None
    source_role_name: str | None
    status: TaskStatus
    progress: int
    note: str
    completed_at: datetime | None
    updated_at: datetime


class TaskSummary(BaseModel):
    id: str
    version: int
    title: str
    description: str
    priority: TaskPriority
    context_type: TaskContext
    context_id: str | None
    due_at: datetime | None
    created_by_membership_id: str
    created_by_name: str
    created_at: datetime
    updated_at: datetime
    status: TaskStatus
    progress: int
    overdue: bool
    is_mine: bool
    can_edit: bool
    can_delete: bool
    can_manage_assignments: bool
    assignments: list[TaskAssignmentSummary]


class TaskList(BaseModel):
    data: list[TaskSummary]
    page: int
    page_size: int
    total: int


class TaskMetrics(BaseModel):
    my_open: int = 0
    my_overdue: int = 0
    my_due_today: int = 0
    my_completed: int = 0
    team_open: int = 0
    team_overdue: int = 0


class TaskUserOption(BaseModel):
    membership_id: str
    full_name: str
    role_code: str


class TaskRoleOption(BaseModel):
    id: str
    name: str
    code: str
    member_count: int


class TaskOptions(BaseModel):
    users: list[TaskUserOption]
    roles: list[TaskRoleOption]


class CreateTaskRequest(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=4000)
    priority: TaskPriority = "normal"
    context_type: TaskContext = "general"
    context_id: str | None = Field(default=None, max_length=80)
    due_at: datetime | None = None
    assignee_membership_ids: list[str] = Field(default_factory=list, max_length=100)
    assignee_role_ids: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_text(cls, value: object) -> object:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("context_id")
    @classmethod
    def clean_context_id(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else ""
        return cleaned or None

    @field_validator("assignee_membership_ids", "assignee_role_ids")
    @classmethod
    def unique_ids(cls, values: list[str]) -> list[str]:
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))


class UpdateTaskRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, max_length=4000)
    priority: TaskPriority | None = None
    context_type: TaskContext | None = None
    context_id: str | None = Field(default=None, max_length=80)
    due_at: datetime | None = None
    assignee_membership_ids: list[str] | None = Field(default=None, max_length=100)
    assignee_role_ids: list[str] | None = Field(default=None, max_length=30)
    expected_version: int = Field(ge=1)

    @field_validator("title", "description", mode="before")
    @classmethod
    def clean_text(cls, value: object) -> object:
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("context_id")
    @classmethod
    def clean_context_id(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else ""
        return cleaned or None

    @field_validator("assignee_membership_ids", "assignee_role_ids")
    @classmethod
    def unique_ids(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))

    @model_validator(mode="after")
    def ensure_change(self):
        if not (self.model_fields_set - {"expected_version"}):
            raise ValueError("Provide at least one task field to update")
        return self


class UpdateTaskAssignmentRequest(BaseModel):
    status: TaskStatus | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    note: str | None = Field(default=None, max_length=600)
    expected_version: int = Field(ge=1)

    @field_validator("note")
    @classmethod
    def clean_note(cls, value: str | None) -> str | None:
        return " ".join(value.split()) if value is not None else None

    @model_validator(mode="after")
    def ensure_change(self):
        if self.status is None and self.progress is None and self.note is None:
            raise ValueError("Provide a status, progress or note update")
        return self
