from __future__ import annotations

import pytest

from app.core.config import settings


@pytest.mark.integration
def test_request_body_limit_rejects_large_json(client):
    payload = b"x" * (settings.max_request_body_bytes + 1)
    response = client.post(
        "/api/v1/auth/login",
        content=payload,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["code"] == "request_too_large"


@pytest.mark.integration
def test_write_requires_csrf(admin_auth):
    response = admin_auth.client.post(
        "/api/v1/agents/invalid/transactions",
        headers={
            "Authorization": f"Bearer {admin_auth.access_token}",
            "Idempotency-Key": "pytest-missing-csrf",
        },
        json={
            "transaction_type": "expense",
            "description": "CSRF test",
            "debit": 100,
            "credit": 0,
        },
    )
    assert response.status_code == 403
    assert response.json()["code"] == "csrf_rejected"
