from pydantic import BaseModel


class WorkspaceNotificationChannel(BaseModel):
    key: str
    title: str
    detail: str
    count: int


class WorkspaceNotificationSummary(BaseModel):
    channels: list[WorkspaceNotificationChannel]
    total: int
