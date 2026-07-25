from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class CreateQuotationRequest(BaseModel):
    requirement_summary: str = Field(min_length=2, max_length=240)
    proposed_capacity_kw: float = Field(gt=0, le=100000)
    site_address: str = Field(default="", max_length=320)
    notes: str = Field(default="", max_length=600)

    @field_validator("requirement_summary", "site_address", "notes")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class QuotationLineInput(BaseModel):
    description: str = Field(min_length=2, max_length=180)
    quantity: float = Field(gt=0, le=1000000)
    unit: str = Field(min_length=1, max_length=24)
    unit_price: float = Field(ge=0, le=999999999999.99)
    tax_rate: float = Field(default=0, ge=0, le=100)

    @field_validator("description", "unit")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())


class GenerateQuotationRequest(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    valid_until: datetime | None = None
    lines: list[QuotationLineInput] = Field(min_length=1, max_length=100)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        return " ".join(value.split())


class ApprovalDecisionRequest(BaseModel):
    decision: str = Field(pattern=r"^(approved|rejected)$")
    comment: str = Field(default="", max_length=400)

    @field_validator("decision")
    @classmethod
    def clean_decision(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("comment")
    @classmethod
    def clean_comment(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def require_rejection_comment(self):
        if self.decision == "rejected" and len(self.comment) < 3:
            raise ValueError("A rejection comment is required")
        return self


class QuotationSummary(BaseModel):
    id: str
    quotation_number: str
    title: str
    subtotal: float
    tax_total: float
    grand_total: float
    valid_until: datetime | None
    status: str
    decision_comment: str
    created_at: datetime


class QuotationRequestSummary(BaseModel):
    id: str
    customer_id: str
    customer_name: str
    company_name: str
    agent_membership_id: str
    agent_name: str
    requirement_summary: str
    proposed_capacity_kw: float
    site_address: str
    notes: str
    status: str
    review_comment: str
    created_at: datetime
    quotation: QuotationSummary | None
    project_number: str | None
    project_status: str | None


class TransactionApprovalSummary(BaseModel):
    approval_id: str
    transaction_id: str
    agent_membership_id: str
    agent_name: str
    transaction_date: datetime
    reference: str
    transaction_type: str
    description: str
    debit: float
    credit: float
    status: str
    decision_comment: str
    created_at: datetime


class ApprovalCenterResponse(BaseModel):
    quotation_requests: list[QuotationRequestSummary]
    transactions: list[TransactionApprovalSummary]
