import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from starlette.concurrency import run_in_threadpool

from app.api.routes import admin, agents, auth, customer_flow, dashboard, events, files, finance, health, notifications, operations, tasks, workflow
from app.core.concurrency import configure_thread_pool
from app.core.config import settings
from app.core.middleware import RequestBodyLimitMiddleware, add_error_handlers, add_request_middleware
from app.db.migrate import run_migrations
from app.db.seed import bootstrap_super_admin
from app.db.session import SessionLocal, engine

logger = logging.getLogger(__name__)


def _development_bootstrap() -> None:
    run_migrations()
    with SessionLocal() as db:
        bootstrap_super_admin(db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await configure_thread_pool()
    if settings.environment.lower() == "development":
        await run_in_threadpool(_development_bootstrap)
    logger.info(
        "Solar ERP started environment=%s db_pool=%s+%s thread_pool=%s",
        settings.environment,
        settings.db_pool_size,
        settings.db_max_overflow,
        settings.thread_pool_workers,
    )
    try:
        yield
    finally:
        await run_in_threadpool(engine.dispose)


app = FastAPI(
    title=settings.app_name,
    version="0.6.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

add_request_middleware(app)
add_error_handlers(app)

# Added before CORS so even 413 responses receive the configured browser headers.
app.add_middleware(RequestBodyLimitMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", settings.csrf_header_name],
    expose_headers=[
        "X-Request-ID",
        "Content-Disposition",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "Retry-After",
        settings.csrf_header_name,
    ],
)

app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(agents.router, prefix="/api/v1")
app.include_router(workflow.router, prefix="/api/v1")
app.include_router(customer_flow.router, prefix="/api/v1")
app.include_router(finance.router, prefix="/api/v1")
app.include_router(operations.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(files.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
