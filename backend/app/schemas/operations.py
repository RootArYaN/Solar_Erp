from __future__ import annotations

from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator, model_validator


class InventoryLocationSummary(BaseModel):
    id: str
    version: int = 1
    name: str
    location_type: str
    address: str
    is_active: bool


class InventoryItemSummary(BaseModel):
    id: str
    version: int = 1
    sku: str
    name: str
    category: str
    unit: str
    supplier_name: str
    unit_cost: float
    reorder_level: float
    quantity_on_hand: float
    reserved_quantity: float
    available_quantity: float
    location_id: str | None
    location_name: str
    low_stock: bool
    is_active: bool
    updated_at: datetime


class InventoryMovementSummary(BaseModel):
    id: str
    item_id: str
    item_name: str
    movement_type: str
    quantity: float
    source_location_id: str | None
    source_location_name: str
    source_location_manual: str = ''
    destination_location_id: str | None
    destination_location_name: str
    destination_location_manual: str = ''
    project_id: str | None
    project_number: str
    customer_id: str | None
    customer_name: str
    reference_number: str
    movement_group_id: str | None = None
    challan_date: date | None = None
    partner_name: str
    transporter_name: str = ''
    vehicle_number: str = ''
    driver_name: str = ''
    driver_phone: str = ''
    eway_bill_number: str = ''
    note: str
    status: str
    created_at: datetime


class InventorySummary(BaseModel):
    items: list[InventoryItemSummary]
    locations: list[InventoryLocationSummary]
    movements: list[InventoryMovementSummary]
    total_items: int
    low_stock_items: int
    stock_value: float
    total_quantity: float


class CreateInventoryItemRequest(BaseModel):
    sku: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=2, max_length=180)
    category: str = Field(default='General', max_length=80)
    unit: str = Field(default='Nos', max_length=24)
    supplier_name: str = Field(default='', max_length=160)
    unit_cost: float = Field(default=0, ge=0)
    reorder_level: float = Field(default=0, ge=0)
    location_id: str
    opening_quantity: float = Field(default=0, ge=0)

    @field_validator('sku', 'name', 'category', 'unit', 'supplier_name')
    @classmethod
    def clean(cls, value: str) -> str:
        return ' '.join(value.split())


class CreateInventoryLocationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    location_type: str = Field(default='warehouse', max_length=32)
    address: str = Field(default='', max_length=320)




class UpdateInventoryItemRequest(BaseModel):
    version: int = Field(ge=1)
    sku: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=2, max_length=180)
    category: str = Field(default='General', max_length=80)
    unit: str = Field(default='Nos', max_length=24)
    supplier_name: str = Field(default='', max_length=160)
    unit_cost: float = Field(default=0, ge=0)
    reorder_level: float = Field(default=0, ge=0)
    is_active: bool = True

    @field_validator('sku', 'name', 'category', 'unit', 'supplier_name')
    @classmethod
    def clean(cls, value: str) -> str:
        return ' '.join(value.split())


class UpdateInventoryLocationRequest(BaseModel):
    version: int = Field(ge=1)
    name: str = Field(min_length=2, max_length=120)
    location_type: str = Field(default='warehouse', max_length=32)
    address: str = Field(default='', max_length=320)
    is_active: bool = True


class UpdatePosterRequest(BaseModel):
    version: int = Field(ge=1)
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default='', max_length=400)
    category: str = Field(default='General', max_length=80)


class CreateInventoryMovementRequest(BaseModel):
    item_id: str
    movement_type: str = Field(pattern=r'^(inward|outward|transfer|adjustment|project_dispatch|project_return|supplier_return)$')
    quantity: float = Field(gt=0)
    source_location_id: str | None = None
    destination_location_id: str | None = None
    source_location_manual: str = Field(default='', max_length=180)
    destination_location_manual: str = Field(default='', max_length=180)
    project_id: str | None = None
    customer_id: str | None = None
    challan_id: str | None = None
    reference_number: str = Field(default='', max_length=80)
    challan_date: date | None = None
    supplier_name: str = Field(default='', max_length=160)
    transporter_name: str = Field(default='', max_length=160)
    vehicle_number: str = Field(default='', max_length=32)
    driver_name: str = Field(default='', max_length=120)
    driver_phone: str = Field(default='', max_length=32)
    eway_bill_number: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=400)

    @model_validator(mode='after')
    def validate_locations(self):
        if self.movement_type in {'outward', 'project_dispatch', 'supplier_return'} and not self.source_location_id:
            raise ValueError('A source location is required')
        if self.movement_type in {'inward', 'project_return'} and not self.destination_location_id:
            raise ValueError('A destination location is required')
        if self.movement_type == 'transfer':
            if not self.source_location_id or not self.destination_location_id:
                raise ValueError('Source and destination locations are required')
            if self.source_location_id == self.destination_location_id:
                raise ValueError('Source and destination locations must be different')
        if self.movement_type == 'adjustment' and not (self.source_location_id or self.destination_location_id):
            raise ValueError('A location is required for adjustment')
        return self


