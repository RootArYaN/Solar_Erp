# Patch manifest

## Baseline

- Frontend: `src_quotation_modal_width_fixed.zip`
- Backend: `app_quotation_approval_agent_download.zip`
- The two baselines above were used exclusively. No older patch was merged.

## Result

The ERP now has a local, database-backed archive workflow, persistent customer documents, append-only event history, safer sessions, centralized frontend API calls, production configuration checks, and a small standalone archive worker. Existing customer, quotation, approval, agent, transaction and project timeline flows remain in place. Google Drive and Google OAuth remain removed.

## Frontend files added

- `.env.example`
- `vite.config.ts`
- `src/api/client.ts`
- `src/api/auth.ts`
- `src/api/admin.ts`
- `src/api/agents.ts`
- `src/api/workflow.ts`
- `src/api/files.ts`
- `src/api/archives.ts`
- `src/components/archive/DataArchivePage.tsx`

## Frontend files changed

- `src/App.tsx`
- `src/components/AppShell.tsx`
- `src/components/LoginForm.tsx`
- `src/components/documents/CustomerDataUploadPage.tsx`
- `src/lib/api.ts`
- `src/lib/auth-storage.ts`
- `src/lib/permissions.ts`
- `src/styles.css`
- `src/types.ts`

## Backend files added

- `.env.example`
- `app/api/routes/archives.py`
- `app/api/routes/files.py`
- `app/core/middleware.py`
- `app/core/rate_limit.py`
- `app/core/request_context.py`
- `app/core/time.py`
- `app/db/maintenance.py`
- `app/db/migrate.py`
- `app/models/system.py`
- `app/schemas/archive.py`
- `app/schemas/files.py`
- `app/services/access_service.py`
- `app/services/archive_service.py`
- `app/services/audit_service.py`
- `app/services/file_service.py`
- `app/services/pdf_report.py`
- `app/services/storage.py`
- `app/workers/__init__.py`
- `app/workers/archive_worker.py`

## Backend files changed

- `app/main.py`
- `app/api/deps.py`
- `app/api/routes/auth.py`
- `app/api/routes/health.py`
- `app/core/config.py`
- `app/core/security.py`
- `app/db/seed.py`
- `app/db/session.py`
- `app/models/__init__.py`
- `app/models/agent.py`
- `app/models/workflow.py`
- `app/schemas/auth.py`
- `app/schemas/agent.py`
- `app/services/auth_service.py`
- `app/services/admin_service.py`
- `app/services/agent_service.py`
- `app/services/workflow_service.py`

## Files removed

No required application file was removed. Google Drive code was already absent in the selected baseline and was not restored.

## Database tables added

- `auth_sessions`
- `archives`
- `archive_jobs`
- `audit_events`
- `stored_files`
- `schema_migrations`

## Existing table columns added

`customer_projects`:

- `archived_at`
- `archived_by`
- `archive_id`
- `is_locked`

`agent_customers`:

- `archived_at`
- `archived_by`
- `archive_id`

`agent_transactions`:

- `project_id`
- `archived_at`
- `archived_by`
- `archive_id`

`archive_jobs`:

- `request_key`

## Permissions added

- `archive.view`
- `archive.create`
- `archive.download`
- `archive.verify`
- `archive.cleanup`
- `archive.restore`
- `archive.purge`
- `events.view`

## API routes added

Authentication and devices:

- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/devices`
- `DELETE /api/v1/auth/devices/others`

Files:

- `GET /api/v1/files/customer-options`
- `GET /api/v1/files`
- `POST /api/v1/files`
- `GET /api/v1/files/{file_id}/download`
- `PATCH /api/v1/files/{file_id}/status`

Archives and events:

- `GET /api/v1/archives`
- `GET /api/v1/archives/kpis`
- `GET /api/v1/archives/{archive_id}`
- `POST /api/v1/archives/projects/{project_id}`
- `POST /api/v1/archives/customers/{customer_id}`
- `POST /api/v1/archives/agent-transactions`
- `POST /api/v1/archives/{archive_id}/verify`
- `POST /api/v1/archives/{archive_id}/cleanup`
- `POST /api/v1/archives/{archive_id}/restore`
- `POST /api/v1/archives/{archive_id}/purge`
- `GET /api/v1/archives/{archive_id}/download`
- `GET /api/v1/archive-jobs/{job_id}`
- `GET /api/v1/events`

Health:

- `GET /api/v1/ready`

## Behaviour changed

- Frontend API calls now use a single `/api/v1` client and a Vite development proxy.
- Long-lived refresh sessions use an `HttpOnly` cookie. The short-lived access token is kept in `sessionStorage`, not `localStorage`.
- Login and refresh sessions are persisted in `auth_sessions` and may be revoked.
- Important business changes produce append-only audit events.
- Customer supporting documents are stored through authenticated backend APIs and linked to customer/project records.
- Customer archives include completed-project timelines; cleanup may remove those timeline details and restore recreates them.
- Agents can access only assigned customer/project files; unscoped files are limited to their uploader.
- Project updates are blocked after archive locking.
- Agent transaction balances remain unchanged when transaction detail moves into an archive.
- Archive create, verify, cleanup, restore and purge requests support `Idempotency-Key`.
- Permanent purge requires super-admin access, a recent login, a typed confirmation and a reason.
- Production source maps are disabled and major pages are route-split through `React.lazy`.

## Environment variables added

- `ENVIRONMENT`
- `DATABASE_URL`
- `JWT_SECRET`
- `ACCESS_TOKEN_MINUTES`
- `REFRESH_TOKEN_DAYS`
- `SESSION_COOKIE_NAME`
- `SESSION_COOKIE_SECURE`
- `SESSION_COOKIE_SAMESITE`
- `FRONTEND_ORIGINS`
- `STORAGE_TYPE`
- `STORAGE_PATH`
- `MAX_UPLOAD_MB`
- `ARCHIVE_KEEP_DAYS`
- `ARCHIVE_WORKER_LIMIT`
- `ARCHIVE_JOB_TIMEOUT_MINUTES`
- `DEFAULT_PAGE_SIZE`
- `MAX_PAGE_SIZE`
- `LOGIN_LIMIT`
- `LOGIN_WINDOW_SECONDS`
- `DB_POOL_SIZE`
- `DB_MAX_OVERFLOW`
- `VITE_API_BASE_URL`

## Compatibility decisions

- No Redis, Celery, microservice or separate archive database was added.
- Local storage is the only implemented provider before cloud integration. Business code uses a small storage interface so an S3-compatible provider can be added later.
- Existing API response shapes were preserved where changing them would break the current frontend.
- A small additive migration runner was used because the baseline did not contain Alembic. It also inserts the new permission catalogue entries and assigns safe defaults to existing admin roles.
- Core project, customer, quotation and financial index rows remain searchable after cleanup. Large source documents, project timeline detail and archived transaction detail are eligible for removal.

## Validation completed

- Python compilation and import checks
- Route registration check: 54 routes in development
- Fresh database migration check
- Migration from the original baseline schema
- Existing-role permission migration and assignment check
- SQLite archive creation, manifest, SHA-256 and ZIP integrity check
- Project archive, retention block, forced cleanup and restore workflow
- Customer archive, document cleanup and restore workflow
- Agent transaction archive, cleanup and restore with unchanged ledger balance
- Cross-agent and unscoped-file authorization checks
- Archive and event permission checks
- Idempotent archive, cleanup and purge checks
- Stale archive-job recovery and project unlock check
- Production configuration rejection for insecure cookie settings
- Development docs header and production docs/OpenAPI checks
- Explicit SQLite maintenance command check
- TypeScript/TSX syntax transpilation across 61 source files
- Hardcoded API URL, secret pattern and Google Drive reference scans

## Known limits before cloud deployment

- The supplied frontend baseline contains source files but no `package.json`, lockfile or installed dependencies. A complete `npm run build` could not be executed from this isolated source ZIP. All TypeScript/TSX files passed compiler syntax transpilation; run the normal project build after placing these files into the full repository.
- The supplied backend baseline also contains application source only and no dependency lockfile or container definition. Python import and workflow checks passed in the available runtime; build production from the complete repository and pinned dependencies.
- The short-lived access token remains readable by the current browser tab because the existing API uses bearer authentication. The long-lived refresh token is `HttpOnly`. A future cookie-only access-session design would require CSRF handling and a coordinated API change.
- Login throttling is process-local. Put rate limiting at the reverse proxy/API gateway before running multiple API containers.
- Malware scanning is not included. Uploads are limited by extension, MIME, signature and size; add a managed antivirus scanner before accepting public uploads.
- S3/object-storage code is intentionally not included yet. `STORAGE_TYPE` is locked to `local` so a cloud value cannot silently fall back to local disk.
