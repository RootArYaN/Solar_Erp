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
    username: str
    email: EmailStr
    full_name: str
    is_active: bool
    is_super_admin: bool
    role: str
    created_at: datetime


class CreateUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=50, pattern=r"^[a-zA-Z0-9._-]+$")
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role_code: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    is_active: bool = True

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("role_code")
    @classmethod
    def clean_role_code(cls, value: str) -> str:
        return value.strip().lower()


class UpdateUserRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    username: str | None = Field(
        default=None,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9._-]+$",
    )
    email: EmailStr | None = None
    role_code: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,39}$")
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def clean_full_name(cls, value: str | None) -> str | None:
        return " ".join(value.split()) if value is not None else None

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str | None) -> str | None:
        return value.strip().lower() if value is not None else None

    @field_validator("role_code")
    @classmethod
    def clean_role_code(cls, value: str | None) -> str | None:
        return value.strip().lower() if value is not None else None


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


class DataHealthCheck(BaseModel):
    key: str
    label: str
    severity: str
    count: int
    description: str
    sample_ids: list[str] = Field(default_factory=list)


class DataHealthSummary(BaseModel):
    generated_at: datetime
    issue_count: int
    checks: list[DataHealthCheck] = Field(default_factory=list)
