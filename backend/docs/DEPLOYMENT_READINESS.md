# Hostinger production readiness

The production API is built as a non-root, read-only container. It uses one
worker, bounded database/thread pools, PostgreSQL-only migrations, secure
refresh cookies, CSRF/origin validation, explicit trusted hosts, private local
document storage, and required ClamAV scanning.

The release sequence is controlled by `compose.hostinger.yml`:

1. Validate `.env.hostinger` and the resolved Compose configuration.
2. Create and verify a Hostinger snapshot plus database/document exports.
3. Build the API and frontend images from their lockfiles.
4. Run exactly one migration task with the backup reference when required.
5. Run the idempotent identity initializer.
6. Start the application and verify `/api/v1/health` and `/api/v1/ready`.

PostgreSQL, port 8000, ClamAV, and document volumes must never be publicly
exposed. Follow `deploy/HOSTINGER_VPS.md` for the exact commands.
