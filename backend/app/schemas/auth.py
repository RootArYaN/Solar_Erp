from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    company_code: str | None = Field(default=None, max_length=32)


class UserSummary(BaseModel):
    id: str
    email: EmailStr
    full_name: str


class CompanySummary(BaseModel):
    id: str
    name: str
    code: str


class SessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserSummary
    company: CompanySummary
    roles: list[str]
    permissions: list[str]


class MeResponse(BaseModel):
    user: UserSummary
    company: CompanySummary
    roles: list[str]
    permissions: list[str]
