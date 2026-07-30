# Production packaging

This directory describes the provider-neutral release boundary. The Docker
images can run on a managed container platform, while databases, object
storage, secrets, ingress, rate limiting, monitoring and backups remain owned
by the selected cloud control plane.

Production object storage is Cloudflare R2. The backend uses R2's
S3-compatible endpoint with bucket-scoped credentials and provider-managed
encryption. See `backend/docs/R2_SETUP.md`.

## Artifacts

- `backend/Dockerfile` builds the non-root API, migration and smoke-test image.
- `frontend/Dockerfile` builds the Vite bundle and serves it from unprivileged
  Nginx with SPA routing, security headers and an `/api/` reverse proxy.
- `compose.production.yml` is a production-like single-host reference and a
  way to validate service wiring. It is not a replacement for multi-zone cloud
  infrastructure.
- `.env.deploy.example` names the immutable application and malware-scanner
  image digests. Real deployment values belong in `.env.deploy`, which Git
  ignores.

The API filesystem is read-only except for a bounded temporary upload
directory. Upload bytes are streamed to clamd over its INSTREAM protocol, so
the scanner does not need access to the API container filesystem.

## Build and publish

Build from the repository root:

```bash
docker build --pull --tag solar-erp-api:release ./backend
docker build --pull --tag solar-erp-frontend:release ./frontend
```

Run the image vulnerability and secret scanners required by your organization,
push both images, and record their registry digests in the deployment
configuration. Production must deploy digests, not mutable tags.

The Dockerfiles also accept `PYTHON_IMAGE`, `NODE_IMAGE` and `NGINX_IMAGE`
build arguments. CI should set those to reviewed `image@sha256:...` references
so the build stages are immutable as well.

The backend uses `requirements.lock` with exact production versions and
installs it with `--no-deps`. When updating dependencies, resolve
`requirements.txt` in an isolated environment, review the exact lock, run
`pip check`, rebuild, and rerun the backend suite.

## Release sequence

1. Create verified PostgreSQL and object-storage recovery points.
2. Record immutable API, frontend and ClamAV image digests.
3. Run exactly one migration task from the new API image:

   ```bash
   ENVIRONMENT=production \
   BACKUP_REFERENCE=<verified-recovery-point> \
   backend/scripts/run_production_migrations.sh
   ```

4. Deploy one API replica. Wait for `/api/v1/ready`, then scale replicas.
5. Deploy the frontend or publish `frontend/dist` to the selected CDN.
6. Run:

   ```bash
   python backend/scripts/smoke_test.py --base-url https://erp.example.com
   ```

7. Verify login, one authorized read, one write, one upload/download and the
   cloud dashboards before completing the release.

Never run migrations in every API replica. The migration command also takes a
PostgreSQL advisory lock, but a single release task keeps failure handling
clear.

## Rollback

Application rollback and data rollback are separate:

- If the new release did not migrate or write incompatible data, redeploy the
  previous immutable API/frontend digests and rerun the smoke test.
- Never run reverse DDL against the shared production database.
- If data/schema rollback is required, stop writes, restore PostgreSQL and the
  independent R2 backup into new recovery resources, verify them privately,
  point the previous application release to those resources, and only then
  reopen traffic.
- Preserve the failed database, R2 objects, backup job records, release logs
  and image digests for investigation.

The exact traffic switch, snapshot restore and replica rollback commands must
be supplied by the chosen cloud provider's infrastructure module.
