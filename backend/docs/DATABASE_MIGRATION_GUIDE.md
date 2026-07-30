# Database migration guide

Solar ERP supports PostgreSQL only. Production API processes never apply
migrations at startup; run migrations once as a controlled release command.

## Safety guarantees

- Every upgrade runs in one PostgreSQL transaction.
- A PostgreSQL advisory transaction lock prevents concurrent release jobs.
- Applied migration IDs carry checksums; changed or unknown history stops the release.
- `Base.metadata.create_all()` is used only to initialize a new database or adopt
  a legacy database with no migration history. Existing versioned databases are
  changed only by explicit migrations.
- Destructive legacy migrations stage physical file deletion and restore files if
  the database transaction rolls back.
- A verified backup reference is mandatory before a production migration changes
  an existing database.

## Production release procedure

1. Stop writes or enter a maintenance window.
2. Create a managed PostgreSQL snapshot/backup.
3. Confirm the backup can be restored to a separate database.
4. Confirm the independent R2 backup completed and record its recovery job ID.
5. Rehearse the upgrade against a restored database copy.
6. Inspect migration state:

```bash
python -m app.db.migrate status
```

7. Run the release command using the verified backup/snapshot identifier:

```bash
python -m app.db.migrate upgrade \
  --backup-reference "snapshot-2026-07-29-001"
```

8. Run application smoke tests and then start the API.

A brand-new empty database does not require `--backup-reference`.

## Rollback

Schema downgrades are intentionally not automated because several historical
migrations remove obsolete data and columns. Roll back by stopping the new API,
restoring the recorded PostgreSQL snapshot and corresponding object-storage
version/recovery point, and deploying the previous application version.

Never edit an applied migration or its checksum. Add a new migration instead.
