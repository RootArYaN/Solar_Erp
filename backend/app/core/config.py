import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import EmailStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Shree Enterprise API"
    environment: str = "development"
    render: bool = False
    render_external_hostname: str = ""
    web_concurrency: int = 1
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

    # Use local for one API process. Use gateway when a reverse proxy/API gateway
    # is the shared source of truth for multiple API instances.
    rate_limit_mode: str = "local"
    rate_limit_login_per_minute: int = 20
    rate_limit_read_per_minute: int = 180
    rate_limit_write_per_minute: int = 60
    rate_limit_search_per_minute: int = 45
    rate_limit_upload_per_minute: int = 10
    rate_limit_refresh_per_minute: int = 20
    rate_limit_max_keys: int = 5_000

    storage_type: str = "local"
    storage_path: str = "./storage"
    storage_temp_path: str = "./storage/temp"
    s3_provider: str = "aws"
    s3_bucket: str = ""
    s3_prefix: str = "solar-erp"
    s3_region: str = "ap-south-1"
    s3_endpoint_url: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_session_token: str = ""
    s3_addressing_style: str = "auto"
    s3_sse_algorithm: str = "AES256"
    s3_kms_key_id: str = ""
    storage_write_probe_interval_seconds: int = 900
    max_upload_mb: int = 20
    upload_chunk_kb: int = 512
    max_request_body_mb: int = 2
    malware_scan_command: str = ""
    malware_scan_timeout_seconds: int = 60
    require_malware_scan: bool = False

    default_page_size: int = 25
    max_page_size: int = 100
    login_limit: int = 8
    login_window_seconds: int = 300
    idempotency_ttl_hours: int = 24
    idempotency_processing_timeout_seconds: int = 180
    idempotency_cleanup_interval_seconds: int = 300

    # Small-instance defaults: one API worker, a small PostgreSQL pool and a
    # bounded sync thread pool. Increase only after load-test evidence.
    db_pool_size: int = 3
    db_max_overflow: int = 2
    db_pool_timeout_seconds: int = 10
    db_pool_recycle_seconds: int = 1_200
    db_connect_timeout_seconds: int = 5
    db_statement_timeout_ms: int = 15_000
    db_idle_transaction_timeout_ms: int = 30_000
    thread_pool_workers: int = 8
    max_concurrent_requests: int = 5
    slow_request_ms: int = 750

    seed_company_name: str = "Shree Enterprise"
    seed_company_code: str = "SHREE"
    seed_admin_name: str = "Local Administrator"
    seed_admin_username: str = "admin"
    seed_admin_email: EmailStr = "admin@solarerp.dev"
    seed_admin_password: str = "ChangeMe123!"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("database_url", mode="before")
    @classmethod
    def select_psycopg_driver(cls, value):
        if isinstance(value, str):
            if value.startswith("postgresql://"):
                return value.replace("postgresql://", "postgresql+psycopg://", 1)
            if value.startswith("postgres://"):
                return value.replace("postgres://", "postgresql+psycopg://", 1)
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.frontend_origins.split(",") if origin.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        hosts = [host.strip() for host in self.trusted_hosts.split(",") if host.strip()]
        render_host = self.render_external_hostname.strip().lower()
        if self.render and render_host and render_host not in hosts:
            hosts.append(render_host)
        return hosts

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def storage_root(self) -> Path:
        return Path(self.storage_path).expanduser().resolve()

    @property
    def storage_temp_root(self) -> Path:
        return Path(self.storage_temp_path).expanduser().resolve()

    @property
    def normalized_s3_prefix(self) -> str:
        return self.s3_prefix.strip().strip("/")

    @property
    def normalized_s3_provider(self) -> str:
        return self.s3_provider.strip().lower()

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def upload_chunk_bytes(self) -> int:
        return self.upload_chunk_kb * 1024

    @property
    def max_request_body_bytes(self) -> int:
        return self.max_request_body_mb * 1024 * 1024

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
        if self.storage_type not in {"local", "s3"}:
            raise ValueError("STORAGE_TYPE must be local or s3")
        if self.normalized_s3_provider not in {"aws", "r2"}:
            raise ValueError("S3_PROVIDER must be aws or r2")
        if self.s3_addressing_style not in {"auto", "path", "virtual"}:
            raise ValueError("S3_ADDRESSING_STYLE must be auto, path or virtual")
        if self.s3_sse_algorithm not in {"AES256", "aws:kms", "provider-managed"}:
            raise ValueError(
                "S3_SSE_ALGORITHM must be AES256, aws:kms or provider-managed"
            )
        if self.s3_sse_algorithm == "aws:kms" and self.storage_type == "s3" and not self.s3_kms_key_id.strip():
            raise ValueError("S3_KMS_KEY_ID is required when S3_SSE_ALGORITHM=aws:kms")
        if bool(self.s3_access_key_id.strip()) != bool(self.s3_secret_access_key.strip()):
            raise ValueError("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be provided together")
        if self.storage_type == "s3" and not self.s3_bucket.strip():
            raise ValueError("S3_BUCKET is required when STORAGE_TYPE=s3")
        if self.storage_type == "s3" and self.normalized_s3_provider == "aws":
            if self.s3_sse_algorithm == "provider-managed":
                raise ValueError(
                    "AWS S3 requires explicit AES256 or aws:kms encryption"
                )
        if self.storage_type == "s3" and self.normalized_s3_provider == "r2":
            if self.s3_sse_algorithm != "provider-managed":
                raise ValueError(
                    "Cloudflare R2 requires S3_SSE_ALGORITHM=provider-managed"
                )
            if self.s3_region.strip().lower() != "auto":
                raise ValueError("Cloudflare R2 requires S3_REGION=auto")
            if self.s3_addressing_style != "path":
                raise ValueError("Cloudflare R2 requires S3_ADDRESSING_STYLE=path")
            if not self.s3_access_key_id.strip() or not self.s3_secret_access_key.strip():
                raise ValueError(
                    "Cloudflare R2 requires bucket-scoped access credentials"
                )
            endpoint = urlparse(self.s3_endpoint_url.strip())
            hostname = (endpoint.hostname or "").lower()
            if (
                endpoint.scheme != "https"
                or not hostname.endswith(".r2.cloudflarestorage.com")
                or not re.fullmatch(r"[0-9a-f]{32}", hostname.split(".", 1)[0])
                or endpoint.username
                or endpoint.password
                or endpoint.path not in {"", "/"}
                or endpoint.query
                or endpoint.fragment
            ):
                raise ValueError(
                    "S3_ENDPOINT_URL must be the HTTPS Cloudflare R2 S3 endpoint"
                )
            if self.s3_access_key_id.startswith("replace-") or self.s3_secret_access_key.startswith("replace-"):
                raise ValueError(
                    "Replace the placeholder Cloudflare R2 credentials"
                )
        if not self.database_url.startswith("postgresql"):
            raise ValueError("DATABASE_URL must use PostgreSQL")
        if self.database_sslmode not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise ValueError("DATABASE_SSLMODE is invalid")
        if self.rate_limit_mode not in {"local", "gateway"}:
            raise ValueError("RATE_LIMIT_MODE must be local or gateway")
        if self.max_upload_mb < 1 or self.max_upload_mb > 100:
            raise ValueError("MAX_UPLOAD_MB must be between 1 and 100")
        if self.max_request_body_mb < 1 or self.max_request_body_mb > 20:
            raise ValueError("MAX_REQUEST_BODY_MB must be between 1 and 20")
        if self.upload_chunk_kb < 64 or self.upload_chunk_kb > 2048:
            raise ValueError("UPLOAD_CHUNK_KB must be between 64 and 2048")
        if (
            self.storage_write_probe_interval_seconds < 60
            or self.storage_write_probe_interval_seconds > 86_400
        ):
            raise ValueError(
                "STORAGE_WRITE_PROBE_INTERVAL_SECONDS must be between 60 and 86400"
            )
        if self.require_malware_scan and not self.malware_scan_command.strip():
            raise ValueError("MALWARE_SCAN_COMMAND is required when REQUIRE_MALWARE_SCAN=true")
        if self.db_pool_size < 1 or self.db_pool_size > 20:
            raise ValueError("DB_POOL_SIZE must be between 1 and 20")
        if self.db_max_overflow < 0 or self.db_max_overflow > 20:
            raise ValueError("DB_MAX_OVERFLOW must be between 0 and 20")
        if self.thread_pool_workers < 2 or self.thread_pool_workers > 64:
            raise ValueError("THREAD_POOL_WORKERS must be between 2 and 64")
        if self.max_concurrent_requests < 1 or self.max_concurrent_requests > 100:
            raise ValueError("MAX_CONCURRENT_REQUESTS must be between 1 and 100")
        if self.max_concurrent_requests > self.db_pool_size + self.db_max_overflow:
            raise ValueError(
                "MAX_CONCURRENT_REQUESTS cannot exceed DB_POOL_SIZE + DB_MAX_OVERFLOW"
            )
        if self.rate_limit_max_keys < 100 or self.rate_limit_max_keys > 100_000:
            raise ValueError("RATE_LIMIT_MAX_KEYS must be between 100 and 100000")
        if self.web_concurrency < 1 or self.web_concurrency > 16:
            raise ValueError("WEB_CONCURRENCY must be between 1 and 16")
        if self.is_production:
            if not self.csrf_enabled:
                raise ValueError("CSRF_ENABLED must be true in production")
            if self.jwt_secret.startswith("replace-this-development-secret"):
                raise ValueError("Set a private JWT_SECRET before production startup")
            # A 256-bit base64 secret generated by Render is 44 characters.
            if len(self.jwt_secret) < 43:
                raise ValueError("Production JWT_SECRET must contain at least 256 bits of random data")
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
            render_private_database = self.render and self.database_sslmode == "disable"
            if (
                self.database_sslmode not in {"verify-ca", "verify-full"}
                and not render_private_database
            ):
                raise ValueError(
                    "DATABASE_SSLMODE must verify the database certificate in production "
                    "(Render services may use disable only for same-region private Postgres)"
                )
            render_single_instance_limit = (
                self.render
                and self.rate_limit_mode == "local"
                and self.web_concurrency == 1
            )
            if self.rate_limit_mode != "gateway" and not render_single_instance_limit:
                raise ValueError(
                    "RATE_LIMIT_MODE must be gateway in production, except for a single-worker "
                    "Render service that is kept at one instance"
                )
            if self.storage_type != "s3":
                raise ValueError("STORAGE_TYPE must be s3 in production")
            if not self.normalized_s3_prefix:
                raise ValueError("S3_PREFIX must not be empty in production")
            if self.s3_endpoint_url and not self.s3_endpoint_url.startswith("https://"):
                raise ValueError("S3_ENDPOINT_URL must use HTTPS in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
