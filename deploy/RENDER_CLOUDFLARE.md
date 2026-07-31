# Shree Enterprise: Render API and Cloudflare R2 frontend

This release keeps the FastAPI backend on Render and serves the React SPA from
a dedicated Cloudflare R2 bucket through a minimal Worker.

## Resource boundary

- `shree-enterprise-api`: Render Docker web service.
- `shree-enterprise-db`: same-region private Render PostgreSQL.
- `shree-enterprise-clamav`: Render private malware-scanning service.
- `shree-enterprise-static`: R2 bucket containing only public frontend build
  output.
- `shree-enterprise-files`: private R2 bucket containing ERP documents and
  posters. Never enable public access on this bucket.

The Render Blueprint deliberately keeps the API at one instance and one
Uvicorn worker so its bounded in-process rate limiter remains authoritative.
Add a shared gateway or Redis-backed limiter before scaling.

## 1. Deploy the Cloudflare static site

From `frontend/`, install the committed dependency set and authenticate
Wrangler:

```bash
npm ci
npx wrangler login
```

Build with the expected Render API URL, upload `dist/` to the static R2 bucket,
create the private files bucket if needed, and deploy the SPA routing Worker:

```bash
VITE_API_BASE_URL=https://shree-enterprise-api.onrender.com/api/v1 \
  npm run deploy:cloudflare
```

Record the resulting HTTPS Worker URL. If Cloudflare assigns a different URL
or you add a custom domain, use that exact origin (scheme plus hostname, no
path and no trailing slash) as Render's `FRONTEND_ORIGINS`.

## 2. Create private R2 API credentials

Create an R2 Object Read & Write token scoped only to
`shree-enterprise-files`. Record:

- the S3 access key ID;
- the S3 secret access key;
- the account endpoint
  `https://<32-character-account-id>.r2.cloudflarestorage.com`.

Do not reuse the public static bucket for application uploads. The detailed
token checklist is in `backend/docs/R2_SETUP.md`.

## 3. Deploy the Render backend Blueprint

In Render, create a Blueprint from this repository and select `render.yaml`.
The Blueprint creates only backend resources; it does not deploy the frontend.

Provide these prompted values:

- `FRONTEND_ORIGINS`: the Cloudflare Worker/custom-domain HTTPS origin;
- `S3_ENDPOINT_URL`: the R2 account endpoint;
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: the bucket-scoped private
  files credentials;
- `SEED_ADMIN_EMAIL`: the real Shree Enterprise administrator email;
- `SEED_ADMIN_PASSWORD`: a unique password of 12–128 characters.

Render generates `JWT_SECRET` and injects its private PostgreSQL connection.
The pre-deploy command migrates a new database. Future schema-changing deploys
against an existing database require a verified `BACKUP_REFERENCE` environment
variable.

The first successful deploy runs the idempotent administrator bootstrap once.
After login is verified, remove `SEED_ADMIN_PASSWORD` and set
`BOOTSTRAP_ADMIN_ENABLED=false` in the Render service environment.

## 4. Verify

The API must return:

```text
GET https://<render-host>/api/v1/health  -> {"status":"ok"}
GET https://<render-host>/api/v1/ready   -> {"status":"ready"}
```

Then verify the Cloudflare site at `/login` and a deep link such as
`/app/customers`. Run the backend smoke test:

```bash
python backend/scripts/smoke_test.py --base-url https://<render-host>
```

If Render assigns a hostname other than the URL used for the frontend build,
rerun `npm run deploy:cloudflare` with the final
`VITE_API_BASE_URL=https://<render-host>/api/v1`.
