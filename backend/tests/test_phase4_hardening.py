import re
import sys
import types
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

# OpenAPI and middleware tests do not need a live database driver.
fake_session = types.ModuleType("app.db.session")
fake_session.SessionLocal = lambda: None
fake_session.get_db = lambda: None
fake_session.engine = object()
sys.modules.setdefault("app.db.session", fake_session)

from app.core.config import Settings
from app.core.middleware import add_error_handlers, add_request_middleware
from app.core import rate_limit
from app.schemas.auth import LoginRequest
from app.schemas.admin import ResetPasswordRequest
from app.services import admin_service, auth_service
from app.services.auth_service import AuthenticationError


def _production_settings(**overrides):
    values = {
        "environment": "production",
        "jwt_secret": "s" * 64,
        "session_cookie_secure": True,
        "frontend_origins": "https://erp.example.com",
        "trusted_hosts": "api.example.com",
        "require_malware_scan": True,
        "malware_scan_command": "clamdscan --no-summary {path}",
        "database_sslmode": "require",
        "rate_limit_mode": "gateway",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _middleware_client() -> TestClient:
    app = FastAPI()
    add_request_middleware(app)
    add_error_handlers(app)

    @app.get("/api/v1/ping")
    def ping():
        return {"ok": True}

    return TestClient(app)


def test_production_cannot_disable_csrf():
    with pytest.raises(ValidationError, match="CSRF_ENABLED must be true"):
        _production_settings(csrf_enabled=False)


def test_request_id_accepts_safe_values_and_replaces_unsafe_values():
    client = _middleware_client()
    safe = "client-request_1234"
    response = client.get("/api/v1/ping", headers={"X-Request-ID": safe})
    assert response.headers["x-request-id"] == safe

    response = client.get("/api/v1/ping", headers={"X-Request-ID": "unsafe request id"})
    generated = response.headers["x-request-id"]
    assert generated != "unsafe request id"
    assert re.fullmatch(r"[0-9a-f-]{36}", generated)


def test_unknown_username_still_runs_argon2_verification(monkeypatch):
    seen: list[str] = []

    class MissingUserDb:
        def scalar(self, _statement):
            return None

    def fake_verify(_password: str, password_hash: str) -> bool:
        seen.append(password_hash)
        return False

    monkeypatch.setattr(auth_service, "verify_password", fake_verify)
    with pytest.raises(AuthenticationError, match="Invalid username or password"):
        auth_service.authenticate(
            MissingUserDb(),
            LoginRequest(username="missing-user", password="NotThePassword123!", remember=True),
            user_agent="pytest",
            ip_hint="127.0.0.*",
        )
    assert seen == [auth_service.DUMMY_PASSWORD_HASH]


def test_gateway_mode_does_not_retain_local_login_keys(monkeypatch):
    rate_limit._attempts.clear()
    monkeypatch.setattr(rate_limit.settings, "rate_limit_mode", "gateway")
    for index in range(100):
        rate_limit.check_login_limit(f"ip:user-{index}")
    assert not rate_limit._attempts


def test_local_login_key_cache_is_bounded(monkeypatch):
    rate_limit._attempts.clear()
    monkeypatch.setattr(rate_limit.settings, "rate_limit_mode", "local")
    monkeypatch.setattr(rate_limit.settings, "login_limit", 100)
    monkeypatch.setattr(rate_limit, "MAX_TRACKED_LOGIN_KEYS", 3)
    for index in range(10):
        rate_limit.check_login_limit(f"ip:user-{index}")
    assert len(rate_limit._attempts) <= 3
    rate_limit._attempts.clear()


def test_password_reset_revokes_all_sessions_for_target_user(monkeypatch):
    membership = SimpleNamespace(
        id="membership-a",
        company_id="company-a",
        user_id="user-a",
        user=SimpleNamespace(hashed_password="old"),
    )

    class FakeDb:
        def __init__(self):
            self.statements = []
            self.committed = False

        def execute(self, statement):
            self.statements.append(statement)

        def commit(self):
            self.committed = True

    db = FakeDb()
    actor = SimpleNamespace(membership=SimpleNamespace(company_id="company-a"))
    monkeypatch.setattr(admin_service, "_get_membership", lambda *_args: membership)
    monkeypatch.setattr(admin_service, "_assert_target_editable", lambda *_args: None)
    monkeypatch.setattr(admin_service, "hash_password", lambda _password: "new-hash")
    monkeypatch.setattr(admin_service, "write_event", lambda *_args, **_kwargs: None)

    admin_service.reset_user_password(
        db,
        actor,
        "membership-a",
        ResetPasswordRequest(new_password="A-new-password-123!"),
    )

    assert membership.user.hashed_password == "new-hash"
    assert db.committed
    assert len(db.statements) == 1
    statement = db.statements[0]
    assert statement.table.name == "auth_sessions"
    assert "auth_sessions.user_id" in str(statement)
    assert "auth_sessions.revoked_at IS NULL" in str(statement)
