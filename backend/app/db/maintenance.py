from __future__ import annotations

import argparse
from pathlib import Path

from app.core.config import settings
from app.db.session import engine


def optimize_database(compact: bool = False) -> None:
    dialect = engine.dialect.name
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        if dialect == "sqlite":
            connection.exec_driver_sql("PRAGMA optimize")
            if compact:
                connection.exec_driver_sql("VACUUM")
            return
        if dialect == "postgresql":
            if compact:
                raise RuntimeError("Automatic PostgreSQL compaction is disabled; do not run VACUUM FULL from this tool")
            connection.exec_driver_sql("VACUUM (ANALYZE)")
            return
        raise RuntimeError(f"Database maintenance is not configured for {dialect}")


def database_size() -> int | None:
    if engine.dialect.name != "sqlite":
        return None
    value = settings.database_url.removeprefix("sqlite:///")
    path = Path(value).expanduser()
    return path.stat().st_size if path.is_file() else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Run safe Solar ERP database maintenance")
    parser.add_argument("--compact", action="store_true", help="Run SQLite VACUUM after PRAGMA optimize")
    args = parser.parse_args()
    before = database_size()
    optimize_database(compact=args.compact)
    after = database_size()
    result = "Database maintenance completed"
    if before is not None and after is not None:
        result += f"; size {before} -> {after} bytes"
    print(result)


if __name__ == "__main__":
    main()
