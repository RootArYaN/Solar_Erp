from __future__ import annotations

import argparse
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import bindparam, inspect, text

from app.db.base import Base
from app.db.session import engine
import app.models  # noqa: F401 - registers model metadata

MIGRATION_ID = "005_remove_archive_concept_postgresql"

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
    "audit_events": {"updated_at": "TIMESTAMPTZ"},
    "company_loans": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "customer_loans": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "bills": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "financial_accounts": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "stored_files": {"version": "INTEGER NOT NULL DEFAULT 1", "updated_at": "TIMESTAMPTZ"},
    "posters": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "inventory_locations": {"version": "INTEGER NOT NULL DEFAULT 1"},
    "inventory_items": {"version": "INTEGER NOT NULL DEFAULT 1"},
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
    ("ix_agent_transactions_project_id", "agent_transactions", "project_id"),
    ("ix_agent_customers_consumer_number", "agent_customers", "consumer_number"),
    ("ix_agent_customers_customer_type", "agent_customers", "customer_type"),
    ("ix_customer_projects_payment_mode", "customer_projects", "payment_mode"),
]


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
    if inspector.has_table("stored_files"):
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


def run_migrations() -> None:
    if engine.dialect.name != "postgresql":
        raise RuntimeError("Solar ERP migrations support PostgreSQL only")

    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "id VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL)"
        ))
        applied = connection.execute(
            text("SELECT id FROM schema_migrations WHERE id = :id"), {"id": MIGRATION_ID}
        ).scalar_one_or_none()
        inspector = inspect(connection)

        for table, columns in COLUMN_DEFINITIONS.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name not in existing:
                    connection.execute(text(
                        f'ALTER TABLE "{table}" ADD COLUMN "{name}" {definition}'
                    ))

        for index_name, table, columns in INDEXES:
            if inspector.has_table(table):
                column_sql = ", ".join(f'"{item.strip()}"' for item in columns.split(","))
                connection.execute(text(
                    f'CREATE INDEX IF NOT EXISTS "{index_name}" ON "{table}" ({column_sql})'
                ))

        if not applied:
            _remove_archive_schema(connection, inspector)
            _migrate_permissions(connection, inspector)
            connection.execute(
                text("INSERT INTO schema_migrations (id, applied_at) VALUES (:id, :applied_at)"),
                {"id": MIGRATION_ID, "applied_at": datetime.now(UTC)},
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Solar ERP PostgreSQL migrations")
    parser.add_argument("command", choices=["upgrade", "status"], default="upgrade", nargs="?")
    args = parser.parse_args()
    if args.command == "upgrade":
        run_migrations()
        print(f"Applied migration {MIGRATION_ID}")
        return
    with engine.connect() as connection:
        if not inspect(connection).has_table("schema_migrations"):
            print("No migrations applied")
            return
        rows = connection.execute(text("SELECT id, applied_at FROM schema_migrations ORDER BY applied_at")).all()
        for migration_id, applied_at in rows:
            print(f"{migration_id}: {applied_at}")


if __name__ == "__main__":
    main()
