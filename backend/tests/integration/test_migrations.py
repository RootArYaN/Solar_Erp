from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db.migrate import (
    ACTIVE_MIGRATION_IDS,
    HISTORICAL_MIGRATION_IDS,
    MIGRATION_CHECKSUMS,
    _load_and_verify_history,
)
from app.db.session import engine, session_scope


@pytest.mark.integration
def test_migration_history_is_current_and_checksummed(prepared_database):
    with session_scope() as db:
        rows = db.execute(text(
            "SELECT id, checksum FROM schema_migrations ORDER BY applied_at, id"
        )).all()

    applied = {str(row.id): str(row.checksum) for row in rows}
    assert set(ACTIVE_MIGRATION_IDS).issubset(applied)
    for migration_id in ACTIVE_MIGRATION_IDS:
        assert applied[migration_id] == MIGRATION_CHECKSUMS[migration_id]


@pytest.mark.integration
def test_historical_migration_ids_are_recognized_and_checksummed(prepared_database):
    migration_id = HISTORICAL_MIGRATION_IDS[0]
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(
                text(
                    "INSERT INTO schema_migrations (id, checksum, applied_at) "
                    "VALUES (:id, NULL, CURRENT_TIMESTAMP) "
                    "ON CONFLICT (id) DO UPDATE SET checksum = NULL"
                ),
                {"id": migration_id},
            )
            applied = _load_and_verify_history(connection)
            checksum = connection.execute(
                text("SELECT checksum FROM schema_migrations WHERE id = :id"),
                {"id": migration_id},
            ).scalar_one()
            assert migration_id in applied
            assert checksum == MIGRATION_CHECKSUMS[migration_id]
        finally:
            transaction.rollback()


@pytest.mark.integration
def test_unknown_migration_id_is_still_rejected(prepared_database):
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(
                text(
                    "INSERT INTO schema_migrations (id, checksum, applied_at) "
                    "VALUES ('999_unknown_future_migration', NULL, CURRENT_TIMESTAMP)"
                )
            )
            with pytest.raises(RuntimeError, match="newer than this application"):
                _load_and_verify_history(connection)
        finally:
            transaction.rollback()
