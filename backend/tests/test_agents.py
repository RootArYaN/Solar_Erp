from fastapi.testclient import TestClient

from app.main import app


def admin_login(client: TestClient) -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": "admin",
            "password": "ChangeMe123!",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_seeded_agent_overview_and_transaction_posting() -> None:
    with TestClient(app) as client:
        admin = admin_login(client)
        headers = {"Authorization": f"Bearer {admin['access_token']}"}

        agents = client.get("/api/v1/agents", headers=headers)
        assert agents.status_code == 200, agents.text
        seeded = next(agent for agent in agents.json() if agent["email"] == "agent@solarerp.dev")
        assert seeded["customer_count"] == 4
        assert seeded["current_balance"] == 43600.0

        overview = client.get(
            f"/api/v1/agents/{seeded['membership_id']}/overview",
            headers=headers,
        )
        assert overview.status_code == 200, overview.text
        payload = overview.json()
        assert payload["profile"]["phone"] == "+91 98765 43210"
        assert payload["customer_count"] == 4
        assert payload["commission_total"] == 40900.0
        assert payload["customer_outstanding"] == 1305000.0
        assert len(payload["transactions"]) == 5

        created = client.post(
            f"/api/v1/agents/{seeded['membership_id']}/transactions",
            json={
                "reference": "COM-TEST-001",
                "transaction_type": "commission",
                "description": "Test commission movement",
                "credit": 1400,
                "debit": 0,
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        assert created.json()["running_balance"] == 45000.0

        refreshed = client.get(
            f"/api/v1/agents/{seeded['membership_id']}/overview",
            headers=headers,
        )
        assert refreshed.status_code == 200, refreshed.text
        assert refreshed.json()["commission_total"] == 42300.0


def test_agent_can_view_and_update_only_own_profile() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/login",
            json={
                "username": "agent",
                "password": "AgentPass123!",
            },
        )
        assert response.status_code == 200, response.text
        session = response.json()
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        agents = client.get("/api/v1/agents", headers=headers)
        assert agents.status_code == 200
        assert len(agents.json()) == 1
        assert agents.json()[0]["membership_id"] == session["membership_id"]

        updated = client.patch(
            f"/api/v1/agents/{session['membership_id']}/profile",
            json={
                "phone": "+91 90000 00000",
                "alternate_phone": "",
                "address_line_1": "Agent House",
                "address_line_2": "Vesu",
                "city": "Surat",
                "state": "Gujarat",
                "postal_code": "395007",
            },
            headers=headers,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["profile"]["phone"] == "+91 90000 00000"

        forbidden = client.post(
            f"/api/v1/agents/{session['membership_id']}/transactions",
            json={
                "reference": "NOPE",
                "transaction_type": "commission",
                "description": "Should not post",
                "credit": 100,
                "debit": 0,
            },
            headers=headers,
        )
        assert forbidden.status_code == 403


def test_agent_customer_edit_is_once_but_admin_edits_are_unlimited() -> None:
    with TestClient(app) as client:
        agent_login = client.post(
            "/api/v1/auth/login",
            json={"username": "agent", "password": "AgentPass123!"},
        )
        assert agent_login.status_code == 200
        agent_session = agent_login.json()
        agent_headers = {"Authorization": f"Bearer {agent_session['access_token']}"}
        membership_id = agent_session["membership_id"]

        overview = client.get(f"/api/v1/agents/{membership_id}/overview", headers=agent_headers)
        assert overview.status_code == 200
        customer = overview.json()["customers"][0]
        assert customer["can_edit"] is True
        payload = {
            "customer_name": customer["customer_name"],
            "company_name": customer["company_name"],
            "email": customer["email"],
            "phone": customer["phone"],
            "address": "One-time agent correction",
            "project_name": customer["project_name"],
        }

        first_edit = client.patch(
            f"/api/v1/agents/{membership_id}/customers/{customer['id']}",
            json=payload,
            headers=agent_headers,
        )
        assert first_edit.status_code == 200, first_edit.text
        edited_customer = next(item for item in first_edit.json()["customers"] if item["id"] == customer["id"])
        assert edited_customer["address"] == "One-time agent correction"
        assert edited_customer["can_edit"] is False

        second_edit = client.patch(
            f"/api/v1/agents/{membership_id}/customers/{customer['id']}",
            json={**payload, "address": "Second agent correction"},
            headers=agent_headers,
        )
        assert second_edit.status_code == 409

        admin = admin_login(client)
        admin_headers = {"Authorization": f"Bearer {admin['access_token']}"}
        for address in ("Admin correction one", "Admin correction two"):
            admin_edit = client.patch(
                f"/api/v1/agents/{membership_id}/customers/{customer['id']}",
                json={**payload, "address": address},
                headers=admin_headers,
            )
            assert admin_edit.status_code == 200, admin_edit.text
            admin_customer = next(item for item in admin_edit.json()["customers"] if item["id"] == customer["id"])
            assert admin_customer["address"] == address
            assert admin_customer["can_edit"] is True
