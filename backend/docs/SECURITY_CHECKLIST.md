# Security checklist

## Implemented

- [x] Central frontend API client
- [x] Relative `/api/v1` routes
- [x] No Google Drive/OAuth code
- [x] No database or server secret in React
- [x] Short-lived bearer token stored in `sessionStorage`, not `localStorage`
- [x] Long-lived refresh token stored in an `HttpOnly` cookie
- [x] Refresh-token rotation
- [x] Session revocation and active-device page
- [x] Exact company filtering on protected records
- [x] Role permission checks in FastAPI
- [x] Customer/project/file object-level access checks
- [x] Assigned-agent file isolation
- [x] Backend-owned audit, approval and archive fields
- [x] File extension, MIME, signature and size validation
- [x] Random physical filenames
- [x] Path traversal and ZIP-slip protection
- [x] Authenticated file and archive downloads
- [x] Append-only audit API; no normal update/delete routes
- [x] Typed purge confirmation, reason, recent login and super-admin check
- [x] Idempotency keys for archive actions
- [x] Exact CORS origin configuration
- [x] Request IDs and normalized API errors
- [x] Security headers
- [x] Production stack traces hidden
- [x] Production Swagger/OpenAPI disabled
- [x] Production Vite source maps disabled
- [x] Development seed blocked in production
- [x] Insecure production cookie configuration rejected at startup
- [x] Hostinger production keeps documents in a private persistent Docker volume
- [x] Transactional migrations use a deployment lock and checksummed history
- [x] Existing production databases require a verified backup reference before migration

## Before public cloud deployment

- [x] Keep `JWT_SECRET` and the database password in ignored `.env.hostinger`
- [ ] Use HTTPS end to end
- [ ] Put API and frontend behind one trusted reverse proxy/domain
- [ ] Add proxy/API-gateway rate limiting for multi-instance deployment
- [ ] Add managed malware scanning for uploads
- [ ] Enable database backups and test restoration
- [ ] Automate encrypted off-VPS database and document-volume backups
- [ ] Add centralized structured logs with secret redaction
- [ ] Run dependency and container vulnerability scans
- [ ] Run the full frontend build and application test suite from the complete repository
- [ ] Test permissions with real custom roles, not only default seeded roles

## Browser-source reality

API paths and JavaScript bundles are visible to anyone who can use the browser. The protection is not route hiding. The backend checks authentication, company, permission, object ownership, valid state and accepted fields for each protected operation.
