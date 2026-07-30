# Deployment readiness

## Ready before cloud integration

- Central `/api/v1` frontend client
- Same-origin Vite proxy for local work
- Strict configurable CORS
- Environment validation
- Secure refresh cookie
- Revocable sessions
- Database migrations separated from production startup
- Health and readiness endpoints
- Private local storage root
- Streaming uploads/downloads
- Database-backed archive jobs
- Standalone worker command
- Pagination and archive/event indexes
- Route-based frontend code splitting
- Production source maps disabled
- Production API docs disabled
- Request IDs, safe errors and security headers
- Non-root backend and frontend container definitions
- Exact Python production dependency lock
- Separate production migration entrypoint
- Clamd streaming client and release smoke test

## Recommended local commands

```bash
python -m app.db.migrate upgrade
python -m app.db.maintenance
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.workers.archive_worker
```

Frontend development continues through the existing Vite project. The supplied `vite.config.ts` proxies `/api` to `127.0.0.1:8000`.

## Cloud target later

```text
Static frontend/CDN
        ↓ same public origin
Reverse proxy
        ├── /        → React assets
        └── /api/v1  → FastAPI
                         ↓
                    Managed PostgreSQL
                         ↓
                    Private object storage
                         ↑
                    Archive worker
```

## Before the first public release

1. Put the patched source into the complete repository.
2. Install from the lockfile and run the production frontend build.
3. Run the migration against a database copy.
4. Verify archive creation and restore with representative documents.
5. Configure HTTPS and secure cookies.
6. Configure a non-default private secret.
7. Keep database and storage private from the public internet.
8. Configure backups and test one restore.
9. Add gateway rate limiting and upload malware scanning.
10. Configure the private R2 bucket, scoped token and independent recovery bucket.

## Container notes

- Run as a non-root user.
- Keep application files read-only.
- Mount only `STORAGE_PATH` and a small temp directory as writable.
- Run API and worker as separate process types from the same image.
- Execute migrations as a release command, not in every production API process.
- Do not use temporary container disk as the permanent archive store.

## Production packaging

The frontend has a committed npm lockfile and a multi-stage non-root Nginx
image. The backend has an exact production dependency lock, a non-root image,
separate API/migration entrypoints and a release smoke test. See
`deploy/README.md` and `compose.production.yml`.

The Compose topology validates service wiring but does not implement the cloud
control plane. Deploy immutable image digests through provider-specific
infrastructure.
