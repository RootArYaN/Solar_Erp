from __future__ import annotations

from uuid import uuid4
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.request_context import request_id_var

logger = logging.getLogger(__name__)


def add_request_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id", "")[:80] or str(uuid4())
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-Frame-Options"] = "DENY"
        docs_path = request.url.path in {"/docs", "/redoc", "/openapi.json"}
        if settings.is_production or not docs_path:
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
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

