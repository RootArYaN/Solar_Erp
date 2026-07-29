from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock

from fastapi import HTTPException, status

from app.core.config import settings

_attempts: dict[str, deque[datetime]] = defaultdict(deque)
_lock = Lock()
MAX_TRACKED_LOGIN_KEYS = 10_000


def _prune(cutoff: datetime) -> None:
    for tracked_key in list(_attempts):
        history = _attempts[tracked_key]
        while history and history[0] < cutoff:
            history.popleft()
        if not history:
            _attempts.pop(tracked_key, None)


def check_login_limit(key: str) -> None:
    # Production requires a distributed gateway limiter. Do not also retain an
    # unbounded process-local username/IP map behind that gateway.
    if settings.rate_limit_mode == "gateway":
        return
    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=settings.login_window_seconds)
    with _lock:
        if key not in _attempts and len(_attempts) >= MAX_TRACKED_LOGIN_KEYS:
            _prune(cutoff)
            while key not in _attempts and len(_attempts) >= MAX_TRACKED_LOGIN_KEYS:
                _attempts.pop(next(iter(_attempts)))
        history = _attempts[key]
        while history and history[0] < cutoff:
            history.popleft()
        if len(history) >= settings.login_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again shortly.",
            )
        history.append(now)


def clear_login_limit(key: str) -> None:
    if settings.rate_limit_mode == "gateway":
        return
    with _lock:
        _attempts.pop(key, None)