class InventoryMovementLineInput(BaseModel):
    item_id: str
    quantity: float = Field(gt=0)
    source_location_id: str | None = None
    destination_location_id: str | None = None
    source_location_manual: str = Field(default='', max_length=180)
    destination_location_manual: str = Field(default='', max_length=180)


class CreateInventoryMovementBatchRequest(BaseModel):
    movement_type: str = Field(pattern=r'^(inward|outward)$')
    lines: list[InventoryMovementLineInput] = Field(min_length=1, max_length=100)
    reference_number: str = Field(default='', max_length=80)
    challan_date: date | None = None
    supplier_name: str = Field(default='', max_length=160)
    transporter_name: str = Field(default='', max_length=160)
    vehicle_number: str = Field(default='', max_length=32)
    driver_name: str = Field(default='', max_length=120)
    driver_phone: str = Field(default='', max_length=32)
    eway_bill_number: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=400)

    @model_validator(mode='after')
    def validate_lines(self):
        for index, line in enumerate(self.lines, start=1):
            if self.movement_type == 'inward' and not line.destination_location_id:
                raise ValueError(f'Line {index}: a saved inward destination is required')
            if self.movement_type == 'outward' and not line.source_location_id:
                raise ValueError(f'Line {index}: a saved outward source is required')
            if line.source_location_id and line.source_location_manual:
                raise ValueError(f'Line {index}: choose a saved or manual source, not both')
            if line.destination_location_id and line.destination_location_manual:
                raise ValueError(f'Line {index}: choose a saved or manual destination, not both')
        return self


class PricingItemInput(BaseModel):
    id: str | None = None
    inventory_item_id: str | None = None
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(default='General', max_length=80)
    unit: str = Field(default='Nos', max_length=24)
    price: float = Field(default=0, ge=0)
    quantity: float = Field(default=1, ge=0)
    tax_rate: float = Field(default=0, ge=0, le=100)
    calculation_type: str = Field(default='quantity', max_length=32)
    calculation_value: float = Field(default=1, ge=0)
    display_order: int = Field(default=0, ge=0)
    is_active: bool = True


class PricingBookSummary(BaseModel):
    id: str
    name: str
    version: int
    is_default: bool
    is_active: bool
    updated_at: datetime
    items: list[PricingItemInput]


class SavePricingBookRequest(BaseModel):
    name: str = Field(default='Master Price List', min_length=2, max_length=120)
    items: list[PricingItemInput] = Field(default_factory=list, max_length=300)


class PosterSummary(BaseModel):
    id: str
    version: int = 1
    title: str
    description: str
    file_id: str
    file_name: str
    mime_type: str
    category: str
    status: str
    created_at: datetime
    updated_at: datetime


class CreatePosterRequest(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    description: str = Field(default='', max_length=400)
    file_id: str
    category: str = Field(default='General', max_length=80)


class PosterStatusRequest(BaseModel):
    status: str = Field(pattern=r'^(draft|active)$')


class DocumentTemplateSummary(BaseModel):
    id: str
    template_type: str
    name: str
    settings: dict[str, object]
    is_active: bool
    updated_at: datetime


class SaveDocumentTemplateRequest(BaseModel):
    name: str = Field(default='Company Document Template', min_length=2, max_length=120)
    settings: dict[str, object] = Field(default_factory=dict)


class GeneratedDocumentPackSummary(BaseModel):
    id: str
    customer_id: str
    project_id: str
    quotation_id: str
    version: int
    status: str
    input_snapshot: dict[str, object]
    template_snapshot: dict[str, object]
    generated_at: datetime | None
    finalized_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SaveGeneratedDocumentPackRequest(BaseModel):
    input_snapshot: dict[str, object] = Field(default_factory=dict)
    status: str = Field(default='draft', pattern=r'^(draft|generated)$')
