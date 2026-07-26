from functools import lru_cache
from pathlib import Path

from pydantic import EmailStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Solar ERP API"
    environment: str = "development"
    database_url: str = "sqlite:///./solar_erp.db"

    jwt_secret: str = "replace-this-development-secret-with-at-least-32-characters"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    session_cookie_name: str = "solar_erp_refresh"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"

    frontend_origins: str = "http://172.20.10.12:5173,http://127.0.0.1:5173"
    storage_type: str = "local"
    storage_path: str = "./storage"
    max_upload_mb: int = 20
    archive_keep_days: int = 30
    archive_worker_limit: int = 1
    archive_job_timeout_minutes: int = 60
    default_page_size: int = 25
    max_page_size: int = 100
    login_limit: int = 8
    login_window_seconds: int = 300
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
        if self.session_cookie_samesite not in {"lax", "strict", "none"}:
            raise ValueError("SESSION_COOKIE_SAMESITE must be lax, strict or none")
        if self.storage_type != "local":
            raise ValueError("Only STORAGE_TYPE=local is available before cloud integration")
        if self.archive_worker_limit < 1 or self.archive_job_timeout_minutes < 5:
            raise ValueError("Archive worker limits must be positive and the timeout at least 5 minutes")
        if self.is_production:
            if self.jwt_secret.startswith("replace-this-development-secret"):
                raise ValueError("Set a private JWT_SECRET before production startup")
            if not self.session_cookie_secure:
                raise ValueError("SESSION_COOKIE_SECURE must be true in production")
            if any(origin == "*" for origin in self.cors_origins):
                raise ValueError("Wildcard CORS is not allowed in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
