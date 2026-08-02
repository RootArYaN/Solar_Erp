# Shree Enterprise

A secure Solar EPC ERP for Shree Enterprise.

## Included

- React + Vite + TypeScript frontend
- Responsive desktop and mobile login UI
- FastAPI backend
- PostgreSQL for development and production
- JWT authentication
- Argon2 password hashing
- Company-aware memberships
- Role and permission schema for future RBAC
- One-time local super-administrator bootstrap
- Protected starter dashboard

## Project structure

```text
solar-erp-starter/
├── frontend/                 React + Vite application
├── backend/                  FastAPI application
├── compose.hostinger.yml     Supported production topology
└── deploy/HOSTINGER_VPS.md   Production runbook
```

## 1. Run the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

The local super administrator is created from `.env` only when neither the
configured username nor email exists. If either identifier belongs to a
different record, bootstrap stops with a conflict instead of changing data:

- Username: `admin`
- Password: `ChangeMe123!`

Later development startups create only missing permissions, built-in roles,
and required role-permission links. They do not overwrite existing labels,
extra permissions, users, agent data, or business data. Change these values
before sharing or deploying the application.

API documentation: `http://localhost:8000/docs`

Backend test: `pip install -r requirements-dev.txt && pytest`

Local backend commands always resolve `backend/.env`, even if launched from the
repository root. The test suite overrides the database and storage paths with
test-only values. Neither local development nor tests load `.env.hostinger`.

## 2. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Customer document storage

Local development uses the private `backend/storage` directory. Hostinger
production uses the private `solar-erp-hostinger_document-storage` Docker
volume. The frontend and API are served from one HTTPS origin; document files
are never exposed as a public directory.

## Production migration path

- Keep production secrets only in the ignored `.env.hostinger` file.
- Use `.env.hostinger` only with `compose.hostinger.yml`; never pass it to local
  API, Vite, pytest, or performance commands.
- Create verified Hostinger, PostgreSQL, and document-volume recovery points.
- Rehearse the migration against a restored database copy.
- Run the migration release command with the backup reference.
- Run the safe identity initializer after migrations.
- Keep PostgreSQL, the API, ClamAV, and document storage off public ports.

Use the Hostinger Ubuntu 24.04 Docker VPS template and follow
[`deploy/HOSTINGER_VPS.md`](deploy/HOSTINGER_VPS.md).

## ERP expansion sequence

1. Identity, companies, branches, roles, permissions, audit events
2. Customers, vendors, contacts, addresses
3. Products, BOMs, warehouses, stock movements, serial/batch tracking
4. Leads, surveys, quotations, EPC projects, work orders
5. Purchase requests, purchase orders, goods receipt, vendor bills
6. Sales orders, dispatch, installation, commissioning, service
7. Documents, approvals, templates, versioning
8. Ledger, taxes, receipts, payments, expenses, project profitability
9. Dashboards, alerts, forecasting, integrations and automation
