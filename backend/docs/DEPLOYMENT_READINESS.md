# Deployment readiness

## Implemented application safeguards

- Production settings fail closed.
- Secure refresh cookie, CSRF/origin checks and revocable sessions.
- Explicit CORS/trusted-host configuration and API security headers.
- PostgreSQL health and readiness checks.
- Transactional, locked and checksummed migration history.
- Production backup confirmation before changing an existing database.
- Private Cloudflare R2 storage with automatic provider-managed encryption.
- R2-compatible uploads, copies and readiness probes omit unsupported AWS SSE
  and optional checksum headers.
- Validated uploads use one `PutObject` request within the 100 MB application
  limit, avoiding unnecessary multipart Class A operations.
- Readiness checks verify bucket access on every request and cache the R2
  write/delete probe for a configurable interval.
- Local upload staging, signature validation and required malware scanning before
  an object is persisted.
- Authenticated streaming downloads; bucket objects are never exposed publicly.
- Request limits, concurrency bounds, idempotency and gateway rate-limit mode.
- Production API documentation and frontend source maps disabled.

## Required cloud services

```text
Static frontend/CDN
        ↓ one HTTPS origin
Trusted reverse proxy / API gateway
        ├── /        → React assets
        └── /api/v1  → FastAPI
                         ├── Managed PostgreSQL
                         ├── Private Cloudflare R2 bucket
                         └── Malware scanner
```

The gateway must provide distributed rate limiting and must be the only network
path to the API when `TRUST_PROXY_HEADERS=true`.

## Release order

1. Build the non-root images from the committed lockfiles and scan them.
2. Create and verify database and object-storage recovery points.
3. Rehearse migrations on a restored database copy.
4. Run the API image once with `scripts/run_production_migrations.sh` and a
   verified `BACKUP_REFERENCE`.
5. Start one API worker, verify `/api/v1/health` and `/api/v1/ready`, then scale.
6. Deploy the frontend, run `scripts/smoke_test.py`, and complete authenticated
   upload/download smoke tests.

Use `backend/.env.production.example` and
`frontend/.env.production.example` as the configuration checklists. Store real
secrets in the cloud secret manager, never in these files.

Container definitions, service wiring, release order and rollback boundaries
are documented in `deploy/README.md`. `compose.production.yml` is a
production-like validation topology; cloud IAM, networking, WAF/rate limiting,
observability and recovery resources still require provider-specific
infrastructure.
