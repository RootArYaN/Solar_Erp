from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from threading import Lock

from fastapi import HTTPException, status

from app.core.config import settings

_attempts: dict[str, deque[datetime]] = defaultdict(deque)
_lock = Lock()


def check_login_limit(key: str) -> None:
    now = datetime.now(UTC)
    cutoff = now - timedelta(seconds=settings.login_window_seconds)
    with _lock:
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
    with _lock:
        _attempts.pop(key, None)
