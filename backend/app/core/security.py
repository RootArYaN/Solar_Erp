from datetime import UTC, datetime, timedelta
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
        return password_hasher.verify(hashed_password, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(subject: str, claims: dict[str, Any]) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": subject,
        "iat": datetime.now(UTC),
        "exp": expires_at,
        **claims,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
