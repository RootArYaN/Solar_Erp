from functools import lru_cache

from pydantic import EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Solar ERP API"
    environment: str = "development"
    database_url: str = "sqlite:///./solar_erp.db"

    jwt_secret: str = "replace-this-development-secret-with-at-least-32-characters"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 480

    frontend_origins: str = "http://localhost:5173"

    seed_company_name: str = "Shree Enterprise"
    seed_company_code: str = "SHREE"
    seed_admin_name: str = "Local Administrator"
    seed_admin_username: str = "admin"
    seed_admin_email: EmailStr = "admin@solarerp.dev"
    seed_admin_password: str = "ChangeMe123!"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
