from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.security import create_access_token, hash_refresh_token, new_refresh_token, verify_password
from app.core.time import as_utc
from app.models.auth import Membership, Role, User
from app.models.system import AuthSession
from app.schemas.auth import ActiveDeviceSummary, CompanySummary, LoginRequest, SessionResponse, UserSummary
from app.services.audit_service import write_event


class AuthenticationError(Exception):
    pass


def _parse_device(user_agent: str) -> tuple[str, str, str]:
    value = user_agent.lower()
    browser = "Safari" if "safari" in value and "chrome" not in value else "Chrome" if "chrome" in value else "Firefox" if "firefox" in value else "Browser"
    operating_system = "macOS" if "mac os" in value else "Windows" if "windows" in value else "Android" if "android" in value else "iOS" if "iphone" in value or "ipad" in value else "Linux" if "linux" in value else "Unknown"
    return f"{browser} on {operating_system}", browser, operating_system


def _session_response(membership: Membership, auth_session_id: str) -> SessionResponse:
    role_code = membership.role.code
    permissions = sorted({permission.code for permission in membership.role.permissions})
    token, expires_at = create_access_token(
        subject=membership.user.id,
        claims={
            "membership_id": membership.id,
            "company_id": membership.company.id,
            "role": role_code,
            "auth_session_id": auth_session_id,
        },
    )
    return SessionResponse(
        access_token=token,
        expires_at=expires_at,
        membership_id=membership.id,
        user=UserSummary(
            id=membership.user.id,
            username=membership.user.username,
            email=membership.user.email,
            full_name=membership.user.full_name,
            is_super_admin=membership.user.is_super_admin,
        ),
        company=CompanySummary(
            id=membership.company.id,
            name=membership.company.name,
            code=membership.company.code,
        ),
        role=role_code,
        permissions=permissions,
    )


def _load_membership(db: Session, membership_id: str) -> Membership | None:
    return db.scalar(
        select(Membership)
        .where(Membership.id == membership_id)
        .options(
            selectinload(Membership.user),
            selectinload(Membership.company),
            selectinload(Membership.role).selectinload(Role.permissions),
        )
    )


def authenticate(
    db: Session,
    payload: LoginRequest,
    *,
    user_agent: str,
    ip_hint: str,
) -> tuple[SessionResponse, str, AuthSession]:
    user = db.scalar(
        select(User)
        .where(User.username == payload.username)
        .options(
            selectinload(User.memberships).selectinload(Membership.role).selectinload(Role.permissions),
            selectinload(User.memberships).selectinload(Membership.company),
        )
    )
    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        raise AuthenticationError("Invalid username or password")

    memberships = [item for item in user.memberships if item.is_active and item.company.is_active]
    if not memberships:
        raise AuthenticationError("No active company access found")

    membership = memberships[0]
    refresh_token = new_refresh_token()
    device_name, browser, operating_system = _parse_device(user_agent)
    auth_session = AuthSession(
        user_id=user.id,
        membership_id=membership.id,
        refresh_hash=hash_refresh_token(refresh_token),
        device_name=device_name,
        browser=browser,
        operating_system=operating_system,
        ip_hint=ip_hint,
        user_agent=user_agent[:400],
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days),
        persistent=payload.remember,
    )
    db.add(auth_session)
    db.flush()
    response = _session_response(membership, auth_session.id)
    write_event(
        db,
        company_id=membership.company_id,
        event="login.success",
        entity="auth_session",
        entity_id=auth_session.id,
        changes={"device": device_name, "ip_hint": ip_hint},
    )
    db.commit()
    return response, refresh_token, auth_session



def record_login_failure(db: Session, username: str, ip_hint: str) -> None:
    user = db.scalar(
        select(User)
        .where(User.username == username.strip().lower())
        .options(selectinload(User.memberships))
    )
    membership = next((item for item in user.memberships if item.is_active), None) if user else None
    if not membership:
        return
    write_event(
        db,
        company_id=membership.company_id,
        event="login.failure",
        entity="user",
        entity_id=user.id,
        changes={"username": username.strip().lower(), "ip_hint": ip_hint},
    )
    db.commit()

def refresh_session(db: Session, refresh_token: str) -> tuple[SessionResponse, str, AuthSession]:
    now = datetime.now(UTC)
    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.refresh_hash == hash_refresh_token(refresh_token))
    )
    if not auth_session or auth_session.revoked_at or as_utc(auth_session.expires_at) <= now:
        raise AuthenticationError("Session expired or revoked")

    membership = _load_membership(db, auth_session.membership_id)
    if not membership or not membership.is_active or not membership.user.is_active or not membership.company.is_active:
        raise AuthenticationError("Session access is no longer active")

    next_token = new_refresh_token()
    auth_session.refresh_hash = hash_refresh_token(next_token)
    auth_session.last_seen_at = now
    response = _session_response(membership, auth_session.id)
    db.commit()
    return response, next_token, auth_session


def revoke_session(db: Session, auth_session_id: str) -> None:
    row = db.get(AuthSession, auth_session_id)
    if row and not row.revoked_at:
        row.revoked_at = datetime.now(UTC)
        db.commit()


def list_devices(db: Session, membership_id: str, current_id: str) -> list[ActiveDeviceSummary]:
    rows = list(db.scalars(
        select(AuthSession)
        .where(AuthSession.membership_id == membership_id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_seen_at.desc())
    ).all())
    return [
        ActiveDeviceSummary(
            id=row.id,
            device_name=row.device_name,
            browser=row.browser,
            operating_system=row.operating_system,
            approximate_location=row.approximate_location,
            ip_hint=row.ip_hint,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            is_current=row.id == current_id,
        )
        for row in rows
    ]


def revoke_other_devices(db: Session, membership_id: str, current_id: str) -> None:
    db.execute(
        update(AuthSession)
        .where(
            AuthSession.membership_id == membership_id,
            AuthSession.id != current_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()
