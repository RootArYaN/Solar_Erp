# Hostinger VPS deployment

This deployment runs the React frontend, FastAPI API, PostgreSQL, ClamAV and
the HTTPS proxy on one Hostinger VPS. Use the **Ubuntu 24.04 with Docker** VPS
template. A VPS with at least 4 GB RAM is recommended because ClamAV and
PostgreSQL run alongside the application.

## 1. Prepare Hostinger

1. Point an `A` record for the ERP hostname (for example `erp.example.com`) to
   the VPS IPv4 address. Remove conflicting `A`/`AAAA` records.
2. In hPanel, allow inbound TCP ports `80` and `443`, UDP `443`, and the VPS SSH
   port. Do not expose PostgreSQL port `5432` or API port `8000`.
3. Enable Hostinger daily backups if available. Create a manual snapshot before
   every application or database migration.

HTTPS is issued automatically after DNS resolves to the VPS and ports 80/443
reach Caddy.

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
`JWT_SECRET`, set the real domain/email/admin values, and add the private
Cloudflare R2 bucket credentials. The PostgreSQL password must remain URL-safe;
the hexadecimal command above provides a safe value.

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
docker compose --env-file .env.hostinger -f compose.hostinger.yml logs --tail=100 api frontend caddy
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

Hostinger snapshots are useful for whole-server recovery, but also keep an
independent encrypted PostgreSQL export outside the VPS:

```bash
docker compose --env-file .env.hostinger -f compose.hostinger.yml exec -T database pg_dump -U solar_erp -d solar_erp -Fc > solar-erp-$(date +%F).dump
```

Download the dump securely, verify that it can be restored, and remove the VPS
copy after transfer. Never commit dumps or `.env.hostinger`.
