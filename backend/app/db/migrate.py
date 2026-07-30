from __future__ import annotations

import argparse
import hashlib
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import bindparam, inspect, text

from app.db.base import Base
from app.core.config import settings
from app.db.session import engine
from app.services.storage import storage
import app.models  # noqa: F401 - registers model metadata

MIGRATION_005 = "005_remove_archive_concept_postgresql"
MIGRATION_006 = "006_remove_file_soft_delete"
MIGRATION_007 = "007_backend_performance_indexes"
MIGRATION_008 = "008_measured_read_path_indexes"
MIGRATION_009 = "009_transactional_migration_framework"
CURRENT_MIGRATION_ID = MIGRATION_009
MIGRATION_LOCK_KEY = 7_336_526_977_082_001

# These IDs were written by earlier released versions whose migration logic was
# consolidated into the current PostgreSQL baseline. They remain trusted
# history entries but must never be treated as pending work on a fresh database.
HISTORICAL_MIGRATION_IDS = (
    "002_b2c_finance_operations",
    "003_editable_record_versions",
    "004_generated_document_packs",
    "006_inventory_challan_batches_postgresql",
)
ACTIVE_MIGRATION_IDS = (
    MIGRATION_005,
    MIGRATION_006,
    MIGRATION_007,
    MIGRATION_008,
    MIGRATION_009,
)
MIGRATION_IDS = HISTORICAL_MIGRATION_IDS + ACTIVE_MIGRATION_IDS
MIGRATION_CHECKSUMS = {
    migration_id: hashlib.sha256(f"solar-erp:{migration_id}:v1".encode("utf-8")).hexdigest()
    for migration_id in MIGRATION_IDS
}
BACKUP_REQUIRED_MIGRATIONS = {
    MIGRATION_005,
    MIGRATION_006,
    MIGRATION_007,
    MIGRATION_008,
}

MIGRATED_PERMISSIONS = {
    "documents.view": ("Show Customer data tab", "View customer and project documents."),
    "documents.create": ("Create documents", "Create generated document packs and upload files."),
    "documents.edit": ("Edit documents", "Change generated document drafts and metadata."),
    "documents.approve": ("Approve documents", "Finalize generated document versions."),
    "documents.manage": ("Manage documents", "Manage shared company document templates and all document operations."),
    "events.view": ("View event history", "View the append-only event history."),
    "finance.view": ("View finance", "View ledgers, bills, accounts and company financial reports."),
    "finance.manage": ("Manage finance", "Create and post finance transactions, bills and account movements."),
}

ROLE_MIGRATED_PERMISSIONS = {
    "agent": {"documents.view", "documents.create", "documents.edit"},
    "accounts_admin": {"documents.view", "documents.approve", "documents.manage", "events.view", "finance.view", "finance.manage"},
    "company_admin": set(MIGRATED_PERMISSIONS),
    "super_admin": set(MIGRATED_PERMISSIONS),
}

REMOVED_PERMISSIONS = (
    "customers.archive",
    "sites.archive",
    "quotations.archive",
    "projects.archive",
    "material_requests.archive",
    "inventory.archive",
    "pricing.archive",
    "documents.archive",
    "posters.archive",
    "archive.view",
    "archive.create",
    "archive.download",
    "archive.verify",
    "archive.cleanup",
    "archive.restore",
    "archive.purge",
)

