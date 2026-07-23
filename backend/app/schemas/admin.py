from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class PermissionSummary(BaseModel):
    id: str
    code: str
    name: str
    description: str


class RoleSummary(BaseModel):
    id: str
    name: str
    code: str
    description: str
    is_system: bool
    permissions: list[str]
    member_count: int


class UserAdminSummary(BaseModel):
    id: str
    membership_id: str
    email: EmailStr
    full_name: str
    is_active: bool
    is_super_admin: bool
    roles: list[str]
    created_at: datetime


class CreateUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role_codes: list[str] = Field(min_length=1, max_length=10)
    is_active: bool = True

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("role_codes")
    @classmethod
    def clean_role_codes(cls, values: list[str]) -> list[str]:
        cleaned = sorted({value.strip().lower() for value in values if value.strip()})
        if not cleaned:
            raise ValueError("At least one role is required")
        return cleaned


class UpdateUserRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    role_codes: list[str] | None = Field(default=None, min_length=1, max_length=10)
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str | None) -> str | None:
        return " ".join(value.split()) if value is not None else None

    @field_validator("role_codes")
    @classmethod
    def clean_role_codes(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        cleaned = sorted({value.strip().lower() for value in values if value.strip()})
        if not cleaned:
            raise ValueError("At least one role is required")
        return cleaned


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class CreateRoleRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    description: str = Field(default="", max_length=240)
    permission_codes: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("code")
    @classmethod
    def clean_code(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("permission_codes")
    @classmethod
    def clean_permission_codes(cls, values: list[str]) -> list[str]:
        return sorted({value.strip().lower() for value in values if value.strip()})


class UpdateRoleRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    permission_codes: list[str] | None = Field(default=None, max_length=100)

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value: str | None) -> str | None:
        return " ".join(value.split()) if value is not None else None

    @field_validator("permission_codes")
    @classmethod
    def clean_permission_codes(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return sorted({value.strip().lower() for value in values if value.strip()})
