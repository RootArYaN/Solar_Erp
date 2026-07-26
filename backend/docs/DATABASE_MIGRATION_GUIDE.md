# Database migration guide

## Migration type

The patch uses one small additive runner in `app/db/migrate.py`. It creates the new archive/security tables, adds nullable archive fields to existing records, inserts the archive permission catalogue and assigns safe defaults to existing `accounts_admin`, `company_admin` and `super_admin` roles. It does not delete existing business data.

## Before migration

1. Stop the API and archive worker.
2. Back up the database.
3. Back up the current document/storage directory.
4. Confirm the backup can be opened.

SQLite example:

```bash
cp solar_erp.db solar_erp.before_archive_patch.db
cp -R storage storage.before_archive_patch
```

PostgreSQL example:

```bash
pg_dump --format=custom --file=solar_erp_before_archive_patch.dump "$DATABASE_URL"
```

## Local SQLite upgrade

Set the environment and run:

```bash
export DATABASE_URL='sqlite:///./solar_erp.db'
export JWT_SECRET='replace-with-a-private-random-value-at-least-32-characters'
python -m app.db.migrate upgrade
python -m app.db.migrate status
```

The API runs this migration automatically only when `ENVIRONMENT=development`. Production never changes the schema automatically.

## PostgreSQL upgrade later

1. Create a managed PostgreSQL database.
2. Set `DATABASE_URL` to the production connection string.
3. Run the migration once from a controlled release job:

```bash
ENVIRONMENT=production \
SESSION_COOKIE_SECURE=true \
FRONTEND_ORIGINS='https://erp.example.com' \
JWT_SECRET='a-long-private-random-secret' \
python -m app.db.migrate upgrade
```

4. Start the API only after the migration succeeds.
5. Start one archive worker after the API is healthy.

## Tables created

- `auth_sessions`
- `archives`
- `archive_jobs`
- `audit_events`
- `stored_files`
- `schema_migrations`

## Permission data added

- `company_admin` and `super_admin` receive all archive/event permissions.
- `accounts_admin` receives archive view, download and event-history access.
- Agent, customer and custom roles are not granted archive permissions automatically. An administrator may assign them explicitly later.

## Existing columns added

- Project archive state and lock fields
- Customer archive state fields
- Agent transaction project/archive fields
- Archive job idempotency key

## Rollback

The migration is additive. The safest rollback is:

1. Stop the new API and worker.
2. Restore the pre-migration database backup.
3. Restore the pre-migration storage backup.
4. Deploy the previous frontend and backend together.

Do not drop archive columns while the new application is running. SQLite does not support every column rollback safely without rebuilding tables, so an automatic destructive downgrade is intentionally not provided.

## Cleanup maintenance

Cleanup and migration are separate operations.

Use the explicit maintenance command after a large controlled cleanup:

```bash
python -m app.db.maintenance
```

For SQLite, this runs `PRAGMA optimize`. To physically compact the SQLite file during a maintenance window, run:

```bash
python -m app.db.maintenance --compact
```

For PostgreSQL, the command runs `VACUUM (ANALYZE)`. Normal autovacuum should remain enabled. The application never schedules `VACUUM FULL` because it rewrites and locks tables.

A cleanup can make database pages reusable without immediately reducing the physical database file. File-storage bytes and physical database bytes must be reported separately.