COLUMN_DEFINITIONS = {
    "auth_sessions": {
        "previous_refresh_hash": "VARCHAR(64)",
        "previous_refresh_valid_until": "TIMESTAMPTZ",
    },
    "audit_events": {"updated_at": "TIMESTAMPTZ"},
    "company_loans": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "customer_loans": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "bills": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "financial_accounts": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "stored_files": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "posters": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "inventory_locations": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "inventory_items": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "inventory_movements": {
        "source_location_manual": "VARCHAR(180) NOT NULL DEFAULT ''",
        "destination_location_manual": "VARCHAR(180) NOT NULL DEFAULT ''",
        "movement_group_id": "VARCHAR(36)",
        "challan_date": "DATE",
        "vehicle_number": "VARCHAR(32) NOT NULL DEFAULT ''",
        "driver_name": "VARCHAR(120) NOT NULL DEFAULT ''",
        "driver_phone": "VARCHAR(32) NOT NULL DEFAULT ''",
        "eway_bill_number": "VARCHAR(80) NOT NULL DEFAULT ''",
    },
    "customer_projects": {
        "site_address": "VARCHAR(320) NOT NULL DEFAULT ''",
        "payment_mode": "VARCHAR(12) NOT NULL DEFAULT ''",
        "loan_status": "VARCHAR(32) NOT NULL DEFAULT 'not_required'",
        "documentation_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "registration_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "material_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "installation_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "dcr_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "subsidy_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
        "subsidiary_payment_status": "VARCHAR(32) NOT NULL DEFAULT 'pending'",
    },
    "agent_customers": {
        "alternate_phone": "VARCHAR(32) NOT NULL DEFAULT ''",
        "billing_address": "VARCHAR(320) NOT NULL DEFAULT ''",
        "site_address": "VARCHAR(320) NOT NULL DEFAULT ''",
        "district": "VARCHAR(80) NOT NULL DEFAULT ''",
        "state": "VARCHAR(80) NOT NULL DEFAULT 'Gujarat'",
        "postal_code": "VARCHAR(16) NOT NULL DEFAULT ''",
        "consumer_number": "VARCHAR(80) NOT NULL DEFAULT ''",
        "electricity_provider": "VARCHAR(100) NOT NULL DEFAULT ''",
        "customer_type": "VARCHAR(32) NOT NULL DEFAULT 'residential'",
        "lead_source": "VARCHAR(80) NOT NULL DEFAULT ''",
    },
    "agent_transactions": {"project_id": "VARCHAR(36)"},
}

INDEXES = [
    ("ix_auth_sessions_previous_refresh_hash", "auth_sessions", "previous_refresh_hash"),
    ("ix_agent_transactions_project_id", "agent_transactions", "project_id"),
    ("ix_agent_customers_consumer_number", "agent_customers", "consumer_number"),
    ("ix_agent_customers_customer_type", "agent_customers", "customer_type"),
    ("ix_customer_projects_payment_mode", "customer_projects", "payment_mode"),
    ("ix_inventory_movements_group_id", "inventory_movements", "movement_group_id"),
    # Read-path indexes chosen from the actual list, approval, finance and audit queries.
    ("ix_agent_customers_company_updated", "agent_customers", "company_id,updated_at"),
    ("ix_agent_customers_company_status_updated", "agent_customers", "company_id,status,updated_at"),
    ("ix_agent_transactions_agent_date", "agent_transactions", "agent_profile_id,transaction_date"),
    ("ix_quotation_requests_company_created", "quotation_requests", "company_id,created_at"),
    ("ix_quotation_requests_customer_status", "quotation_requests", "customer_id,status"),
    ("ix_transaction_approvals_company_status_created", "transaction_approvals", "company_id,status,created_at"),
    ("ix_customer_projects_company_created", "customer_projects", "company_id,created_at"),
    ("ix_customer_projects_customer_created", "customer_projects", "customer_id,created_at"),
    ("ix_finance_transactions_company_date_created", "finance_transactions", "company_id,transaction_date,created_at"),
    ("ix_bills_company_date_created", "bills", "company_id,bill_date,created_at"),
    ("ix_bills_company_payment_due", "bills", "company_id,payment_status,due_date"),
    ("ix_audit_events_company_created", "audit_events", "company_id,created_at"),
    ("ix_stored_files_company_created", "stored_files", "company_id,created_at"),
    ("ix_stored_files_company_owner", "stored_files", "company_id,owner_type,owner_id"),
    ("ix_posters_company_status_created", "posters", "company_id,status,created_at"),
    # Phase 3 indexes selected from the first constrained PostgreSQL load report.
    ("ix_customer_projects_company_status_updated", "customer_projects", "company_id,status,updated_at"),
    ("ix_project_timelines_company_step", "project_timelines", "company_id,current_step"),
    ("ix_finance_transactions_company_status_date", "finance_transactions", "company_id,status,transaction_date"),
    ("ix_bills_company_type_status", "bills", "company_id,bill_type,status"),
    ("ix_inventory_balances_company_item", "inventory_balances", "company_id,item_id"),
]



def _column_names(inspector, table: str) -> set[str]:
    if not inspector.has_table(table):
        return set()
    return {str(column["name"]) for column in inspector.get_columns(table)}


def _ensure_migration_history(connection) -> None:
    connection.execute(text(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "id VARCHAR(80) PRIMARY KEY, "
        "checksum VARCHAR(64), "
        "applied_at TIMESTAMPTZ NOT NULL)"
    ))
    connection.execute(text(
        "ALTER TABLE schema_migrations "
        "ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)"
    ))


