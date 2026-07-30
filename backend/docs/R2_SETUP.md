# Cloudflare R2 production setup

The backend uses R2 through its S3-compatible API. The bucket stays private;
all browser downloads continue through authenticated API routes.

## Bucket and credentials

1. Create a dedicated production R2 bucket.
2. Do not enable `r2.dev` public access or attach a public custom domain.
3. Create an **Object Read & Write** R2 API token scoped only to that bucket.
4. Store the Access Key ID and Secret Access Key in the backend secret manager.
5. Copy the Cloudflare account ID from the R2 dashboard.

Configure:

```dotenv
STORAGE_TYPE=s3
S3_PROVIDER=r2
S3_BUCKET=private-solar-erp-production
S3_PREFIX=solar-erp
S3_REGION=auto
S3_ENDPOINT_URL=https://<32-character-account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<secret-manager-reference>
S3_SECRET_ACCESS_KEY=<secret-manager-reference>
S3_SESSION_TOKEN=
S3_ADDRESSING_STYLE=path
S3_SSE_ALGORITHM=provider-managed
S3_KMS_KEY_ID=
STORAGE_WRITE_PROBE_INTERVAL_SECONDS=900
```

R2 automatically encrypts all objects at rest with provider-managed AES-256.
It rejects AWS `x-amz-server-side-encryption` and KMS headers, so the backend
does not send them in R2 mode. It also limits optional S3 checksum support; the
R2 client asks botocore to add checksums only when an operation requires one.
The application keeps its own SHA-256 checksum in object metadata.

## Recovery and retention

R2's S3-compatible API does not provide S3 bucket versioning. Do not treat the
live bucket as its own backup.

- Copy the live prefix to a separate recovery bucket on a schedule.
- Record the backup job identifier as the storage part of each release recovery
  point.
- Apply an R2 bucket lock to the recovery bucket or backup prefix for the
  required retention period.
- Do not lock the live application prefix: normal file deletion and migration
  cleanup must remain possible.
- Test restoring the backup into a new bucket before public launch and at a
  regular interval afterward.

An APAC location hint can improve placement but does not guarantee India-only
data residency. Confirm that constraint before storing regulated customer
documents.

## Release verification

Before scaling the API:

1. Run the migration job with the verified database/R2 backup reference.
2. Wait for `/api/v1/ready`; it checks bucket access every time and writes then
   deletes a private R2 probe object at most once every configured probe
   interval per API process.
3. Upload a representative PDF, download it through the authenticated API and
   compare its recorded checksum.
4. Confirm the bucket has no public domain and the token cannot access any
   unrelated bucket.
