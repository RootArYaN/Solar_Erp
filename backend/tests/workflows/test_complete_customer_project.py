from __future__ import annotations

from datetime import date
from uuid import uuid4

import pytest


@pytest.mark.workflow
def test_complete_customer_to_project_workflow(admin_auth):
    client = admin_auth.client
    agents = client.get("/api/v1/agents", headers=admin_auth.read_headers)
    assert agents.status_code == 200, agents.text
    assert agents.json()
    agent_membership_id = agents.json()[0]["membership_id"]

    suffix = uuid4().hex[:10]
    customer_email = f"workflow.{suffix}@example.com"
    customer_phone = f"+91 7{int(suffix, 16) % 1_000_000_000:09d}"
    customer_response = client.post(
        f"/api/v1/agents/{agent_membership_id}/customers",
        headers=admin_auth.write_headers(),
        json={
            "customer_name": f"Workflow Customer {suffix}",
            "email": customer_email,
            "phone": customer_phone,
            "address": "Workflow Address, Surat",
            "billing_address": "Workflow Billing Address, Surat",
            "site_address": "Workflow Site, Surat",
            "district": "Surat",
            "state": "Gujarat",
            "postal_code": "395007",
            "consumer_number": f"DGVCL-{suffix}",
            "electricity_provider": "DGVCL",
            "customer_type": "residential",
            "lead_source": "Phase 2 integration test",
            "project_name": "5 kW Rooftop Solar",
        },
    )
    assert customer_response.status_code == 201, customer_response.text
    customer = next(row for row in customer_response.json()["customers"] if row["email"] == customer_email)
    customer_id = customer["id"]

    quotation_request = client.post(
        f"/api/v1/workflow/customers/{customer_id}/quotation-requests",
        headers=admin_auth.write_headers(),
        json={
            "requirement_summary": "5 kW rooftop solar installation",
            "proposed_capacity_kw": 5,
            "site_address": "Workflow Site, Surat",
            "notes": "Created by complete workflow test",
        },
    )
    assert quotation_request.status_code == 201, quotation_request.text
    request_id = quotation_request.json()["id"]

    quotation = client.post(
        f"/api/v1/workflow/quotation-requests/{request_id}/quotation",
        headers=admin_auth.write_headers(),
        json={
            "title": "5 kW Residential Solar EPC",
            "lines": [
                {
                    "description": "Solar EPC system",
                    "quantity": 5,
                    "unit": "kW",
                    "unit_price": 50000,
                    "tax_rate": 5,
                }
            ],
        },
    )
    assert quotation.status_code == 200, quotation.text
    quotation_id = quotation.json()["quotation"]["id"]

    approved = client.post(
        f"/api/v1/workflow/quotations/{quotation_id}/decision",
        headers=admin_auth.write_headers(),
        json={"decision": "approved", "comment": "Approved by workflow integration test"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["project_status"] == "planning"

    timelines = client.get("/api/v1/workflow/projects/timelines", headers=admin_auth.read_headers)
    assert timelines.status_code == 200, timelines.text
    project = next(row for row in timelines.json() if row["customer_id"] == customer_id)
    project_id = project["project_id"]

    upload = client.post(
        "/api/v1/files",
        headers=admin_auth.write_headers(),
        data={
            "owner_type": "customer_document:electricity_bill",
            "owner_id": customer_id,
            "project_id": project_id,
            "customer_id": customer_id,
        },
        files={"upload": ("electricity_bill.txt", b"phase 2 workflow fixture", "text/plain")},
    )
    assert upload.status_code == 201, upload.text
    assert upload.json()["customer_id"] == customer_id

    for _step_attempt in range(20):
        timeline = client.get(
            f"/api/v1/workflow/projects/{project_id}/timeline",
            headers=admin_auth.read_headers,
        )
        assert timeline.status_code == 200, timeline.text
        body = timeline.json()
        if body["progress"] == 100:
            break
        current_step = body["current_step"]
        if current_step == "payment_mode":
            response = client.patch(
                f"/api/v1/workflow/projects/{project_id}/payment-mode",
                headers=admin_auth.write_headers(),
                json={"payment_mode": "cash"},
            )
        else:
            response = client.patch(
                f"/api/v1/workflow/projects/{project_id}/timeline/{current_step}",
                headers=admin_auth.write_headers(),
                json={
                    "action": "complete",
                    "note": f"Completed {current_step} in Phase 2 workflow test",
                    "event_date": date.today().isoformat(),
                },
            )
        assert response.status_code == 200, response.text

    else:
        pytest.fail("Project timeline did not complete within 20 transitions")

    assert body["project_status"] == "completed"
    assert body["progress"] == 100