def _load_and_verify_history(connection) -> set[str]:
    rows = connection.execute(text(
        "SELECT id, checksum FROM schema_migrations ORDER BY applied_at, id"
    )).all()
    applied = {str(row.id) for row in rows}
    unknown = sorted(applied - set(MIGRATION_IDS))
    if unknown:
        raise RuntimeError(
            "Database migration history is newer than this application: "
            + ", ".join(unknown)
        )
    for row in rows:
        migration_id = str(row.id)
        expected = MIGRATION_CHECKSUMS[migration_id]
        checksum = str(row.checksum or "")
        if checksum and checksum != expected:
            raise RuntimeError(
                f"Migration checksum mismatch for {migration_id}; "
                "never edit an applied migration"
            )
        if not checksum:
            connection.execute(
                text("UPDATE schema_migrations SET checksum = :checksum WHERE id = :id"),
                {"id": migration_id, "checksum": expected},
            )
    return applied


def _record_migration(connection, migration_id: str) -> None:
    connection.execute(
        text(
            "INSERT INTO schema_migrations (id, checksum, applied_at) "
            "VALUES (:id, :checksum, :applied_at)"
        ),
        {
            "id": migration_id,
            "checksum": MIGRATION_CHECKSUMS[migration_id],
            "applied_at": datetime.now(UTC),
        },
    )


def _apply_columns_and_indexes(connection) -> None:
    inspector = inspect(connection)
    for table, columns in COLUMN_DEFINITIONS.items():
        if not inspector.has_table(table):
            continue
        existing = _column_names(inspector, table)
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(text(
                    f'ALTER TABLE "{table}" ADD COLUMN "{name}" {definition}'
                ))

    inspector = inspect(connection)
    for index_name, table, columns in INDEXES:
        if inspector.has_table(table):
            column_sql = ", ".join(f'"{item.strip()}"' for item in columns.split(","))
            connection.execute(text(
                f'CREATE INDEX IF NOT EXISTS "{index_name}" ON "{table}" ({column_sql})'
            ))

def _migrate_permissions(connection, inspector) -> None:
    required_tables = {"permissions", "roles", "role_permissions"}
    if not all(inspector.has_table(table) for table in required_tables):
        return

    now = datetime.now(UTC)
    permission_ids: dict[str, str] = {}
    for code, (name, description) in MIGRATED_PERMISSIONS.items():
        permission_id = connection.execute(
            text("SELECT id FROM permissions WHERE code = :code"), {"code": code}
        ).scalar_one_or_none()
        if not permission_id:
            permission_id = str(uuid4())
            connection.execute(text(
                "INSERT INTO permissions "
                "(id, code, name, description, created_at, updated_at) "
                "VALUES (:id, :code, :name, :description, :created_at, :updated_at)"
            ), {
                "id": permission_id,
                "code": code,
                "name": name,
                "description": description,
                "created_at": now,
                "updated_at": now,
            })
        permission_ids[code] = str(permission_id)

    for role_code, permission_codes in ROLE_MIGRATED_PERMISSIONS.items():
        role_ids = connection.execute(
            text("SELECT id FROM roles WHERE code = :code"), {"code": role_code}
        ).scalars().all()
        for role_id in role_ids:
            for permission_code in permission_codes:
                permission_id = permission_ids[permission_code]
                assigned = connection.execute(text(
                    "SELECT 1 FROM role_permissions "
                    "WHERE role_id = :role_id AND permission_id = :permission_id"
                ), {"role_id": role_id, "permission_id": permission_id}).scalar_one_or_none()
                if not assigned:
                    connection.execute(text(
                        "INSERT INTO role_permissions (role_id, permission_id) "
                        "VALUES (:role_id, :permission_id)"
                    ), {"role_id": role_id, "permission_id": permission_id})

    manage_id = permission_ids.get("documents.manage")
    if manage_id:
        agent_role_ids = connection.execute(
            text("SELECT id FROM roles WHERE code = 'agent'")
        ).scalars().all()
        for role_id in agent_role_ids:
            connection.execute(text(
                "DELETE FROM role_permissions "
                "WHERE role_id = :role_id AND permission_id = :permission_id"
            ), {"role_id": role_id, "permission_id": manage_id})


