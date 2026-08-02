#!/usr/bin/env python3
"""Fail-closed validation for the Hostinger deployment environment file."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


DOMAIN_PATTERN = re.compile(
    r"(?=.{4,253}\Z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z"
)
EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+\Z")
URL_SAFE_SECRET_PATTERN = re.compile(r"[A-Za-z0-9._~-]+\Z")
PLACEHOLDER_PARTS = ("replace-with", "changeme", "example.com", "000000")


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise ValueError(f"line {line_number} is not KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError(f"line {line_number} has an invalid variable name")
        if key in values:
            raise ValueError(f"line {line_number} duplicates {key}")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def validate(values: dict[str, str], *, require_bootstrap_password: bool) -> list[str]:
    errors: list[str] = []

    def require(key: str) -> str:
        value = values.get(key, "").strip()
        if not value:
            errors.append(f"{key} is required")
        return value

    domain = require("ERP_DOMAIN").lower()
    if domain and (
        not DOMAIN_PATTERN.fullmatch(domain)
        or domain.endswith(".example.com")
        or "://" in domain
        or "/" in domain
    ):
        errors.append("ERP_DOMAIN must be the real hostname only, without a scheme or path")

    postgres_password = require("POSTGRES_PASSWORD")
    if postgres_password and (
        len(postgres_password) < 32
        or not URL_SAFE_SECRET_PATTERN.fullmatch(postgres_password)
        or any(part in postgres_password.lower() for part in PLACEHOLDER_PARTS)
    ):
        errors.append("POSTGRES_PASSWORD must be a URL-safe random value of at least 32 characters")

    jwt_secret = require("JWT_SECRET")
    if jwt_secret and (
        len(jwt_secret) < 43
        or not URL_SAFE_SECRET_PATTERN.fullmatch(jwt_secret)
        or any(part in jwt_secret.lower() for part in PLACEHOLDER_PARTS)
    ):
        errors.append("JWT_SECRET must be an independent URL-safe random value of at least 43 characters")
    if postgres_password and jwt_secret and postgres_password == jwt_secret:
        errors.append("POSTGRES_PASSWORD and JWT_SECRET must be different")

    expected = {
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
    }
    for key, expected_value in expected.items():
        actual = require(key)
        if actual and actual.lower() != expected_value.lower():
            errors.append(f"{key} must be {expected_value}")

    try:
        capacity = int(require("DB_POOL_SIZE")) + int(require("DB_MAX_OVERFLOW"))
        concurrency = int(require("MAX_CONCURRENT_REQUESTS"))
        if capacity < concurrency:
            errors.append("MAX_CONCURRENT_REQUESTS cannot exceed DB_POOL_SIZE + DB_MAX_OVERFLOW")
    except ValueError:
        errors.append("DB_POOL_SIZE, DB_MAX_OVERFLOW and MAX_CONCURRENT_REQUESTS must be integers")

    email = require("SEED_ADMIN_EMAIL").lower()
    if email and (not EMAIL_PATTERN.fullmatch(email) or email.endswith("@example.com")):
        errors.append("SEED_ADMIN_EMAIL must be the real administrator email")

    password = values.get("SEED_ADMIN_PASSWORD", "")
    if require_bootstrap_password and not password:
        errors.append("SEED_ADMIN_PASSWORD is required for the first deployment")
    if password and (
        len(password) < 12
        or any(part in password.lower() for part in PLACEHOLDER_PARTS)
    ):
        errors.append("SEED_ADMIN_PASSWORD must be a non-placeholder value of at least 12 characters")

    obsolete = sorted(
        key for key in values
        if key.startswith(("CLOUDFLARE_", "R2_", "RENDER_", "S3_"))
    )
    if obsolete:
        errors.append("Remove non-Hostinger storage/provider variables: " + ", ".join(obsolete))

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Path to .env.hostinger")
    parser.add_argument(
        "--require-bootstrap-password",
        action="store_true",
        help="Require SEED_ADMIN_PASSWORD for a first deployment",
    )
    args = parser.parse_args()

    if not args.path.is_file():
        print(f"Hostinger environment file not found: {args.path}")
        return 2
    try:
        values = load_env(args.path)
    except ValueError as exc:
        print(f"Hostinger environment is invalid: {exc}")
        return 2

    errors = validate(values, require_bootstrap_password=args.require_bootstrap_password)
    if errors:
        print("Hostinger environment validation failed:")
        for error in errors:
            print(f"- {error}")
        return 2
    print("Hostinger environment validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
