# Environment configuration

Use `backend/.env.example` for local PostgreSQL development and
`backend/.env.production.example` as the cloud configuration checklist.

Production configuration is fail-closed. Startup requires:

- a private JWT secret of at least 64 characters;
- HTTPS frontend origins and secure refresh cookies;
- PostgreSQL certificate verification (`verify-ca` or `verify-full`);
- gateway/distributed rate limiting;
- upload malware scanning;
- a private Cloudflare R2 bucket with provider-managed encryption.

Create an R2 Object Read & Write token scoped to the production bucket and keep
its access key and secret only in the backend secret manager. R2 automatically
encrypts objects with AES-256 and does not accept AWS SSE/KMS request headers;
use `S3_SSE_ALGORITHM=provider-managed`. No private value may use a `VITE_`
frontend variable.

See `backend/docs/R2_SETUP.md` for the exact endpoint and bucket settings.

Generate a JWT secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```
