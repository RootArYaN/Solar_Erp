from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _engine_options() -> dict:
    options: dict = {"pool_pre_ping": True}
    if settings.database_url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
    else:
        options["pool_size"] = settings.db_pool_size
        options["max_overflow"] = settings.db_max_overflow
        options["pool_recycle"] = 1800
    return options


engine = create_engine(settings.database_url, **_engine_options())
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
