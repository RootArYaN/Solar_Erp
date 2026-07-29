from collections.abc import Generator, Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


connect_options = (
    f"-c statement_timeout={settings.db_statement_timeout_ms} "
    f"-c idle_in_transaction_session_timeout={settings.db_idle_transaction_timeout_ms}"
)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout_seconds,
    pool_recycle=settings.db_pool_recycle_seconds,
    pool_use_lifo=True,
    connect_args={
        "sslmode": settings.database_sslmode,
        "connect_timeout": settings.db_connect_timeout_seconds,
        "application_name": "solar-erp-api",
        "options": connect_options,
    },
)
SessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    autoflush=False,
    expire_on_commit=False,
)


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db() -> Generator[Session, None, None]:
    with session_scope() as db:
        yield db
