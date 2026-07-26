from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, agents, archives, auth, customer_flow, dashboard, files, finance, health, operations, workflow
from app.core.config import settings
from app.core.middleware import add_error_handlers, add_request_middleware
from app.db.migrate import run_migrations
from app.db.seed import seed_development_data
from app.db.session import SessionLocal


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.environment.lower() == "development":
        run_migrations()
        with SessionLocal() as db:
            seed_development_data(db)
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.2.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

add_request_middleware(app)
add_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
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
app.include_router(archives.router, prefix="/api/v1")
