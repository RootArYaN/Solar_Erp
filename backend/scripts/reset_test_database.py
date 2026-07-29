from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def _database_name(database_url: str) -> str:
    return (make_url(database_url).database or "").strip()


def _assert_safe(database_url: str, confirmation: str) -> str:
    name = _database_name(database_url)
    environment = os.getenv("ENVIRONMENT", "test").strip().lower()
    if environment == "production":
        raise RuntimeError("Database reset is disabled in production")
    if not name or not any(token in name.lower() for token in ("test", "perf")):
        raise RuntimeError("Refusing to reset a database whose name does not contain 'test' or 'perf'")
    if confirmation != name:
        raise RuntimeError(f"Confirmation must exactly match database name: {name}")
    return name


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the isolated Solar ERP PostgreSQL test schema")
    parser.add_argument("--confirm", required=True, help="Exact test database name")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    name = _assert_safe(database_url, args.confirm)

    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
            connection.execute(text("GRANT ALL ON SCHEMA public TO CURRENT_USER"))
            connection.execute(text("GRANT ALL ON SCHEMA public TO public"))
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_stat_statements"))
    finally:
        engine.dispose()

    print(f"Reset completed for {name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Reset failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
