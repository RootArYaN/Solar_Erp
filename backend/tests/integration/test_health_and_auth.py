from __future__ import annotations

import pytest


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
