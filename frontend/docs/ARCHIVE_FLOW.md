# Archive flow

## Components

```text
React Data Archive page
        ↓
FastAPI archive API
        ↓
archives + archive_jobs tables
        ↓
standalone archive worker
        ↓
private local storage adapter
```

## Start locally

Terminal 1 — API:

```bash
uvicorn app.main:app --reload
```

Terminal 2 — archive worker:

```bash
python -m app.workers.archive_worker
```

The worker polls the database. It does not require Redis or Celery.

## Project archive

1. Project must be completed.
2. Admin requests archive.
3. Project is locked.
4. API creates an archive and queued job.
5. Worker exports project, customer, agent, quotation, transaction, timeline, approval and event data.
6. Worker copies linked documents.
7. Worker generates project and approved-quotation PDFs.
8. Worker creates `checksums.sha256` and `manifest.json`.
9. Worker creates a ZIP using disk/chunked file operations.
10. Worker verifies each file and the ZIP checksum.
11. Archive becomes `ready`; original data remains during retention.

## Agent transaction archive

- Select agent and date range.
- Only approved, unarchived transactions are included.
- JSON and CSV are exported.
- Opening, debit, credit and closing totals are stored.
- Archived detail leaves the live transaction list, while the agent balance remains unchanged.

## Customer archive

Customer archive is blocked when:

- Outstanding balance is greater than zero
- An active project remains
- A quotation is pending, under condition or ready for a decision
- Another active customer archive already exists

Project archive never automatically archives the whole customer. A customer archive includes customer documents, quotations, completed project snapshots and their timelines. Completed unarchived projects are locked under the customer archive; cleanup may remove their timeline detail, and restore recreates it.

## Archive folder

```text
storage/archives/{company_id}/{archive_id}/
├── manifest.json
├── checksums.sha256
├── data/
├── documents/
├── reports/
└── packages/{reference}-archive.zip
```

The structured folder is canonical. The ZIP is the download package and can be regenerated. The archive table shows the customer or agent and the related project without opening the package.

## Cleanup

Cleanup requires a verified `ready` archive and the retention date. Only a super admin may override retention.

Cleanup removes eligible active file copies and large detail rows in batches. It preserves archive metadata, audit history and searchable core business/financial index records.

## Restore

Restore verifies the package first, restores eligible files and detail records, clears archive markers and records an event. It does not overwrite an unrelated active project.

## Purge

Purge is available only after `cleaned` or `restored` status. It requires:

- Super-admin permission
- Login within the last 15 minutes
- Exact `PURGE {reference}` phrase
- A reason
- An idempotency key

Purge removes the structured package and ZIP. The append-only audit entry and archive index row remain with `purged` status.

## Failure handling

- Original data is not deleted during package creation.
- Partial archive directories are replaced on retry.
- Failed project creation unlocks the project.
- A worker job running beyond the configured timeout is marked failed and recovered safely.
- One active job is allowed per archive.
