from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    password: str = Field(min_length=8, max_length=128)
    remember: bool = True

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip().lower()


class UserSummary(BaseModel):
    id: str
    username: str
    email: EmailStr
    full_name: str
    is_super_admin: bool = False


class CompanySummary(BaseModel):
    id: str
    name: str
    code: str


class SessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    membership_id: str
    user: UserSummary
    company: CompanySummary
    role: str
    permissions: list[str]


class MeResponse(BaseModel):
    membership_id: str
    user: UserSummary
    company: CompanySummary
    role: str
    permissions: list[str]


class ActiveDeviceSummary(BaseModel):
    id: str
    device_name: str
    browser: str
    operating_system: str
    approximate_location: str
    ip_hint: str
    created_at: datetime
    last_seen_at: datetime
    is_current: bool
