import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _production_settings(**overrides):
    values = {
        "environment": "production",
        "jwt_secret": "s" * 64,
        "session_cookie_secure": True,
        "frontend_origins": "https://erp.example.com",
        "trusted_hosts": "api.example.com",
        "require_malware_scan": True,
        "malware_scan_command": "clamdscan --no-summary {path}",
        "database_sslmode": "verify-full",
        "rate_limit_mode": "gateway",
        "storage_type": "s3",
        "s3_bucket": "private-solar-erp-test",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_production_requires_gateway_rate_limiting():
    with pytest.raises(ValidationError, match="RATE_LIMIT_MODE must be gateway"):
        _production_settings(rate_limit_mode="local")


def test_production_security_configuration_is_accepted():
    configured = _production_settings()
    assert configured.is_production
    assert configured.rate_limit_mode == "gateway"
    assert configured.storage_type == "s3"


def test_render_single_instance_production_configuration_is_accepted():
    configured = _production_settings(
        render=True,
        render_external_hostname="shree-enterprise-api.onrender.com",
        database_url="postgresql://user:password@private-db/shree_enterprise",
        database_sslmode="disable",
        rate_limit_mode="local",
        web_concurrency=1,
    )
    assert configured.database_url.startswith("postgresql+psycopg://")
    assert "shree-enterprise-api.onrender.com" in configured.trusted_host_list


def test_render_local_rate_limiting_requires_one_worker():
    with pytest.raises(ValidationError, match="single-worker deployment"):
        _production_settings(
            render=True,
            database_sslmode="disable",
            rate_limit_mode="local",
            web_concurrency=2,
        )


def test_private_single_host_production_configuration_is_accepted():
    configured = _production_settings(
        database_url="postgresql://solar_erp:password@database/solar_erp",
        database_sslmode="disable",
        allow_private_database_no_tls=True,
        rate_limit_mode="local",
        single_instance_deployment=True,
        web_concurrency=1,
    )
    assert configured.allow_private_database_no_tls
    assert configured.single_instance_deployment


def test_private_database_no_tls_is_restricted_to_container_service_names():
    with pytest.raises(ValidationError, match="explicitly approved private container database"):
        _production_settings(
            database_url="postgresql://solar_erp:password@db.example.com/solar_erp",
            database_sslmode="disable",
            allow_private_database_no_tls=True,
        )


def test_single_host_local_rate_limiting_requires_one_worker():
    with pytest.raises(ValidationError, match="single-worker deployment"):
        _production_settings(
            rate_limit_mode="local",
            single_instance_deployment=True,
            web_concurrency=2,
        )


def test_r2_production_configuration_is_accepted():
    configured = _production_settings(
        s3_provider="r2",
        s3_region="auto",
        s3_endpoint_url="https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        s3_access_key_id="bucket-access-key",
        s3_secret_access_key="bucket-secret-key",
        s3_addressing_style="path",
        s3_sse_algorithm="provider-managed",
    )
    assert configured.normalized_s3_provider == "r2"


def test_r2_rejects_aws_encryption_headers():
    with pytest.raises(
        ValidationError,
        match="Cloudflare R2 requires S3_SSE_ALGORITHM=provider-managed",
    ):
        _production_settings(
            s3_provider="r2",
            s3_region="auto",
            s3_endpoint_url="https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
            s3_access_key_id="bucket-access-key",
            s3_secret_access_key="bucket-secret-key",
            s3_addressing_style="path",
            s3_sse_algorithm="AES256",
        )


def test_r2_requires_cloudflare_endpoint_and_credentials():
    common = {
        "s3_provider": "r2",
        "s3_region": "auto",
        "s3_addressing_style": "path",
        "s3_sse_algorithm": "provider-managed",
    }
    with pytest.raises(ValidationError, match="bucket-scoped access credentials"):
        _production_settings(
            **common,
            s3_endpoint_url="https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
        )
    with pytest.raises(ValidationError, match="Cloudflare R2 S3 endpoint"):
        _production_settings(
            **common,
            s3_access_key_id="bucket-access-key",
            s3_secret_access_key="bucket-secret-key",
            s3_endpoint_url="https://s3.example.com",
        )


def test_production_requires_object_storage():
    with pytest.raises(ValidationError, match="STORAGE_TYPE must be s3"):
        _production_settings(storage_type="local")


def test_production_rejects_unverified_database_tls():
    with pytest.raises(ValidationError, match="verify the database certificate"):
        _production_settings(database_sslmode="require")


def test_invalid_rate_limit_mode_is_rejected():
    with pytest.raises(ValidationError, match="RATE_LIMIT_MODE must be local or gateway"):
        Settings(_env_file=None, rate_limit_mode="memory")


def test_request_concurrency_cannot_exceed_database_capacity():
    with pytest.raises(ValidationError, match="MAX_CONCURRENT_REQUESTS cannot exceed"):
        Settings(
            _env_file=None,
            db_pool_size=2,
            db_max_overflow=1,
            max_concurrent_requests=4,
        )


def test_storage_write_probe_interval_is_bounded():
    with pytest.raises(
        ValidationError,
        match="STORAGE_WRITE_PROBE_INTERVAL_SECONDS must be between 60 and 86400",
    ):
        Settings(_env_file=None, storage_write_probe_interval_seconds=30)
