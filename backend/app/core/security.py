from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest, new as hmac_new
from secrets import token_urlsafe
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        valid = password_hasher.verify(hashed_password, password)
        return bool(valid)
    except (VerifyMismatchError, InvalidHashError):
        return False


def password_hash_needs_rehash(hashed_password: str) -> bool:
    try:
        return password_hasher.check_needs_rehash(hashed_password)
    except InvalidHashError:
        return True


def create_access_token(subject: str, claims: dict[str, Any]) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": subject, "iat": now, "nbf": now, "exp": expires_at, **claims}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "iat", "nbf", "exp"]},
        leeway=settings.jwt_clock_skew_seconds,
    )


def new_refresh_token() -> str:
    return token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    return sha256(token.encode("utf-8")).hexdigest()


def create_csrf_token(auth_session_id: str) -> str:
    return hmac_new(
        settings.jwt_secret.encode("utf-8"),
        f"solar-erp-csrf:{auth_session_id}".encode("utf-8"),
        sha256,
    ).hexdigest()


def verify_csrf_token(token: str, auth_session_id: str) -> bool:
    if not token or not auth_session_id:
        return False
    return compare_digest(token, create_csrf_token(auth_session_id))
