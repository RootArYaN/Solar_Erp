from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient) -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": "admin",
            "password": "ChangeMe123!",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_seeded_roles_and_user_lifecycle() -> None:
    with TestClient(app) as client:
        session = login(client)
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        roles = client.get("/api/v1/admin/roles", headers=headers)
        assert roles.status_code == 200
        assert {role["code"] for role in roles.json()} >= {
            "customer",
            "agent",
            "accounts_admin",
            "company_admin",
            "super_admin",
        }

        email = "agent.user@solarerp.dev"
        username = "agent.user"
        existing = client.get("/api/v1/admin/users", params={"q": email}, headers=headers)
        for user in existing.json():
            if user["email"] == email:
                client.patch(
                    f"/api/v1/admin/users/{user['membership_id']}",
                    json={"is_active": False},
                    headers=headers,
                )
                return

        created = client.post(
            "/api/v1/admin/users",
            json={
                "full_name": "Agent User",
                "username": username,
                "email": email,
                "password": "AgentPass123!",
                "role_code": "agent",
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        user = created.json()
        assert user["role"] == "agent"

        agent_overview = client.get(
            f"/api/v1/agents/{user['membership_id']}/overview",
            headers=headers,
        )
        assert agent_overview.status_code == 200
        assert agent_overview.json()["customer_count"] == 0

        updated = client.patch(
            f"/api/v1/admin/users/{user['membership_id']}",
            json={"role_code": "accounts_admin", "is_active": True},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["role"] == "accounts_admin"

        reset = client.post(
            f"/api/v1/admin/users/{user['membership_id']}/reset-password",
            json={"new_password": "NewAgentPass123!"},
            headers=headers,
        )
        assert reset.status_code == 204

        user_login = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": "NewAgentPass123!"},
        )
        assert user_login.status_code == 200
        assert user_login.json()["role"] == "accounts_admin"

        accounts_headers = {"Authorization": f"Bearer {user_login.json()['access_token']}"}
        visible_agents = client.get("/api/v1/agents", headers=accounts_headers)
        assert visible_agents.status_code == 200
        assert any(agent["email"] == "agent@solarerp.dev" for agent in visible_agents.json())


def test_custom_role_and_super_admin_guard() -> None:
    with TestClient(app) as client:
        session = login(client)
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        created_role = client.post(
            "/api/v1/admin/roles",
            json={
                "name": "Warehouse Viewer",
                "code": "warehouse_viewer",
                "description": "Read-only warehouse access.",
                "permission_codes": ["dashboard.view", "inventory.view"],
            },
            headers=headers,
        )
        assert created_role.status_code == 201, created_role.text
        role = created_role.json()

        updated_role = client.patch(
            f"/api/v1/admin/roles/{role['id']}",
            json={
                "name": "Warehouse Viewer",
                "description": "Read-only warehouse and document access.",
                "permission_codes": [
                    "dashboard.view",
                    "inventory.view",
                    "documents.view",
                ],
            },
            headers=headers,
        )
        assert updated_role.status_code == 200
        assert "documents.view" in updated_role.json()["permissions"]

        company_admin_email = "company.admin@solarerp.dev"
        company_admin_username = "company.admin"
        created_admin = client.post(
            "/api/v1/admin/users",
            json={
                "full_name": "Company Administrator",
                "username": company_admin_username,
                "email": company_admin_email,
                "password": "CompanyAdmin123!",
                "role_code": "company_admin",
            },
            headers=headers,
        )
        assert created_admin.status_code == 201, created_admin.text

        company_admin_login = client.post(
            "/api/v1/auth/login",
            json={
                "username": company_admin_username,
                "password": "CompanyAdmin123!",
            },
        )
        assert company_admin_login.status_code == 200
        company_admin_headers = {
            "Authorization": f"Bearer {company_admin_login.json()['access_token']}"
        }

        forbidden = client.post(
            "/api/v1/admin/users",
            json={
                "full_name": "Forbidden Super Admin",
                "username": "forbidden.super",
                "email": "forbidden.super@solarerp.dev",
                "password": "Forbidden123!",
                "role_code": "super_admin",
            },
            headers=company_admin_headers,
        )
        assert forbidden.status_code == 403

        delete_role_response = client.delete(
            f"/api/v1/admin/roles/{role['id']}",
            headers=headers,
        )
        assert delete_role_response.status_code == 204