def _remove_archive_schema(connection, inspector) -> None:
    if inspector.has_table("agent_customers"):
        connection.execute(text("UPDATE agent_customers SET status = 'on_hold' WHERE status = 'archived'"))
    if inspector.has_table("customer_projects"):
        connection.execute(text("UPDATE customer_projects SET status = 'active' WHERE status = 'archived'"))
    if inspector.has_table("posters"):
        connection.execute(text("UPDATE posters SET status = 'active' WHERE status = 'archived'"))
    if "status" in _column_names(inspector, "stored_files"):
        connection.execute(text("UPDATE stored_files SET status = 'active' WHERE status = 'archived'"))

    for index_name in (
        "ix_customer_projects_archive_id",
        "ix_agent_customers_archive_id",
        "ix_agent_transactions_archive_id",
        "uq_archive_jobs_company_request_key",
    ):
        connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))

    removable_columns = {
        "agent_customers": ("archived_at", "archived_by", "archive_id"),
        "agent_transactions": ("archived_at", "archived_by", "archive_id"),
        "customer_projects": ("archived_at", "archived_by", "archive_id", "is_locked"),
        "stored_files": ("archived_at",),
    }
    for table, columns in removable_columns.items():
        if not inspector.has_table(table):
            continue
        for column in columns:
            connection.execute(text(f'ALTER TABLE "{table}" DROP COLUMN IF EXISTS "{column}" CASCADE'))

    connection.execute(text("DROP TABLE IF EXISTS archive_jobs CASCADE"))
    connection.execute(text("DROP TABLE IF EXISTS archives CASCADE"))

    if inspector.has_table("audit_events"):
        connection.execute(text(
            "DELETE FROM audit_events "
            "WHERE entity = 'archive' "
            "OR event LIKE 'archive.%' "
            "OR event IN ('customer.archived', 'customer.restored', 'document.archived', 'document.restored')"
        ))

    if all(inspector.has_table(table) for table in ("permissions", "role_permissions")):
        role_delete = text(
            "DELETE FROM role_permissions WHERE permission_id IN "
            "(SELECT id FROM permissions WHERE code IN :codes)"
        ).bindparams(bindparam("codes", expanding=True))
        permission_delete = text("DELETE FROM permissions WHERE code IN :codes").bindparams(
            bindparam("codes", expanding=True)
        )
        connection.execute(role_delete, {"codes": REMOVED_PERMISSIONS})
        connection.execute(permission_delete, {"codes": REMOVED_PERMISSIONS})



def _remove_file_soft_delete(connection, inspector) -> list[tuple[str, str]]:
    """Permanently remove legacy deleted files and drop soft-delete columns.

    Physical files are staged while the database transaction is open. The
    caller finalizes them only after commit; any error restores staged files.
    """
    if not inspector.has_table("stored_files"):
        return []

    columns = _column_names(inspector, "stored_files")
    staged: list[tuple[str, str]] = []
    try:
        deleted_ids: list[str] = []
        if "status" in columns:
            rows = connection.execute(text(
                "SELECT id, storage_path FROM stored_files WHERE status = 'deleted'"
            )).all()
            deleted_ids = [str(row.id) for row in rows]
            for row in rows:
                original = str(row.storage_path)
                staged_path = storage.stage_delete(original)
                if staged_path:
                    staged.append((staged_path, original))

        if deleted_ids:
            def expanded(statement: str):
                return text(statement).bindparams(bindparam("ids", expanding=True))

            if inspector.has_table("posters"):
                connection.execute(expanded("DELETE FROM posters WHERE file_id IN :ids"), {"ids": deleted_ids})
                connection.execute(
                    expanded("UPDATE posters SET thumbnail_file_id = NULL WHERE thumbnail_file_id IN :ids"),
                    {"ids": deleted_ids},
                )
            if inspector.has_table("finance_transactions"):
                connection.execute(
                    expanded("UPDATE finance_transactions SET receipt_file_id = NULL WHERE receipt_file_id IN :ids"),
                    {"ids": deleted_ids},
                )
            if inspector.has_table("bills"):
                connection.execute(
                    expanded("UPDATE bills SET file_id = NULL WHERE file_id IN :ids"),
                    {"ids": deleted_ids},
                )
            connection.execute(expanded("DELETE FROM stored_files WHERE id IN :ids"), {"ids": deleted_ids})

        for index_name in (
            "ix_stored_files_project_status",
            "ix_stored_files_customer_status",
        ):
            connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))

        for column in ("status", "deleted_at"):
            if column in columns:
                connection.execute(text(f'ALTER TABLE "stored_files" DROP COLUMN IF EXISTS "{column}" CASCADE'))

        connection.execute(text(
            'CREATE INDEX IF NOT EXISTS "ix_stored_files_project_created" '
            'ON "stored_files" ("project_id", "created_at")'
        ))
        connection.execute(text(
            'CREATE INDEX IF NOT EXISTS "ix_stored_files_customer_created" '
            'ON "stored_files" ("customer_id", "created_at")'
        ))
        return staged
    except Exception:
        for staged_path, original_path in reversed(staged):
            storage.restore_staged_delete(staged_path, original_path)
        raise


