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
        "database_sslmode": "require",
        "rate_limit_mode": "gateway",
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


def test_invalid_rate_limit_mode_is_rejected():
    with pytest.raises(ValidationError, match="RATE_LIMIT_MODE must be local or gateway"):
        Settings(_env_file=None, rate_limit_mode="memory")
