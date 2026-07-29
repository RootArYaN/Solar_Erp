from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.request_context import request_id_var
from app.core.security import decode_access_token, verify_csrf_token
from app.db.session import SessionLocal
from app.models.system import IdempotencyRecord

logger = logging.getLogger(__name__)
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
CSRF_BOOTSTRAP_PATHS = {"/api/v1/auth/login", "/api/v1/auth/refresh"}
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{8,80}$")
IDEMPOTENCY_BODY_LIMIT = 1024 * 1024
IDEMPOTENCY_RESPONSE_LIMIT = 2 * 1024 * 1024


def _error(status_code: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
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

    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        return None

    try:
        payload = decode_access_token(authorization.split(" ", 1)[1].strip())
    except jwt.PyJWTError:
        # The authentication dependency will return the canonical 401 response.
        return None

    auth_session_id = str(payload.get("auth_session_id") or "")
    csrf_token = request.headers.get(settings.csrf_header_name, "").strip()
    if not verify_csrf_token(csrf_token, auth_session_id):
        return _error(403, "csrf_rejected", "The request security token is missing or invalid.", request_id)
    return None


def _idempotency_claims(request: Request) -> tuple[str, str] | None:
    authorization = request.headers.get("authorization", "")
    if not authorization.lower().startswith("bearer "):
        return None
    try:
        payload = decode_access_token(authorization.split(" ", 1)[1].strip())
    except jwt.PyJWTError:
        return None
    company_id = str(payload.get("company_id") or "")
    membership_id = str(payload.get("membership_id") or "")
    return (company_id, membership_id) if company_id and membership_id else None


async def _request_fingerprint(request: Request) -> str:
    content_type = request.headers.get("content-type", "").lower()
    content_length = request.headers.get("content-length", "")
    body_hash = ""
    if not content_type.startswith("multipart/form-data"):
        body = await request.body()
        if len(body) <= IDEMPOTENCY_BODY_LIMIT:
            body_hash = hashlib.sha256(body).hexdigest()
        else:
            body_hash = f"large:{len(body)}:{hashlib.sha256(body[:IDEMPOTENCY_BODY_LIMIT]).hexdigest()}"
    else:
        # Avoid buffering large uploads a second time. The random request key,
        # route, content type, and declared size form the multipart fingerprint.
        body_hash = f"multipart:{content_type}:{content_length}"
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
    request_path = request.url.path[:500]
    request_hash = await _request_fingerprint(request)
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=settings.idempotency_ttl_hours)
    processing_cutoff = now - timedelta(seconds=settings.idempotency_processing_timeout_seconds)

    record_id: str | None = None
    with SessionLocal() as db:
        db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.expires_at <= now))
        record = db.scalar(select(IdempotencyRecord).where(
            IdempotencyRecord.company_id == company_id,
            IdempotencyRecord.membership_id == membership_id,
            IdempotencyRecord.request_key == request_key,
            IdempotencyRecord.method == method,
            IdempotencyRecord.request_path == request_path,
        ))
        if record:
            if record.request_hash != request_hash:
                db.commit()
                return _error(409, "idempotency_conflict", "This request key was already used for different data.", request_id)
            if record.status == "completed" and record.response_status is not None:
                response = _cached_response(record)
                db.commit()
                return response
            if record.created_at > processing_cutoff:
                db.commit()
                return _error(409, "idempotency_in_progress", "The original request is still being processed.", request_id)
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
            return _error(409, "idempotency_in_progress", "The original request is already being processed.", request_id)
        record_id = record.id

    try:
        original = await call_next(request)
        body = b"".join([chunk async for chunk in original.body_iterator])
        response_headers = dict(original.headers)
        response_headers.pop("content-length", None)
        response = Response(
            content=body,
            status_code=original.status_code,
            headers=response_headers,
            media_type=original.media_type,
            background=original.background,
        )
    except Exception:
        if record_id:
            with SessionLocal() as db:
                db.execute(delete(IdempotencyRecord).where(IdempotencyRecord.id == record_id))
                db.commit()
        raise

    if record_id:
        with SessionLocal() as db:
            record = db.get(IdempotencyRecord, record_id)
            if record:
                if 200 <= response.status_code < 300 and len(body) <= IDEMPOTENCY_RESPONSE_LIMIT:
                    record.status = "completed"
                    record.response_status = response.status_code
                    record.response_body = body.decode("latin1")
                    record.response_content_type = response.headers.get("content-type", "application/json").split(";", 1)[0]
                    replay_headers = {}
                    if location := response.headers.get("location"):
                        replay_headers["Location"] = location
                    record.response_headers_json = json.dumps(replay_headers, separators=(",", ":"))
                else:
                    db.delete(record)
                db.commit()
    return response


def add_request_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        supplied_request_id = request.headers.get("x-request-id", "").strip()
        request_id = supplied_request_id if REQUEST_ID_PATTERN.fullmatch(supplied_request_id) else str(uuid4())
        token = request_id_var.set(request_id)
        try:
            rejection = _validate_browser_request(request, request_id)
            if rejection is not None:
                response = rejection
            else:
                response = await _with_idempotency(request, call_next, request_id)
        finally:
            request_id_var.reset(token)

        response.headers["X-Request-ID"] = request_id
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
        request_id = request_id_var.get()
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
                "request_id": request_id_var.get(),
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        request_id = request_id_var.get()
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
