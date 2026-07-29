from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text

from app.db.session import engine


def _rows(connection, sql: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in connection.execute(text(sql), parameters or {}).all()]


def _scalar(connection, sql: str) -> Any:
    return connection.execute(text(sql)).scalar_one_or_none()


def collect() -> dict[str, Any]:
    with engine.connect() as connection:
        report: dict[str, Any] = {
            "generated_at": datetime.now(UTC).isoformat(),
            "database": _scalar(connection, "SELECT current_database()"),
            "postgres_version": _scalar(connection, "SHOW server_version"),
            "database_size_bytes": _scalar(
                connection,
                "SELECT pg_database_size(current_database())",
            ),
            "settings": {
                row["name"]: row["setting"]
                for row in _rows(
                    connection,
                    """
                    SELECT name, setting
                    FROM pg_settings
                    WHERE name IN (
                        'max_connections', 'shared_buffers', 'effective_cache_size',
                        'work_mem', 'maintenance_work_mem', 'jit',
                        'statement_timeout', 'idle_in_transaction_session_timeout'
                    )
                    ORDER BY name
                    """,
                )
            },
            "connections": _rows(
                connection,
                """
                SELECT state, count(*) AS count
                FROM pg_stat_activity
                WHERE datname = current_database()
                GROUP BY state
                ORDER BY state NULLS FIRST
                """,
            ),
            "long_transactions": _rows(
                connection,
                """
                SELECT pid, usename, application_name, state,
                       EXTRACT(EPOCH FROM (clock_timestamp() - xact_start))::bigint AS seconds,
                       left(query, 240) AS query
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND xact_start IS NOT NULL
                  AND pid <> pg_backend_pid()
                ORDER BY xact_start
                LIMIT 20
                """,
            ),
            "blocked_queries": _rows(
                connection,
                """
                SELECT blocked.pid AS blocked_pid,
                       blocker.pid AS blocker_pid,
                       left(blocked.query, 200) AS blocked_query,
                       left(blocker.query, 200) AS blocker_query
                FROM pg_stat_activity blocked
                JOIN pg_locks blocked_locks ON blocked_locks.pid = blocked.pid AND NOT blocked_locks.granted
                JOIN pg_locks blocker_locks
                  ON blocker_locks.locktype = blocked_locks.locktype
                 AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
                 AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
                 AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
                 AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
                 AND blocker_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
                 AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
                 AND blocker_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
                 AND blocker_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
                 AND blocker_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
                 AND blocker_locks.pid <> blocked_locks.pid
                JOIN pg_stat_activity blocker ON blocker.pid = blocker_locks.pid
                WHERE blocker_locks.granted
                LIMIT 20
                """,
            ),
            "table_activity": _rows(
                connection,
                """
                SELECT relname AS table_name,
                       n_live_tup AS estimated_rows,
                       seq_scan, idx_scan,
                       n_tup_ins, n_tup_upd, n_tup_del,
                       n_dead_tup,
                       last_analyze, last_autoanalyze
                FROM pg_stat_user_tables
                ORDER BY n_live_tup DESC
                LIMIT 50
                """,
            ),
            "largest_relations": _rows(
                connection,
                """
                SELECT relname AS relation,
                       pg_total_relation_size(relid) AS total_bytes,
                       pg_relation_size(relid) AS table_bytes,
                       pg_indexes_size(relid) AS index_bytes
                FROM pg_catalog.pg_statio_user_tables
                ORDER BY pg_total_relation_size(relid) DESC
                LIMIT 30
                """,
            ),
            "unused_indexes": _rows(
                connection,
                """
                SELECT schemaname, relname AS table_name, indexrelname AS index_name,
                       idx_scan, pg_relation_size(indexrelid) AS index_bytes
                FROM pg_stat_user_indexes
                WHERE idx_scan = 0
                  AND indexrelname NOT LIKE '%_pkey'
                ORDER BY pg_relation_size(indexrelid) DESC
                LIMIT 40
                """,
            ),
            "sequential_scan_candidates": _rows(
                connection,
                """
                SELECT relname AS table_name, seq_scan, seq_tup_read, idx_scan, n_live_tup
                FROM pg_stat_user_tables
                WHERE seq_scan > 0
                ORDER BY seq_tup_read DESC
                LIMIT 30
                """,
            ),
        }

        extension_exists = bool(
            _scalar(connection, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')")
        )
        report["pg_stat_statements_available"] = extension_exists
        if extension_exists:
            try:
                report["top_statements"] = _rows(
                    connection,
                    """
                    SELECT calls,
                           round(total_exec_time::numeric, 2) AS total_exec_ms,
                           round(mean_exec_time::numeric, 2) AS mean_exec_ms,
                           rows,
                           shared_blks_hit,
                           shared_blks_read,
                           temp_blks_written,
                           left(query, 500) AS query
                    FROM pg_stat_statements
                    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                      AND query NOT ILIKE '%pg_stat_statements%'
                    ORDER BY total_exec_time DESC
                    LIMIT 30
                    """,
                )
            except Exception as exc:  # extension can exist without preload
                report["top_statements_error"] = str(exc)
        return report


def _print_summary(report: dict[str, Any]) -> None:
    print(f"Database: {report['database']}")
    print(f"PostgreSQL: {report['postgres_version']}")
    print(f"Size: {report['database_size_bytes']} bytes")
    print("Connections:", report["connections"])
    print("Largest relations:")
    for row in report["largest_relations"][:10]:
        print(f"  {row['relation']}: {row['total_bytes']} bytes")
    print("Top statements:")
    for row in report.get("top_statements", [])[:10]:
        print(f"  calls={row['calls']} mean_ms={row['mean_exec_ms']} total_ms={row['total_exec_ms']} {row['query']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect PostgreSQL performance diagnostics")
    parser.add_argument("--output", type=Path, help="Write full JSON report")
    args = parser.parse_args()
    report = collect()
    _print_summary(report)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"Report written to {args.output}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Database inspection failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    finally:
        engine.dispose()
