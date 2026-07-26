import os
from pathlib import Path

import pytest

TEST_DB = Path(__file__).resolve().parent.parent / "test_solar_erp.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["ENVIRONMENT"] = "development"


@pytest.fixture(scope="session", autouse=True)
def clean_test_database():
    TEST_DB.unlink(missing_ok=True)
    from app.db.migrate import run_migrations
    from app.db.seed import seed_demo_data
    from app.db.session import SessionLocal

    run_migrations()
    with SessionLocal() as db:
        seed_demo_data(db)
    yield
    from app.db.session import engine

    engine.dispose()
    TEST_DB.unlink(missing_ok=True)
