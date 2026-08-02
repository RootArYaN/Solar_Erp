from pathlib import Path
import sys

import pytest

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from deploy.validate_hostinger_env import load_env, validate


def valid_environment() -> dict[str, str]:
    return {
        "ERP_DOMAIN": "erp.perfectsolar.online",
        "POSTGRES_PASSWORD": "a" * 64,
        "JWT_SECRET": "b" * 64,
        "ENVIRONMENT": "production",
        "SESSION_COOKIE_SECURE": "true",
        "CSRF_ENABLED": "true",
        "TRUST_PROXY_HEADERS": "true",
        "RATE_LIMIT_MODE": "local",
        "SINGLE_INSTANCE_DEPLOYMENT": "true",
        "WEB_CONCURRENCY": "1",
        "STORAGE_TYPE": "local",
        "STORAGE_PATH": "/app/storage",
        "STORAGE_TEMP_PATH": "/tmp/solar-erp",
        "ALLOW_LOCAL_STORAGE_PRODUCTION": "true",
        "REQUIRE_MALWARE_SCAN": "true",
        "MAX_REQUEST_BODY_MB": "2",
        "MAX_UPLOAD_MB": "20",
        "MALWARE_SCAN_TIMEOUT_SECONDS": "60",
        "DB_POOL_SIZE": "3",
        "DB_MAX_OVERFLOW": "2",
        "MAX_CONCURRENT_REQUESTS": "5",
        "SEED_ADMIN_EMAIL": "admin@perfectsolar.online",
        "SEED_ADMIN_PASSWORD": "a-strong-first-password",
    }


def test_valid_hostinger_environment():
    assert validate(valid_environment(), require_bootstrap_password=True) == []


def test_hostinger_environment_rejects_placeholders_and_provider_clashes():
    values = valid_environment()
    values.update({
        "ERP_DOMAIN": "erp.example.com",
        "JWT_SECRET": values["POSTGRES_PASSWORD"],
        "SEED_ADMIN_EMAIL": "admin@example.com",
        "S3_BUCKET": "old-remote-bucket",
    })
    errors = validate(values, require_bootstrap_password=True)
    assert any("ERP_DOMAIN" in error for error in errors)
    assert any("must be different" in error for error in errors)
    assert any("SEED_ADMIN_EMAIL" in error for error in errors)
    assert any("S3_BUCKET" in error for error in errors)


def test_hostinger_environment_allows_removed_bootstrap_password_after_install():
    values = valid_environment()
    values.pop("SEED_ADMIN_PASSWORD")
    assert validate(values, require_bootstrap_password=False) == []
    assert any(
        "SEED_ADMIN_PASSWORD" in error
        for error in validate(values, require_bootstrap_password=True)
    )


def test_environment_loader_rejects_duplicates(tmp_path: Path):
    path = tmp_path / ".env.hostinger"
    path.write_text("ERP_DOMAIN=erp.example.test\nERP_DOMAIN=duplicate.example.test\n")
    with pytest.raises(ValueError, match="duplicates ERP_DOMAIN"):
        load_env(path)


def test_hostinger_runtime_contracts_are_pinned():
    compose = (REPOSITORY_ROOT / "compose.hostinger.yml").read_text()
    nginx = (REPOSITORY_ROOT / "frontend/nginx.conf").read_text()
    healthcheck = (REPOSITORY_ROOT / "backend/scripts/container_healthcheck.py").read_text()

    assert 'TRUST_PROXY_HEADERS: "true"' in compose
    assert "condition: service_healthy" in compose
    assert "document-storage:/app/storage" in compose
    assert "ports:" not in compose
    assert "client_max_body_size 21m;" in nginx
    assert "/api/v1/ready" in healthcheck


def test_obsolete_provider_deployment_files_are_absent():
    for relative in (
        "render.yaml",
        "compose.production.yml",
        "deploy/RENDER_CLOUDFLARE.md",
        "frontend/wrangler.jsonc",
    ):
        assert not (REPOSITORY_ROOT / relative).exists()
