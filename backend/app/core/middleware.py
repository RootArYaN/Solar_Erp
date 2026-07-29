from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Lock
from uuid import uuid4

import jwt
import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, TimeoutError as SQLAlchemyTimeoutError
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.rate_limit import RateLimitDecision, check_request_limit
from app.core.request_context import request_id_var
from app.core.security import decode_access_token, verify_csrf_token
from app.db.session import session_scope
from app.models.system import IdempotencyRecord

logger = logging.getLogger(__name__)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
CSRF_BOOTSTRAP_PATHS = {"/api/v1/auth/login", "/api/v1/auth/refresh"}
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")
IDEMPOTENCY_BODY_LIMIT = 1024 * 1024
IDEMPOTENCY_RESPONSE_LIMIT = 2 * 1024 * 1024

_cleanup_lock = Lock()
_next_cleanup_at = 0.0


class RequestBodyTooLarge(Exception):
    pass


class RequestBodyLimitMiddleware:
    """Reject oversized request bodies while they are streamed, not after buffering."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_type = headers.get(b"content-type", b"").decode("latin1").lower()
        is_multipart = content_type.startswith("multipart/form-data")
        limit = (
            settings.max_upload_bytes + 1024 * 1024
            if is_multipart
            else settings.max_request_body_bytes
        )
        raw_length = headers.get(b"content-length", b"").decode("latin1").strip()
        if raw_length.isdigit() and int(raw_length) > limit:
            await self._send_rejection(scope, send, limit)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise RequestBodyTooLarge
            return message

        async def tracked_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracked_send)
        except RequestBodyTooLarge:
            if response_started:
                raise
            await self._send_rejection(scope, send, limit)

    @staticmethod
    async def _send_rejection(scope: Scope, send: Send, limit: int) -> None:
        supplied = ""
        for key, value in scope.get("headers", []):
            if key.lower() == b"x-request-id":
                supplied = value.decode("latin1").strip()
                break
        request_id = supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else str(uuid4())
        payload = json.dumps(
            {
                "code": "request_too_large",
                "message": f"Request body exceeds the {limit // (1024 * 1024)} MB limit.",
                "field_errors": {},
                "request_id": request_id,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(payload)).encode("ascii")),
                    (b"x-request-id", request_id.encode("ascii")),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": payload})


def _error(
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    *,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers=headers,
        content={
            "code": code,
            "message": message,
            "field_errors": {},
            "request_id": request_id,
        },
    )


def _request_origin(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}".rstrip("/")


def _origin_allowed(request: Request, origin: str) -> bool:
    normalized = origin.rstrip("/")
    return normalized == _request_origin(request) or normalized in settings.cors_origins


def _decode_request_claims(request: Request) -> dict | None:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        request.state.access_token = ""
        request.state.access_claims = None
        return None
    token = authorization.split(" ", 1)[1].strip()
    request.state.access_token = token
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError:
        claims = None
    request.state.access_claims = claims
    return claims


def _validate_browser_request(request: Request, request_id: str) -> JSONResponse | None:
    if request.method.upper() in SAFE_METHODS:
        return None

    origin = request.headers.get("origin", "").strip()
    fetch_site = request.headers.get("sec-fetch-site", "").strip().lower()
    if origin:
        if origin == "null" or not _origin_allowed(request, origin):
            return _error(403, "origin_rejected", "The request origin is not allowed.", request_id)
    elif fetch_site:
        return _error(403, "origin_required", "A valid request origin is required.", request_id)

    if not settings.csrf_enabled or request.url.path in CSRF_BOOTSTRAP_PATHS:
        return None

    claims = getattr(request.state, "access_claims", None)
    if not isinstance(claims, dict):
        return None

    auth_session_id = str(claims.get("auth_session_id") or "")
    csrf_token = request.headers.get(settings.csrf_header_name, "").strip()
    if not verify_csrf_token(csrf_token, auth_session_id):
        return _error(403, "csrf_rejected", "The request security token is missing or invalid.", request_id)
    return None


def _idempotency_claims(request: Request) -> tuple[str, str] | None:
    claims = getattr(request.state, "access_claims", None)
    if not isinstance(claims, dict):
        return None
    company_id = str(claims.get("company_id") or "")
    membership_id = str(claims.get("membership_id") or "")
    return (company_id, membership_id) if company_id and membership_id else None


async def _request_fingerprint(request: Request) -> str:
    content_type = request.headers.get("content-type", "").lower()
    content_length = request.headers.get("content-length", "")
    if content_type.startswith("multipart/form-data"):
        body_hash = f"multipart:{content_type}:{content_length}"
    else:
        body = await request.body()
        if len(body) <= IDEMPOTENCY_BODY_LIMIT:
            body_hash = hashlib.sha256(body).hexdigest()
        else:
            prefix_hash = hashlib.sha256(body[:IDEMPOTENCY_BODY_LIMIT]).hexdigest()
            body_hash = f"large:{len(body)}:{prefix_hash}"
    raw = "\n".join((request.method.upper(), request.url.path, request.url.query, content_type, body_hash))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _cached_response(record: IdempotencyRecord) -> Response:
    headers: dict[str, str] = {}
    try:
        decoded = json.loads(record.response_headers_json or "{}")
        if isinstance(decoded, dict):
            headers = {str(key): str(value) for key, value in decoded.items()}
    except json.JSONDecodeError:
        pass
    return Response(
        content=(record.response_body or "").encode("latin1"),
        status_code=record.response_status or 200,
        media_type=record.response_content_type or "application/json",
        headers=headers,
    )


def _cleanup_due() -> bool:
    global _next_cleanup_at
    now = time.monotonic()
    with _cleanup_lock:
        if now < _next_cleanup_at:
            return False
        _next_cleanup_at = now + settings.idempotency_cleanup_interval_seconds
        return True


@dataclass(frozen=True)
class _ClaimResult:
    record_id: str | None = None
    response: Response | None = None


def _claim_idempotency(
    *,
    company_id: str,
    membership_id: str,
    request_key: str,
    method: str,
    request_path: str,
    request_hash: str,
) -> _ClaimResult:
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=settings.idempotency_ttl_hours)
    processing_cutoff = now - timedelta(seconds=settings.idempotency_processing_timeout_seconds)

    with session_scope() as db:
        if _cleanup_due():
            db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at <= now))

        record = db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.company_id == company_id,
                IdempotencyRecord.membership_id == membership_id,
                IdempotencyRecord.request_key == request_key,
                IdempotencyRecord.method == method,
                IdempotencyRecord.request_path == request_path,
            )
        )
        if record:
            if record.request_hash != request_hash:
                db.commit()
                return _ClaimResult(
                    response=_error(
                        409,
                        "idempotency_conflict",
                        "This request key was already used for different data.",
                        "",
                    )
                )
            if record.status == "completed" and record.response_status is not None:
                response = _cached_response(record)
                db.commit()
                return _ClaimResult(response=response)
            if record.created_at > processing_cutoff:
                db.commit()
                return _ClaimResult(
                    response=_error(
                        409,
                        "idempotency_in_progress",
                        "The original request is still being processed.",
                        "",
                    )
                )
            db.delete(record)
            db.flush()

        record = IdempotencyRecord(
            company_id=company_id,
            membership_id=membership_id,
            request_key=request_key,
            method=method,
            request_path=request_path,
            request_hash=request_hash,
            status="processing",
            expires_at=expires_at,
        )
        db.add(record)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return _ClaimResult(
                response=_error(
                    409,
                    "idempotency_in_progress",
                    "The original request is already being processed.",
                    "",
                )
            )
        return _ClaimResult(record_id=record.id)


def _discard_idempotency(record_id: str) -> None:
    with session_scope() as db:
        db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.id == record_id))
        db.commit()


def _complete_idempotency(
    record_id: str,
    *,
    status_code: int,
    body: bytes | None,
    content_type: str,
    location: str | None,
) -> None:
    with session_scope() as db:
        record = db.get(IdempotencyRecord, record_id)
        if not record:
            return
        if body is not None and 200 <= status_code < 300:
            record.status = "completed"
            record.response_status = status_code
            record.response_body = body.decode("latin1")
            record.response_content_type = content_type.split(";", 1)[0]
            replay_headers = {"Location": location} if location else {}
            record.response_headers_json = json.dumps(replay_headers, separators=(",", ":"))
        else:
            db.delete(record)
        db.commit()


async def _capture_response(original: Response) -> tuple[Response, bytes | None]:
    iterator = original.body_iterator
    chunks: list[bytes] = []
    total = 0

    async for chunk in iterator:
        encoded = chunk.encode("utf-8") if isinstance(chunk, str) else bytes(chunk)
        chunks.append(encoded)
        total += len(encoded)
        if total > IDEMPOTENCY_RESPONSE_LIMIT:
            async def replay():
                for buffered in chunks:
                    yield buffered
                async for remaining in iterator:
                    yield remaining

            return (
                StreamingResponse(
                    replay(),
                    status_code=original.status_code,
                    headers=dict(original.headers),
                    media_type=original.media_type,
                    background=original.background,
                ),
                None,
            )

    body = b"".join(chunks)
    response_headers = dict(original.headers)
    response_headers.pop("content-length", None)
    return (
        Response(
            content=body,
            status_code=original.status_code,
            headers=response_headers,
            media_type=original.media_type,
            background=original.background,
        ),
        body,
    )


async def _with_idempotency(request: Request, call_next, request_id: str) -> Response:
    method = request.method.upper()
    request_key = request.headers.get("idempotency-key", "").strip()
    if method in SAFE_METHODS or not request_key:
        return await call_next(request)
    if not IDEMPOTENCY_KEY_PATTERN.fullmatch(request_key):
        return _error(400, "invalid_idempotency_key", "Idempotency-Key must be 8-128 safe characters.", request_id)

    claims = _idempotency_claims(request)
    if not claims:
        return await call_next(request)
    company_id, membership_id = claims
    request_hash = await _request_fingerprint(request)
    result = await run_in_threadpool(
        _claim_idempotency,
        company_id=company_id,
        membership_id=membership_id,
        request_key=request_key,
        method=method,
        request_path=request.url.path[:500],
        request_hash=request_hash,
    )
    if result.response is not None:
        claimed_response = result.response
        if isinstance(claimed_response, JSONResponse):
            payload = json.loads(claimed_response.body)
            payload["request_id"] = request_id
            response_headers = dict(claimed_response.headers)
            response_headers.pop("content-length", None)
            claimed_response = JSONResponse(
                status_code=claimed_response.status_code,
                headers=response_headers,
                content=payload,
            )
        return claimed_response

    record_id = result.record_id
    try:
        original = await call_next(request)
        response, body = await _capture_response(original)
    except Exception:
        if record_id:
            await run_in_threadpool(_discard_idempotency, record_id)
        raise

    if record_id:
        await run_in_threadpool(
            _complete_idempotency,
            record_id,
            status_code=response.status_code,
            body=body,
            content_type=response.headers.get("content-type", "application/json"),
            location=response.headers.get("location"),
        )
    return response


def _rate_limit_headers(decision: RateLimitDecision | None) -> dict[str, str]:
    if decision is None:
        return {}
    headers = {
        "X-RateLimit-Limit": str(decision.limit),
        "X-RateLimit-Remaining": str(decision.remaining),
    }
    if decision.retry_after:
        headers["Retry-After"] = str(decision.retry_after)
    return headers


def add_request_middleware(app: FastAPI) -> None:
    request_slots = anyio.Semaphore(settings.max_concurrent_requests)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        supplied_request_id = request.headers.get("x-request-id", "").strip()
        request_id = supplied_request_id if REQUEST_ID_PATTERN.fullmatch(supplied_request_id) else str(uuid4())
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        started_at = time.perf_counter()
        decision: RateLimitDecision | None = None
        try:
            _decode_request_claims(request)
            decision = check_request_limit(request)
            if decision is not None and decision.retry_after:
                response = _error(
                    429,
                    "rate_limit_exceeded",
                    "Too many requests. Try again shortly.",
                    request_id,
                    headers=_rate_limit_headers(decision),
                )
            else:
                rejection = _validate_browser_request(request, request_id)
                if rejection is not None:
                    response = rejection
                else:
                    async with request_slots:
                        response = await _with_idempotency(request, call_next, request_id)
        finally:
            request_id_var.reset(token)

        elapsed_ms = (time.perf_counter() - started_at) * 1000
        if elapsed_ms >= settings.slow_request_ms:
            logger.warning(
                "Slow request method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
                request_id,
            )

        response.headers["X-Request-ID"] = request_id
        for header, value in _rate_limit_headers(decision).items():
            response.headers.setdefault(header, value)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if request.url.path.startswith("/api/v1"):
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        docs_path = request.url.path in {"/docs", "/redoc", "/openapi.json"}
        if settings.is_production or not docs_path:
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


def add_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", request_id_var.get())
        message = str(exc.detail) if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={
                "code": f"http_{exc.status_code}",
                "message": message,
                "field_errors": {},
                "request_id": request_id,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        field_errors: dict[str, list[str]] = {}
        for error in exc.errors():
            field = ".".join(str(part) for part in error.get("loc", [])[1:]) or "request"
            field_errors.setdefault(field, []).append(str(error.get("msg", "Invalid value")))
        return JSONResponse(
            status_code=422,
            content={
                "code": "validation_error",
                "message": "Check the highlighted values.",
                "field_errors": field_errors,
                "request_id": getattr(request.state, "request_id", request_id_var.get()),
            },
        )

    @app.exception_handler(SQLAlchemyTimeoutError)
    async def database_busy(request: Request, exc: SQLAlchemyTimeoutError):
        request_id = getattr(request.state, "request_id", request_id_var.get())
        logger.warning("Database pool exhausted [%s]: %s", request_id, exc)
        return JSONResponse(
            status_code=503,
            headers={"Retry-After": "1"},
            content={
                "code": "database_busy",
                "message": "The service is busy. Try again shortly.",
                "field_errors": {},
                "request_id": request_id,
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", request_id_var.get())
        logger.exception("Unhandled request error [%s]", request_id, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={
                "code": "internal_error",
                "message": "The request could not be completed.",
                "field_errors": {},
                "request_id": request_id,
            },
        )
