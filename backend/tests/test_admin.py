from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient) -> dict:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@solarerp.dev",
            "password": "ChangeMe123!",
            "company_code": "SHREE",
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
                "email": email,
                "password": "AgentPass123!",
                "role_codes": ["agent"],
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        user = created.json()
        assert user["roles"] == ["agent"]

        updated = client.patch(
            f"/api/v1/admin/users/{user['membership_id']}",
            json={"role_codes": ["accounts_admin"], "is_active": True},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["roles"] == ["accounts_admin"]

        reset = client.post(
            f"/api/v1/admin/users/{user['membership_id']}/reset-password",
            json={"new_password": "NewAgentPass123!"},
            headers=headers,
        )
        assert reset.status_code == 204

        user_login = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "NewAgentPass123!", "company_code": "SHREE"},
        )
        assert user_login.status_code == 200
        assert user_login.json()["roles"] == ["accounts_admin"]


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
        created_admin = client.post(
            "/api/v1/admin/users",
            json={
                "full_name": "Company Administrator",
                "email": company_admin_email,
                "password": "CompanyAdmin123!",
                "role_codes": ["company_admin"],
            },
            headers=headers,
        )
        assert created_admin.status_code == 201, created_admin.text

        company_admin_login = client.post(
            "/api/v1/auth/login",
            json={
                "email": company_admin_email,
                "password": "CompanyAdmin123!",
                "company_code": "SHREE",
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
                "email": "forbidden.super@solarerp.dev",
                "password": "Forbidden123!",
                "role_codes": ["super_admin"],
            },
            headers=company_admin_headers,
        )
        assert forbidden.status_code == 403

        delete_role_response = client.delete(
            f"/api/v1/admin/roles/{role['id']}",
            headers=headers,
        )
        assert delete_role_response.status_code == 204
