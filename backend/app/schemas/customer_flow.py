from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator, model_validator


class FlowAddress(BaseModel):
    id: str
    label: str
    line_1: str
    line_2: str = ""
    city: str = ""
    district: str = ""
    state: str = ""
    postal_code: str = ""
    country_code: str = "IN"
    is_primary: bool = True


class FlowContact(BaseModel):
    id: str
    full_name: str
    designation: str = ""
    email: str = ""
    phone: str = ""
    alternate_phone: str = ""
    is_primary: bool = True


class FlowEntity(BaseModel):
    id: str
    record_number: str
    version: int = 1
    created_at: datetime
    updated_at: datetime


class FlowCustomer(FlowEntity):
    display_name: str
    legal_name: str
    customer_type: str
    status: str
    primary_contact_id: str | None
    contacts: list[FlowContact] = Field(default_factory=list)
    addresses: list[FlowAddress] = Field(default_factory=list)
    assigned_agent_id: str | None
    alternate_phone: str = ""
    billing_address: str = ""
    site_address: str = ""
    district: str = ""
    state: str = ""
    postal_code: str = ""
    consumer_number: str = ""
    electricity_provider: str = ""
    lead_source: str = ""
    payment_mode: str = ""
    outstanding_balance: str = "0.00"


class FlowSite(FlowEntity):
    customer_id: str
    name: str
    address: FlowAddress
    consumer_number: str = ""
    meter_type: str = "unknown"
    sanctioned_load_kw: str = "0.00"
    proposed_capacity_kw: str = "0.00"
    status: str
    survey_scheduled_at: datetime | None = None


class FlowQuotationLine(BaseModel):
    id: str
    description: str
    quantity: str
    unit: str
    unit_price: str
    tax_rate: str
    line_total: str


class FlowQuotationApproval(BaseModel):
    id: str
    decision: str
    decided_by: str
    decided_at: datetime
    comment: str


class FlowQuotationRevision(FlowEntity):
    quotation_id: str
    revision_number: int = 1
    status: str
    valid_until: datetime | None = None
    subtotal: str
    tax_total: str
    grand_total: str
    notes: str = ""
    approval: FlowQuotationApproval | None = None
    lines: list[FlowQuotationLine] = Field(default_factory=list)


class FlowQuotation(FlowEntity):
    customer_id: str
    site_id: str
    title: str
    current_revision_id: str
    revisions: list[FlowQuotationRevision] = Field(default_factory=list)


class FlowProject(FlowEntity):
    customer_id: str
    site_id: str
    quotation_id: str
    name: str
    status: str
    capacity_kw: str
    approved_value: str
    planned_start_date: date | None = None
    target_completion_date: date | None = None
    project_manager_id: str | None = None
    site_address: str = ""
    payment_mode: str = ""
    loan_status: str = "not_required"
    documentation_status: str = "pending"
    registration_status: str = "pending"
    material_status: str = "pending"
    installation_status: str = "pending"
    dcr_status: str = "pending"
    subsidy_status: str = "pending"
    subsidiary_payment_status: str = "pending"


class FlowMaterialLine(BaseModel):
    id: str
    item_id: str | None = None
    description: str = Field(min_length=2, max_length=240)
    requested_quantity: str
    unit: str = Field(min_length=1, max_length=24)
    required_by: date | None = None
    note: str = Field(default="", max_length=400)

    @field_validator("description", "unit", "note")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.split())

    @field_validator("requested_quantity")
    @classmethod
    def valid_quantity(cls, value: str) -> str:
        try:
            quantity = float(value)
        except ValueError as exc:
            raise ValueError("Enter a valid quantity") from exc
        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero")
        return f"{quantity:.2f}"


class FlowMaterialRequest(FlowEntity):
    project_id: str
    status: str
    requested_by: str
    needed_at_site_by: date | None = None
    purpose: str
    lines: list[FlowMaterialLine] = Field(default_factory=list)


class SaveMaterialDraftRequest(BaseModel):
    purpose: str = Field(min_length=3, max_length=240)
    needed_at_site_by: date | None = None
    lines: list[FlowMaterialLine] = Field(min_length=1, max_length=200)

    @field_validator("purpose")
    @classmethod
    def clean_purpose(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def align_required_dates(self):
        if self.needed_at_site_by:
            for line in self.lines:
                if line.required_by is None:
                    line.required_by = self.needed_at_site_by
        return self



class FlowDocument(BaseModel):
    id: str
    name: str
    owner_type: str
    project_id: str | None = None
    created_at: datetime


class FlowPayment(BaseModel):
    id: str
    transaction_number: str
    transaction_date: date
    direction: str
    amount: str
    account_id: str
    category_id: str | None
    source_type: str
    description: str
    payment_method: str
    account_name: str
    reference_number: str
    status: str


class FlowLoan(BaseModel):
    id: str
    project_id: str
    bank_name: str
    application_number: str
    requested_amount: str
    approved_amount: str
    customer_contribution: str
    application_status: str
    documentation_status: str
    first_disbursement_amount: str
    second_disbursement_amount: str
    emi_amount: str
    loan_status: str
    note: str


class FlowActivity(BaseModel):
    id: str
    event: str
    entity: str
    project_id: str | None = None
    changes: dict[str, object] = Field(default_factory=dict)
    user_role: str
    created_at: datetime


class FlowTimelineStep(BaseModel):
    key: str
    name: str
    status: str
    event_date: date | None = None
    completed_at: datetime | None = None
    note: str = ""
    updated_by: str = ""


class UpdateCustomerRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    phone: str = Field(min_length=7, max_length=32)
    alternate_phone: str = Field(default="", max_length=32)
    email: str = Field(default="", max_length=320)
    billing_address: str = Field(default="", max_length=320)
    site_address: str = Field(default="", max_length=320)
    district: str = Field(default="", max_length=80)
    state: str = Field(default="Gujarat", max_length=80)
    postal_code: str = Field(default="", max_length=16)
    consumer_number: str = Field(default="", max_length=80)
    electricity_provider: str = Field(default="", max_length=100)
    customer_type: str = Field(default="residential", pattern=r"^(residential|commercial|society|institutional)$")
    lead_source: str = Field(default="", max_length=80)
    status: str = Field(default="active", max_length=32)

    @field_validator("full_name", "phone", "alternate_phone", "email", "billing_address", "site_address", "district", "state", "postal_code", "consumer_number", "electricity_provider", "lead_source", "status")
    @classmethod
    def clean_customer(cls, value: str) -> str:
        return " ".join(value.split())


class CustomerFlowSnapshot(BaseModel):
    customer: FlowCustomer
    sites: list[FlowSite] = Field(default_factory=list)
    quotations: list[FlowQuotation] = Field(default_factory=list)
    projects: list[FlowProject] = Field(default_factory=list)
    project: FlowProject | None = None
    material_request: FlowMaterialRequest | None = None
    timeline: list[FlowTimelineStep] = Field(default_factory=list)
    documents: list[FlowDocument] = Field(default_factory=list)
    payments: list[FlowPayment] = Field(default_factory=list)
    loan: FlowLoan | None = None
    activity: list[FlowActivity] = Field(default_factory=list)


class CustomerFlowList(BaseModel):
    items: list[FlowCustomer]
    next_cursor: str | None = None
    sync_cursor: str
