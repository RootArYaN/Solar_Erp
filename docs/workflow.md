# Solar ERP Backend Foundation and Data Connection Plan

## Summary

Build a single-company modular monolith using FastAPI, PostgreSQL, Alembic, and S3-compatible object storage. The first phase establishes the foundation only: secure sessions, roles, audit history, archive/purge behavior, file storage, offline-sync primitives, migrations, and backups.

Existing development data will be reset. Current business pages remain usable while they are connected to backend modules incrementally.

Future data chain:

`Customer → Site → Pricing/Quotation revision → Approved Project → Material request → Stock reservation/dispatch → Installation → Documents → Finance/commission/service`

## Foundation Architecture

- Replace SQLite and runtime `create_all()` with local PostgreSQL and Alembic migrations.
- Use Docker Compose for PostgreSQL and MinIO locally; cloud deployment later swaps these for managed PostgreSQL and S3/R2 without changing application models.
- Keep one FastAPI modular monolith. Separate modules by routes, schemas, services, models, permissions, and events; do not introduce microservices or Redis.
- Use PostgreSQL-backed background jobs and an outbox table for document processing, thumbnails, notifications, and reliable cross-module events.
- Use normalized columns for searchable business data and JSONB only for audit payloads, template configuration, and flexible metadata.
- Use UUID internal IDs, separate human-readable numbering sequences, decimal money fields, UTC timestamps, and configurable India timezone/currency display.

## Identity, Roles, Security, and History

- Simplify the current multi-company schema to direct users, roles, permissions, sessions, and a singleton organization-settings record.
- Retain current roles and add `manager`, `inventory_logistics`, and `project_team`.
- Permission intent:
  - Customer: own projects and documents only.
  - Agent: assigned customer, quotation, project-draft, and document-draft access.
  - Project team: assigned projects, tasks, site updates, and material requests.
  - Inventory/logistics: catalogue, receiving, transfers, dispatch, and stock records.
  - Manager: operational approvals and physical stock posting.
  - Accounts admin: finance, agent ledger, billing, and document access.
  - Company admin/super admin: administration and protected maintenance.
- Enforce permissions and record ownership in every backend route; frontend hiding is never authorization.
- Continue bearer authentication with short-lived access tokens, rotating refresh tokens, server-side session/device records, logout/revocation, refresh-reuse detection, login history, and rate limiting.
- Scope browser storage by user and clear operational caches on logout. Sensitive document originals are never stored offline.
- Add immutable audit events for logins, permission changes, edits, approvals, archives, restores, purges, exports, downloads, and sensitive reads.
- Every editable record carries `created_by`, `updated_by`, timestamps, and an integer `version` for optimistic concurrency.

## Data Ownership and Automatic Connections

- Replace `AgentCustomer` as the master record with a central customer record. Each customer has one current agent and an immutable assignment history.
- Separate customer, contact, address, site, and project entities so addresses and consumer details are entered once.
- Pricing becomes:
  - Versioned master price book.
  - Catalogue-linked pricing components where applicable.
  - Editable quotation revisions containing immutable price, tax, description, and BOM snapshots.
  - Inventory cost changes may suggest new pricing but never rewrite existing quotations.
- Approving a quotation creates the project and approved snapshot only. Stock remains unchanged until a manager or inventory user approves a material request.
- Inventory later uses immutable movements, warehouse/location balances, reservations, transfers, receipts, dispatches, reversals, and adjustments. Historical movements cannot be edited or deleted.
- Customer documents automatically fetch customer, site, approved quotation, system capacity, panel/inverter, project, and agent data.
- Generated documents store the template version and source-data snapshot used to generate them.
- Posters become a permission-controlled organization media library and remain independent of customer/project records.
- Dashboard values come from summary endpoints rather than recomputing entire datasets in the browser.

## Files, Offline UX, Deletion, and Backups

- Store only file metadata in PostgreSQL. Store binaries privately in MinIO/S3 with checksums, versions, categories, ownership links, and upload status.
- Upload directly to object storage using signed multipart URLs; complete through the API after size/type/checksum validation.
- Serve short-lived signed download URLs, lazy previews, thumbnails, compressed images, and range-enabled PDFs to reduce bandwidth.
- Cache lists, summaries, drafts, document metadata, and redacted thumbnails in IndexedDB. Do not cache Aadhaar, PAN, licence, bank-proof, or other sensitive originals.
- Use a frontend outbox with client-generated idempotency keys. Customer edits, drafts, uploads, and material requests can queue offline.
- Stock and finance transactions may be drafted offline but become official only after online server validation.
- Use record versions and return `409 Conflict` with the current server version when an offline edit is stale.
- Default deletion is archive/restore. Referenced business records cannot be directly purged.
- Allow controlled administrator purge after a 30-day trash period. Immutable audit, stock, and financial history use reversals or tombstones instead of deletion.
- Perform nightly encrypted PostgreSQL and object-storage backups, targeting at most 24 hours of data loss. Retain 7 daily, 4 weekly, and 6 monthly backups, with checksums and periodic restore tests.

## Public Interfaces

- Authentication: login, refresh, logout, current session, active devices, revoke device.
- Administration: users, roles, permissions, organization settings, audit history.
- Files: initiate upload, complete upload, signed preview/download, archive, restore, and controlled purge.
- Sync: delta reads using a cursor, idempotent queued commands, record versions, tombstones, and structured conflict responses.
- Standardize list responses as paginated items with `next_cursor` and `sync_cursor`.
- Standardize API errors with stable error code, message, field errors, and request ID.
- Preserve `/api/v1` and introduce breaking contract changes only through new Alembic/API revisions.

## Implementation Sequence

1. Create local PostgreSQL/MinIO environment and Alembic baseline; replace startup schema creation.
2. Reset development data and seed roles, permissions, organization settings, and an administrator through an explicit command.
3. Refactor authentication to direct user roles and revocable bearer sessions.
4. Add audit events, archive metadata, idempotency records, job/outbox infrastructure, and API conventions.
5. Add object-storage and signed-upload adapters.
6. Add IndexedDB cache/outbox, delta-sync client, scoped logout cleanup, and offline status UI.
7. Add backup/restore scripts, deployment configuration, health checks, structured logging, and request IDs.
8. Connect business modules later in order: customer/site/project foundation, pricing/quotations, documents, inventory/procurement, agent ledger, then finance.

## Test and Acceptance Criteria

- Permission-matrix tests prove users cannot access unauthorized modules or records through direct API calls.
- Revoked, expired, replayed, and rotated tokens behave correctly.
- Every sensitive mutation creates an attributable audit event.
- Retried requests with the same idempotency key never create duplicate records.
- Offline edits sync successfully; stale edits produce a recoverable conflict rather than silent overwrite.
- Stock and finance drafts cannot affect balances before server confirmation.
- Archived records disappear from normal views, restore correctly, and referenced records resist purge.
- Unauthorized file URLs fail; signed links expire; uploads validate type, size, and checksum.
- Cached operational screens open with weak/no internet while sensitive originals remain unavailable.
- A clean database can be created entirely through Alembic, and a backup can be restored into a fresh environment.
- Existing frontend production build and connected authentication/admin flows remain functional.

## Assumptions

- The product is permanently single-company for this architecture phase.
- Existing SQLite and browser-local development data may be discarded.
- One customer has one active agent at a time.
- Managers and inventory/logistics users may post physical stock.
- Quotation approval creates a project but does not reserve or dispatch stock.
- Full finance is outside the foundation phase.
- Bearer tokens remain the selected authentication transport despite the higher browser-storage risk.
