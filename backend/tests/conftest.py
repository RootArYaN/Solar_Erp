from __future__ import annotations

import os
import sys
from pathlib import Path
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

TEST_DATABASE_URL = os.getenv(
    "SOLAR_TEST_DATABASE_URL",
    "postgresql+psycopg://solar_erp:solar_erp_test_password@127.0.0.1:5433/solar_erp_test",
)
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("DATABASE_SSLMODE", "disable")
os.environ.setdefault("JWT_SECRET", "local-phase2-test-secret-change-me-1234567890")
os.environ.setdefault("CSRF_ENABLED", "true")
os.environ.setdefault("TRUSTED_HOSTS", "127.0.0.1,localhost,testserver")
os.environ.setdefault("FRONTEND_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
os.environ.setdefault("RATE_LIMIT_LOGIN_PER_MINUTE", "500")
os.environ.setdefault("LOGIN_LIMIT", "500")
os.environ["STORAGE_TYPE"] = "local"
os.environ["STORAGE_PATH"] = "./storage-test"

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.db.migrate import run_migrations  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from scripts.demo_seed import seed_demo_data  # noqa: E402


@dataclass
class AuthContext:
    client: TestClient
    access_token: str
    csrf_token: str
    membership_id: str

    @property
    def read_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def write_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            settings.csrf_header_name: self.csrf_token,
            "Idempotency-Key": f"pytest-{uuid4().hex}",
        }


def _assert_test_database() -> None:
    name = (make_url(TEST_DATABASE_URL).database or "").lower()
    if not any(token in name for token in ("test", "perf")):
        raise RuntimeError("Tests require a database name containing 'test' or 'perf'")


@pytest.fixture(scope="session")
def prepared_database() -> None:
    _assert_test_database()
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        pytest.skip(f"PostgreSQL performance database is unavailable: {exc}")

    run_migrations()
    with SessionLocal() as db:
        seed_demo_data(db)
    yield
    engine.dispose()


@pytest.fixture()
def client(prepared_database: None):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def admin_auth(client: TestClient) -> AuthContext:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": settings.seed_admin_username,
            "password": settings.seed_admin_password,
            "remember": False,
        },
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    csrf_token = response.headers.get(settings.csrf_header_name)
    assert csrf_token
    return AuthContext(
        client=client,
        access_token=str(body["access_token"]),
        csrf_token=csrf_token,
        membership_id=str(body["membership_id"]),
    )
