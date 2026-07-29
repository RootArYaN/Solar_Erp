from functools import lru_cache
from pathlib import Path

from pydantic import EmailStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Solar ERP API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/solar_erp"
    database_sslmode: str = "prefer"

    jwt_secret: str = "replace-this-development-secret-with-at-least-32-characters"
    jwt_algorithm: str = "HS256"
    jwt_clock_skew_seconds: int = 30
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    refresh_rotation_grace_seconds: int = 30
    session_cookie_name: str = "solar_erp_refresh"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"
    session_cookie_domain: str | None = None

    csrf_enabled: bool = True
    csrf_header_name: str = "X-CSRF-Token"
    frontend_origins: str = "http://172.20.10.12:5173,http://127.0.0.1:5173,http://localhost:5173"
    trusted_hosts: str = "127.0.0.1,localhost,172.20.10.12,testserver"
    trust_proxy_headers: bool = False
    rate_limit_mode: str = "local"

    storage_type: str = "local"
    storage_path: str = "./storage"
    max_upload_mb: int = 20
    malware_scan_command: str = ""
    require_malware_scan: bool = False

    default_page_size: int = 25
    max_page_size: int = 100
    login_limit: int = 8
    login_window_seconds: int = 300
    idempotency_ttl_hours: int = 24
    idempotency_processing_timeout_seconds: int = 180
    db_pool_size: int = 5
    db_max_overflow: int = 10

    seed_company_name: str = "Shree Enterprise"
    seed_company_code: str = "SHREE"
    seed_admin_name: str = "Local Administrator"
    seed_admin_username: str = "admin"
    seed_admin_email: EmailStr = "admin@solarerp.dev"
    seed_admin_password: str = "ChangeMe123!"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.frontend_origins.split(",") if origin.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def storage_root(self) -> Path:
        return Path(self.storage_path).expanduser().resolve()

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @model_validator(mode="after")
    def validate_security(self):
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must contain at least 32 characters")
        if self.jwt_algorithm not in {"HS256", "HS384", "HS512"}:
            raise ValueError("JWT_ALGORITHM must be an approved HMAC algorithm")
        if self.refresh_rotation_grace_seconds < 0 or self.refresh_rotation_grace_seconds > 120:
            raise ValueError("REFRESH_ROTATION_GRACE_SECONDS must be between 0 and 120")
        if self.session_cookie_samesite not in {"lax", "strict", "none"}:
            raise ValueError("SESSION_COOKIE_SAMESITE must be lax, strict or none")
        if self.session_cookie_samesite == "none" and not self.session_cookie_secure:
            raise ValueError("SameSite=None cookies must also be Secure")
        if self.storage_type != "local":
            raise ValueError("Only STORAGE_TYPE=local is available before cloud integration")
        if not self.database_url.startswith("postgresql"):
            raise ValueError("DATABASE_URL must use PostgreSQL")
        if self.database_sslmode not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise ValueError("DATABASE_SSLMODE is invalid")
        if self.rate_limit_mode not in {"local", "gateway"}:
            raise ValueError("RATE_LIMIT_MODE must be local or gateway")
        if self.max_upload_mb < 1 or self.max_upload_mb > 100:
            raise ValueError("MAX_UPLOAD_MB must be between 1 and 100")
        if self.require_malware_scan and not self.malware_scan_command.strip():
            raise ValueError("MALWARE_SCAN_COMMAND is required when REQUIRE_MALWARE_SCAN=true")
        if self.is_production:
            if not self.csrf_enabled:
                raise ValueError("CSRF_ENABLED must be true in production")
            if self.jwt_secret.startswith("replace-this-development-secret"):
                raise ValueError("Set a private JWT_SECRET before production startup")
            if not self.session_cookie_secure:
                raise ValueError("SESSION_COOKIE_SECURE must be true in production")
            if any(origin == "*" for origin in self.cors_origins):
                raise ValueError("Wildcard CORS is not allowed in production")
            if any(not origin.startswith("https://") for origin in self.cors_origins):
                raise ValueError("Every production FRONTEND_ORIGINS entry must use HTTPS")
            if not self.trusted_host_list or "*" in self.trusted_host_list:
                raise ValueError("TRUSTED_HOSTS must be explicit in production")
            if not self.require_malware_scan:
                raise ValueError("REQUIRE_MALWARE_SCAN must be true in production")
            if self.database_sslmode not in {"require", "verify-ca", "verify-full"}:
                raise ValueError("DATABASE_SSLMODE must require TLS in production")
            if self.rate_limit_mode != "gateway":
                raise ValueError(
                    "RATE_LIMIT_MODE must be gateway in production; configure distributed rate limiting "
                    "at the API gateway or reverse proxy"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
