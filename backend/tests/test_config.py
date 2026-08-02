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


def test_production_requires_object_storage():
    with pytest.raises(ValidationError, match="STORAGE_TYPE must be s3"):
        _production_settings(storage_type="local")


def test_single_host_production_local_storage_is_accepted():
    configured = _production_settings(
        storage_type="local",
        storage_path="/app/storage",
        allow_local_storage_production=True,
        single_instance_deployment=True,
    )
    assert configured.storage_type == "local"
    assert configured.storage_root.as_posix() == "/app/storage"


def test_production_local_storage_requires_an_absolute_bounded_path():
    with pytest.raises(ValidationError, match="persistent local storage"):
        _production_settings(
            storage_type="local",
            storage_path="./storage",
            allow_local_storage_production=True,
            single_instance_deployment=True,
        )


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


def test_bootstrap_identifiers_are_normalized():
    configured = Settings(
        _env_file=None,
        seed_company_name="  Example   Solar  ",
        seed_company_code=" ex_01 ",
        seed_admin_name="  Primary   Admin ",
        seed_admin_username=" ADMIN.User ",
    )
    assert configured.seed_company_name == "Example Solar"
    assert configured.seed_company_code == "EX_01"
    assert configured.seed_admin_name == "Primary Admin"
    assert configured.seed_admin_username == "admin.user"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("seed_company_code", "bad code", "SEED_COMPANY_CODE"),
        ("seed_admin_username", "admin user", "SEED_ADMIN_USERNAME"),
    ],
)
def test_invalid_bootstrap_identifiers_are_rejected(field, value, message):
    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=None, **{field: value})
