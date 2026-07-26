from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.schemas.workflow import QuotationSummary


class AgentListItem(BaseModel):
    membership_id: str
    full_name: str
    email: EmailStr
    phone: str
    city: str
    is_active: bool
    customer_count: int
    current_balance: float


class AgentProfileSummary(BaseModel):
    id: str
    membership_id: str
    full_name: str
    email: EmailStr
    phone: str
    alternate_phone: str
    address_line_1: str
    address_line_2: str
    city: str
    state: str
    postal_code: str
    is_active: bool
    opening_balance: float
    current_balance: float


class AgentCustomerSummary(BaseModel):
    id: str
    customer_name: str
    company_name: str
    email: str
    phone: str
    alternate_phone: str = ""
    address: str
    billing_address: str = ""
    site_address: str = ""
    district: str = ""
    state: str = ""
    postal_code: str = ""
    consumer_number: str = ""
    electricity_provider: str = ""
    customer_type: str = "residential"
    lead_source: str = ""
    project_name: str
    status: str
    outstanding_balance: float
    quotation_request_status: str | None = None
    quotation_status: str | None = None
    project_id: str | None = None
    project_number: str | None = None
    project_status: str | None = None
    approved_quotation: QuotationSummary | None = None
    can_edit: bool = False


class AgentTransactionSummary(BaseModel):
    id: str
    project_id: str | None = None
    transaction_date: datetime
    reference: str
    transaction_type: str
    description: str
    debit: float
    credit: float
    running_balance: float
    approval_status: str
    approval_comment: str


class AgentOverviewResponse(BaseModel):
    profile: AgentProfileSummary
    customer_count: int
    active_customer_count: int
    customer_outstanding: float
    customers: list[AgentCustomerSummary]
    transactions: list[AgentTransactionSummary]


class UpdateAgentProfileRequest(BaseModel):
    phone: str = Field(default="", max_length=32)
    alternate_phone: str = Field(default="", max_length=32)
    address_line_1: str = Field(default="", max_length=180)
    address_line_2: str = Field(default="", max_length=180)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=80)
    postal_code: str = Field(default="", max_length=16)

    @field_validator(
        "phone",
        "alternate_phone",
        "address_line_1",
        "address_line_2",
        "city",
        "state",
        "postal_code",
    )
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class CreateAgentCustomerRequest(BaseModel):
    customer_name: str = Field(min_length=2, max_length=160)
    company_name: str = Field(default="", max_length=160)
    email: str = Field(default="", max_length=320)
    phone: str = Field(min_length=7, max_length=32)
    alternate_phone: str = Field(default="", max_length=32)
    address: str = Field(default="", max_length=320)
    billing_address: str = Field(default="", max_length=320)
    site_address: str = Field(default="", max_length=320)
    district: str = Field(default="", max_length=80)
    state: str = Field(default="Gujarat", max_length=80)
    postal_code: str = Field(default="", max_length=16)
    consumer_number: str = Field(default="", max_length=80)
    electricity_provider: str = Field(default="", max_length=100)
    customer_type: str = Field(default="residential", pattern=r"^(residential|commercial|society|institutional)$")
    lead_source: str = Field(default="", max_length=80)
    project_name: str = Field(default="", max_length=180)

    @field_validator("customer_name", "company_name", "email", "phone", "alternate_phone", "address", "billing_address", "site_address", "district", "state", "postal_code", "consumer_number", "electricity_provider", "lead_source", "project_name")
    @classmethod
    def clean_customer_text(cls, value: str) -> str:
        return " ".join(value.split())


class UpdateAgentCustomerRequest(CreateAgentCustomerRequest):
    pass


class CreateAgentTransactionRequest(BaseModel):
    transaction_date: datetime | None = None
    project_id: str | None = Field(default=None, max_length=36)
    reference: str = Field(default="", max_length=60)
    transaction_type: str = Field(pattern=r"^[a-z][a-z0-9_]{1,31}$")
    description: str = Field(default="", max_length=240)
    debit: float = Field(default=0, ge=0, le=999999999999.99)
    credit: float = Field(default=0, ge=0, le=999999999999.99)

    @field_validator("reference", "description")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("transaction_type")
    @classmethod
    def clean_type(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def validate_amounts(self):
        has_debit = self.debit > 0
        has_credit = self.credit > 0
        if has_debit == has_credit:
            raise ValueError("Enter either a debit or a credit amount")
        return self