def run_migrations(*, backup_reference: str | None = None) -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Solar ERP migrations support PostgreSQL only")

    staged_deletes: list[tuple[str, str]] = []
    try:
        with engine.begin() as connection:
            acquired = connection.execute(
                text("SELECT pg_try_advisory_xact_lock(:key)"),
                {"key": MIGRATION_LOCK_KEY},
            ).scalar_one()
            if not acquired:
                raise RuntimeError(
                    "Another migration process holds the Solar ERP deployment lock"
                )

            tables_before = set(inspect(connection).get_table_names())
            history_existed = "schema_migrations" in tables_before
            application_tables = tables_before - {"schema_migrations", "alembic_version"}

            _ensure_migration_history(connection)
            applied = _load_and_verify_history(connection)
            pending = [
                migration_id
                for migration_id in ACTIVE_MIGRATION_IDS
                if migration_id not in applied
            ]
            backup_required = bool(application_tables) and (
                not history_existed
                or bool(BACKUP_REQUIRED_MIGRATIONS.intersection(pending))
            )
            if settings.is_production and backup_required:
                reference = (backup_reference or "").strip()
                if len(reference) < 8:
                    raise RuntimeError(
                        "Production migration requires --backup-reference with the "
                        "verified database/storage backup identifier"
                    )

            # create_all is a baseline operation only. Once migration history
            # exists, every schema change must be represented by a new migration.
            if not application_tables or not history_existed:
                Base.metadata.create_all(bind=connection)

            if MIGRATION_005 not in applied:
                _remove_archive_schema(connection, inspect(connection))
                _migrate_permissions(connection, inspect(connection))
                _record_migration(connection, MIGRATION_005)

            if MIGRATION_006 not in applied:
                staged_deletes = _remove_file_soft_delete(connection, inspect(connection))
                _record_migration(connection, MIGRATION_006)

            if MIGRATION_007 not in applied:
                _apply_columns_and_indexes(connection)
                _record_migration(connection, MIGRATION_007)

            if MIGRATION_008 not in applied:
                _apply_columns_and_indexes(connection)
                _record_migration(connection, MIGRATION_008)

            if MIGRATION_009 not in applied:
                _record_migration(connection, MIGRATION_009)
    except Exception:
        for staged_path, original_path in reversed(staged_deletes):
            storage.restore_staged_delete(staged_path, original_path)
        raise
    else:
        for staged_path, _original_path in staged_deletes:
            storage.finalize_staged_delete(staged_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Solar ERP PostgreSQL migrations")
    parser.add_argument("command", choices=["upgrade", "status"], default="upgrade", nargs="?")
    parser.add_argument(
        "--backup-reference",
        help="Verified backup/snapshot identifier required for changes to an existing production database",
    )
    args = parser.parse_args()
    if args.command == "upgrade":
        run_migrations(backup_reference=args.backup_reference)
        print(f"Applied migrations through {CURRENT_MIGRATION_ID}")
        return
    with engine.connect() as connection:
        if not inspect(connection).has_table("schema_migrations"):
            print("No migrations applied")
            return
        checksum_column = "checksum" in _column_names(inspect(connection), "schema_migrations")
        checksum_sql = "checksum" if checksum_column else "NULL AS checksum"
        rows = connection.execute(text(
            f"SELECT id, {checksum_sql}, applied_at "
            "FROM schema_migrations ORDER BY applied_at, id"
        )).all()
        applied = {str(row.id) for row in rows}
        for migration_id, checksum, applied_at in rows:
            print(f"{migration_id}: {applied_at} checksum={checksum or 'legacy-unverified'}")
        pending = [
            migration_id
            for migration_id in ACTIVE_MIGRATION_IDS
            if migration_id not in applied
        ]
        print("Pending: " + (", ".join(pending) if pending else "none"))


if __name__ == "__main__":
    main()
