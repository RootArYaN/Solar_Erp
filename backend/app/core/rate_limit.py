from __future__ import annotations

import math
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from threading import Lock

from fastapi import HTTPException, Request, status

from app.core.config import settings


@dataclass(frozen=True)
class RateLimitDecision:
    limit: int
    remaining: int
    retry_after: int = 0


@dataclass
class _TokenBucket:
    tokens: float
    updated_at: float


@dataclass(frozen=True)
class _Rule:
    name: str
    requests_per_minute: int


_buckets: OrderedDict[str, _TokenBucket] = OrderedDict()
_bucket_lock = Lock()
_login_attempts: OrderedDict[str, deque[float]] = OrderedDict()
_login_lock = Lock()


def _client_ip(request: Request) -> str:
    forwarded = ""
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _request_identity(request: Request) -> str:
    claims = getattr(request.state, "access_claims", None)
    if isinstance(claims, dict):
        membership_id = str(claims.get("membership_id") or "")
        if membership_id:
            return f"membership:{membership_id}"
        subject = str(claims.get("sub") or "")
        if subject:
            return f"user:{subject}"
    return f"ip:{_client_ip(request)}"


def _rule_for(request: Request) -> _Rule | None:
    path = request.url.path
    method = request.method.upper()
    if not path.startswith("/api/v1") or path in {"/api/v1/health", "/api/v1/ready"}:
        return None
    if path == "/api/v1/auth/login":
        # A broad IP bucket blocks username rotation; the stricter limiter below
        # separately tracks failed username + IP combinations.
        return _Rule("login", settings.rate_limit_login_per_minute)
    if path == "/api/v1/auth/refresh":
        return _Rule("refresh", settings.rate_limit_refresh_per_minute)
    if method == "POST" and path == "/api/v1/files":
        return _Rule("upload", settings.rate_limit_upload_per_minute)
    if method in {"POST", "PUT", "PATCH", "DELETE"}:
        return _Rule("write", settings.rate_limit_write_per_minute)
    if method == "GET":
        search_keys = {"q", "query", "search", "term", "keyword"}
        if search_keys.intersection(request.query_params.keys()) or "/search" in path:
            return _Rule("search", settings.rate_limit_search_per_minute)
    return _Rule("read", settings.rate_limit_read_per_minute)


def check_request_limit(request: Request) -> RateLimitDecision | None:
    if settings.rate_limit_mode == "gateway":
        return None
    rule = _rule_for(request)
    if rule is None or rule.requests_per_minute <= 0:
        return None

    now = time.monotonic()
    refill_per_second = rule.requests_per_minute / 60.0
    key = f"{rule.name}:{_request_identity(request)}"

    with _bucket_lock:
        bucket = _buckets.get(key)
        if bucket is None:
            while len(_buckets) >= settings.rate_limit_max_keys:
                _buckets.popitem(last=False)
            bucket = _TokenBucket(tokens=float(rule.requests_per_minute), updated_at=now)
            _buckets[key] = bucket
        else:
            elapsed = max(0.0, now - bucket.updated_at)
            bucket.tokens = min(
                float(rule.requests_per_minute),
                bucket.tokens + elapsed * refill_per_second,
            )
            bucket.updated_at = now
            _buckets.move_to_end(key)

        if bucket.tokens < 1.0:
            retry_after = max(1, math.ceil((1.0 - bucket.tokens) / refill_per_second))
            return RateLimitDecision(rule.requests_per_minute, 0, retry_after)

        bucket.tokens -= 1.0
        return RateLimitDecision(rule.requests_per_minute, max(0, int(bucket.tokens)))


def check_login_limit(key: str) -> None:
    if settings.rate_limit_mode == "gateway":
        return

    normalized_key = key.strip().lower()[:300]
    now = time.monotonic()
    cutoff = now - settings.login_window_seconds
    with _login_lock:
        history = _login_attempts.get(normalized_key)
        if history is None:
            while len(_login_attempts) >= settings.rate_limit_max_keys:
                _login_attempts.popitem(last=False)
            history = deque()
            _login_attempts[normalized_key] = history
        else:
            _login_attempts.move_to_end(normalized_key)

        while history and history[0] <= cutoff:
            history.popleft()
        if len(history) >= settings.login_limit:
            retry_after = max(1, math.ceil(settings.login_window_seconds - (now - history[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again shortly.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(settings.login_limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
        history.append(now)


def clear_login_limit(key: str) -> None:
    if settings.rate_limit_mode == "gateway":
        return
    with _login_lock:
        _login_attempts.pop(key.strip().lower()[:300], None)
