from __future__ import annotations

import argparse

from sqlalchemy import text

from app.db.session import engine


def optimize_database() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Solar ERP supports PostgreSQL only")
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.exec_driver_sql("VACUUM (ANALYZE)")


def database_size() -> int:
    with engine.connect() as connection:
        return int(connection.execute(text("SELECT pg_database_size(current_database())")).scalar_one())


def main() -> None:
    argparse.ArgumentParser(description="Run PostgreSQL maintenance for Solar ERP").parse_args()
    before = database_size()
    optimize_database()
    after = database_size()
    print(f"PostgreSQL maintenance completed; size {before} -> {after} bytes")


if __name__ == "__main__":
    main()
