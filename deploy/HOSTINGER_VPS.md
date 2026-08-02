# Hostinger VPS deployment

This deployment runs the React frontend, FastAPI API, PostgreSQL and ClamAV on
one Hostinger VPS. Hostinger's Traefik Docker project owns ports 80/443, routes
the public domain to the frontend and manages Let's Encrypt certificates. Use
the **Ubuntu 24.04 with Docker** VPS template. A VPS with at least 4 GB RAM is
recommended because ClamAV and PostgreSQL run alongside the application.

## 1. Prepare Hostinger

1. Point an `A` record for the ERP hostname (for example `erp.example.com`) to
   the VPS IPv4 address. Remove conflicting `A`/`AAAA` records.
2. In hPanel, allow inbound TCP ports `80` and `443`, UDP `443`, and the VPS SSH
   port. Do not expose PostgreSQL port `5432` or API port `8000`.
3. Enable Hostinger daily backups if available. Create a manual snapshot before
   every application or database migration.
4. In hPanel, open **VPS → Manage → Docker Manager** and deploy the Traefik
   project if it is not already running. Enter a valid email for Let's Encrypt.

The Traefik project must create the external `traefik-proxy` Docker network.
HTTPS is issued automatically after DNS resolves to the VPS and Traefik sees
the frontend container labels.

## 2. Copy and configure the project

Connect through the hPanel browser terminal or SSH, then run:

```bash
git clone https://github.com/RootArYaN/Solar_Erp.git
cd Solar_Erp
cp .env.hostinger.example .env.hostinger
openssl rand -hex 32
openssl rand -hex 32
```

Edit `.env.hostinger`. Use the two generated values for `POSTGRES_PASSWORD` and
`JWT_SECRET`, then set the real domain, email and initial administrator values.
Documents are stored in the private `document-storage` Docker volume on the
VPS. The PostgreSQL password must remain URL-safe; the hexadecimal command
above provides a safe value.

## 3. Validate and initialize

Every Compose command must use the deployment environment file:

```bash
docker compose --env-file .env.hostinger -f compose.hostinger.yml config --quiet
docker compose --env-file .env.hostinger -f compose.hostinger.yml build
docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d database malware-scanner
docker compose --env-file .env.hostinger -f compose.hostinger.yml --profile release run --rm migrate
docker compose --env-file .env.hostinger -f compose.hostinger.yml --profile release run --rm bootstrap-admin
docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d
```

The bootstrap command is safe to run again: it creates the configured admin
only if that username or email does not already exist. Remove the
`SEED_ADMIN_PASSWORD` value from `.env.hostinger` after the first successful
login and password change.

## 4. Verify

```bash
docker compose --env-file .env.hostinger -f compose.hostinger.yml ps
docker compose --env-file .env.hostinger -f compose.hostinger.yml logs --tail=100 api frontend
curl -fsS https://erp.example.com/api/v1/health
curl -fsS https://erp.example.com/api/v1/ready
```

Replace `erp.example.com` in the verification commands with the configured
domain. Both endpoints must return `{"status":"ok"}` or
`{"status":"ready"}` respectively.

## Updating

First create a Hostinger snapshot and record its identifier or timestamp:

```bash
git pull --ff-only
docker compose --env-file .env.hostinger -f compose.hostinger.yml build
BACKUP_REFERENCE=hostinger-snapshot-YYYYMMDD-HHMM docker compose --env-file .env.hostinger -f compose.hostinger.yml --profile release run --rm migrate
docker compose --env-file .env.hostinger -f compose.hostinger.yml up -d
```

Do not scale the `api` service in this topology. It deliberately uses one API
worker so its bounded local rate limiter remains authoritative. Move rate
limiting to a trusted gateway before adding API replicas.

## Database backup

Hostinger snapshots are useful for whole-server recovery, but also keep
independent encrypted PostgreSQL and document exports outside the VPS:

```bash
docker compose --env-file .env.hostinger -f compose.hostinger.yml exec -T database pg_dump -U solar_erp -d solar_erp -Fc > solar-erp-$(date +%F).dump
mkdir -p backups
docker run --rm -v solar-erp-hostinger_document-storage:/data:ro -v "$PWD/backups:/backup" alpine:3.21 tar -czf /backup/solar-erp-documents-$(date +%F).tar.gz -C /data .
```

Download both exports securely, verify that they can be restored, and remove
the VPS copies after transfer. Database records and document files form one
recovery point and must be backed up together. Never commit backups or
`.env.hostinger`, and never run `docker compose down -v` because `-v` deletes
the persistent database and document volumes.
