from app.core.security import (
    create_csrf_token,
    hash_password,
    verify_csrf_token,
    verify_password,
)


def test_passwords_are_argon2_hashed_and_verified():
    encoded = hash_password("Strong-password-123!")
    assert encoded.startswith("$argon2")
    assert verify_password("Strong-password-123!", encoded)
    assert not verify_password("wrong-password", encoded)


def test_csrf_token_is_bound_to_auth_session():
    token = create_csrf_token("session-a")
    assert verify_csrf_token(token, "session-a")
    assert not verify_csrf_token(token, "session-b")
    assert not verify_csrf_token("", "session-a")
