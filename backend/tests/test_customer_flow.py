from fastapi.testclient import TestClient

from app.main import app


def _admin_session(client: TestClient) -> tuple[dict, dict[str, str]]:
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "ChangeMe123!"},
    )
    assert response.status_code == 200, response.text
    session = response.json()
    return session, {"Authorization": f"Bearer {session['access_token']}"}


def test_customer_quotation_project_and_material_draft_are_linked() -> None:
    with TestClient(app) as client:
        _, headers = _admin_session(client)
        agents = client.get("/api/v1/agents", headers=headers)
        assert agents.status_code == 200, agents.text
        membership_id = agents.json()[0]["membership_id"]

        created_customer = client.post(
            f"/api/v1/agents/{membership_id}/customers",
            headers=headers,
            json={
                "customer_name": "Linked Workflow Customer",
                "company_name": "Linked Workflow Private Limited",
                "email": "linked-workflow@example.com",
                "phone": "+91 90000 44444",
                "address": "Vesu, Surat",
                "project_name": "12 kW linked rooftop project",
            },
        )
        assert created_customer.status_code == 201, created_customer.text
        customer = next(
            item for item in created_customer.json()["customers"]
            if item["email"] == "linked-workflow@example.com"
        )

        quotation_request = client.post(
            f"/api/v1/workflow/customers/{customer['id']}/quotation-requests",
            headers=headers,
            json={
                "requirement_summary": "12 kW rooftop solar EPC",
                "proposed_capacity_kw": 12,
                "site_address": "Vesu, Surat",
                "notes": "End-to-end linkage test",
            },
        )
        assert quotation_request.status_code == 201, quotation_request.text
        request_id = quotation_request.json()["id"]

        generated = client.post(
            f"/api/v1/workflow/quotation-requests/{request_id}/quotation",
            headers=headers,
            json={
                "title": "12 kW rooftop solar EPC",
                "lines": [{
                    "description": "Solar EPC package",
                    "quantity": 1,
                    "unit": "Lot",
                    "unit_price": 600000,
                    "tax_rate": 5,
                }],
            },
        )
        assert generated.status_code == 200, generated.text
        quotation_id = generated.json()["quotation"]["id"]

        before_approval = client.get(
            f"/api/v1/customer-flow/customers/{customer['id']}",
            headers=headers,
        )
        assert before_approval.status_code == 200, before_approval.text
        assert before_approval.json()["quotations"][0]["revisions"][0]["status"] == "submitted"
        assert before_approval.json()["project"] is None

        approved = client.post(
            f"/api/v1/workflow/quotations/{quotation_id}/decision",
            headers=headers,
            json={"decision": "approved", "comment": "Approved for linked project"},
        )
        assert approved.status_code == 200, approved.text

        after_approval = client.get(
            f"/api/v1/customer-flow/customers/{customer['id']}",
            headers=headers,
        )
        assert after_approval.status_code == 200, after_approval.text
        project = after_approval.json()["project"]
        assert project is not None
        assert project["quotation_id"] == quotation_id
        assert project["customer_id"] == customer["id"]

        draft = client.put(
            f"/api/v1/customer-flow/customers/{customer['id']}/material-request",
            headers=headers,
            json={
                "purpose": "Initial project allocation",
                "needed_at_site_by": "2026-08-20",
                "lines": [{
                    "id": "line-1",
                    "item_id": None,
                    "description": "Solar modules",
                    "requested_quantity": "24",
                    "unit": "Nos",
                    "required_by": None,
                    "note": "",
                }],
            },
        )
        assert draft.status_code == 200, draft.text
        material_request = draft.json()["material_request"]
        assert material_request["project_id"] == project["id"]
        assert material_request["status"] == "draft"
        assert material_request["lines"][0]["required_by"] == "2026-08-20"
