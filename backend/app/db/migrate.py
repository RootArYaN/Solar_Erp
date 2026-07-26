from __future__ import annotations

import argparse
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import inspect, text

from app.db.base import Base
from app.db.session import engine
import app.models  # noqa: F401 - registers model metadata

MIGRATION_ID = "002_b2c_finance_operations"

MIGRATED_PERMISSIONS = {
    "archive.view": ("View data archive", "View archive packages and job history."),
    "archive.create": ("Create archives", "Create project, customer and transaction archives."),
    "archive.download": ("Download archives", "Download verified archive ZIP packages."),
    "archive.verify": ("Verify archives", "Verify archive files and checksums."),
    "archive.cleanup": ("Clean archived data", "Remove eligible active copies after archive verification."),
    "archive.restore": ("Restore archives", "Restore records and files from an archive."),
    "archive.purge": ("Purge archives", "Permanently remove archive packages."),
    "events.view": ("View event history", "View the append-only event history."),
    "finance.view": ("View finance", "View ledgers, bills, accounts and company financial reports."),
    "finance.manage": ("Manage finance", "Create and post finance transactions, bills and account movements."),
}

ROLE_MIGRATED_PERMISSIONS = {
    "accounts_admin": {"archive.view", "archive.download", "events.view", "finance.view", "finance.manage"},
    "company_admin": set(MIGRATED_PERMISSIONS),
    "super_admin": set(MIGRATED_PERMISSIONS),
}

COLUMN_DEFINITIONS = {
    "customer_projects": {
        "archived_at": "TIMESTAMP",
        "archived_by": "VARCHAR(36)",
        "archive_id": "VARCHAR(36)",
        "is_locked": "BOOLEAN NOT NULL DEFAULT 0",
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
        "archived_at": "TIMESTAMP",
        "archived_by": "VARCHAR(36)",
        "archive_id": "VARCHAR(36)",
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
    "agent_transactions": {
        "project_id": "VARCHAR(36)",
        "archived_at": "TIMESTAMP",
        "archived_by": "VARCHAR(36)",
        "archive_id": "VARCHAR(36)",
    },
    "archive_jobs": {
        "request_key": "VARCHAR(80)",
    },
}

INDEXES = [
    ("ix_customer_projects_archive_id", "customer_projects", "archive_id"),
    ("ix_agent_customers_archive_id", "agent_customers", "archive_id"),
    ("ix_agent_transactions_project_id", "agent_transactions", "project_id"),
    ("ix_agent_transactions_archive_id", "agent_transactions", "archive_id"),
    ("uq_archive_jobs_company_request_key", "archive_jobs", "company_id, request_key"),
    ("ix_agent_customers_consumer_number", "agent_customers", "consumer_number"),
    ("ix_agent_customers_customer_type", "agent_customers", "customer_type"),
    ("ix_customer_projects_payment_mode", "customer_projects", "payment_mode"),
]


def _column_sql(dialect: str, definition: str) -> str:
    if dialect == "postgresql":
        return definition.replace("TIMESTAMP", "TIMESTAMP WITH TIME ZONE").replace("DEFAULT 0", "DEFAULT FALSE")
    return definition



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
                if assigned:
                    continue
                connection.execute(text(
                    "INSERT INTO role_permissions (role_id, permission_id) "
                    "VALUES (:role_id, :permission_id)"
                ), {"role_id": role_id, "permission_id": permission_id})

def run_migrations() -> None:
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "id VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL)"
        ))
        applied = connection.execute(
            text("SELECT id FROM schema_migrations WHERE id = :id"), {"id": MIGRATION_ID}
        ).scalar_one_or_none()
        inspector = inspect(connection)
        dialect = connection.dialect.name
        for table, columns in COLUMN_DEFINITIONS.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, definition in columns.items():
                if name in existing:
                    continue
                connection.execute(text(
                    f'ALTER TABLE "{table}" ADD COLUMN "{name}" {_column_sql(dialect, definition)}'
                ))

        for index_name, table, columns in INDEXES:
            if not inspector.has_table(table):
                continue
            column_sql = ", ".join(f'"{item.strip()}"' for item in columns.split(","))
            unique = "UNIQUE " if index_name.startswith("uq_") else ""
            connection.execute(text(
                f'CREATE {unique}INDEX IF NOT EXISTS "{index_name}" ON "{table}" ({column_sql})'
            ))

        if not applied:
            _migrate_permissions(connection, inspector)
            connection.execute(
                text("INSERT INTO schema_migrations (id, applied_at) VALUES (:id, :applied_at)"),
                {"id": MIGRATION_ID, "applied_at": datetime.now(UTC)},
            )


def main() -> None:
    parser = argparse.ArgumentParser(description="Solar ERP database migrations")
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
