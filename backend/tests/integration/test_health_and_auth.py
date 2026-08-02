from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.db.seed import bootstrap_super_admin, ensure_identity_defaults
from app.db.session import SessionLocal
from app.models.auth import Company, Permission, Role


@pytest.mark.integration
def test_health_and_readiness(client):
    health = client.get("/api/v1/health")
    ready = client.get("/api/v1/ready")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"


@pytest.mark.integration
def test_authenticated_session(admin_auth):
    response = admin_auth.client.get("/api/v1/auth/me", headers=admin_auth.read_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["membership_id"] == admin_auth.membership_id
    assert body["user"]["is_super_admin"] is True
    assert "dashboard.view" in body["permissions"]


@pytest.mark.integration
def test_builtin_roles_and_permissions_are_available(admin_auth):
    headers = admin_auth.read_headers
    roles_response = admin_auth.client.get("/api/v1/admin/roles", headers=headers)
    permissions_response = admin_auth.client.get("/api/v1/admin/permissions", headers=headers)

    assert roles_response.status_code == 200, roles_response.text
    assert permissions_response.status_code == 200, permissions_response.text

    roles = {role["code"]: role for role in roles_response.json()}
    permissions = {permission["code"] for permission in permissions_response.json()}
    assert {"customer", "agent", "accounts_admin", "company_admin", "super_admin"} <= set(roles)
    assert {"dashboard.view", "users.manage", "roles.manage", "finance.manage"} <= permissions
    assert set(roles["super_admin"]["permissions"]) == permissions


@pytest.mark.integration
def test_identity_initializer_only_adds_missing_data(prepared_database):
    with SessionLocal() as db:
        company = db.scalar(select(Company).where(Company.code == settings.seed_company_code))
        customer_role = db.scalar(
            select(Role).where(Role.company_id == company.id, Role.code == "customer")
        )
        extra_permission = db.scalar(
            select(Permission).where(Permission.code == "users.manage")
        )
        assert company and customer_role and extra_permission

        customer_role.name = "Customized Customer Role"
        customer_role.description = "Keep this administrator customization"
        if extra_permission not in customer_role.permissions:
            customer_role.permissions.append(extra_permission)
        db.flush()

        ensure_identity_defaults(db, company)
        ensure_identity_defaults(db, company)

        assert customer_role.name == "Customized Customer Role"
        assert customer_role.description == "Keep this administrator customization"
        assert extra_permission in customer_role.permissions
        assert {"dashboard.view", "projects.view", "documents.view"} <= {
            permission.code for permission in customer_role.permissions
        }
        db.rollback()


@pytest.mark.integration
def test_bootstrap_rejects_username_email_cross_user_clash(prepared_database, monkeypatch):
    monkeypatch.setattr(settings, "seed_admin_username", "admin")
    monkeypatch.setattr(settings, "seed_admin_email", "agent@solarerp.dev")

    with SessionLocal() as db:
        with pytest.raises(RuntimeError, match="belong to different existing users"):
            bootstrap_super_admin(db)
