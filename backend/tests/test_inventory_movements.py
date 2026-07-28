from datetime import date

import pytest
from pydantic import ValidationError

from app.schemas.operations import CreateInventoryMovementBatchRequest


def test_multiple_inward_lines_support_saved_and_manual_origins() -> None:
    payload = CreateInventoryMovementBatchRequest(
        movement_type="inward",
        reference_number="CH-101",
        challan_date=date(2026, 7, 28),
        vehicle_number="GJ 01 AB 1234",
        lines=[
            {
                "item_id": "panel",
                "quantity": 10,
                "destination_location_id": "main-warehouse",
                "source_location_manual": "Vendor yard, Ahmedabad",
            },
            {
                "item_id": "inverter",
                "quantity": 2,
                "source_location_id": "saved-vendor-store",
                "destination_location_id": "project-store",
            },
        ],
    )

    assert len(payload.lines) == 2
    assert payload.lines[0].source_location_manual == "Vendor yard, Ahmedabad"
    assert payload.vehicle_number == "GJ 01 AB 1234"


def test_multiple_outward_lines_require_a_saved_inventory_source() -> None:
    with pytest.raises(ValidationError, match="saved outward source is required"):
        CreateInventoryMovementBatchRequest(
            movement_type="outward",
            lines=[
                {
                    "item_id": "panel",
                    "quantity": 4,
                    "destination_location_manual": "Customer site",
                }
            ],
        )


def test_manual_and_saved_endpoint_cannot_be_combined() -> None:
    with pytest.raises(ValidationError, match="choose a saved or manual destination"):
        CreateInventoryMovementBatchRequest(
            movement_type="outward",
            lines=[
                {
                    "item_id": "panel",
                    "quantity": 4,
                    "source_location_id": "main-warehouse",
                    "destination_location_id": "saved-site",
                    "destination_location_manual": "Typed site",
                }
            ],
        )
