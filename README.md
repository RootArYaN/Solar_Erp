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
└── render.yaml               Render backend Blueprint
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

The local super administrator is created from `.env` only when no user with
the configured username or email exists:

- Username: `admin`
- Password: `ChangeMe123!`

Later startups do not modify existing users, roles, permissions, agent data, or
business data. Change these values before sharing or deploying the application.

API documentation: `http://localhost:8000/docs`

Backend test: `pip install -r requirements-dev.txt && pytest`

## 2. Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Customer document storage

Local development uses the private `backend/storage` directory. Production
uses a private Cloudflare R2 bucket through its S3-compatible API. R2 encrypts
objects automatically; the application deliberately omits unsupported AWS SSE
headers. Use `backend/.env.production.example` and
`backend/docs/R2_SETUP.md` as the configuration checklist.

The static frontend uses a different R2 bucket and a small Cloudflare Worker
for React route fallback. Never make the private document bucket public. See
`deploy/RENDER_CLOUDFLARE.md` for the release sequence.

## Production migration path

- Inject the production environment through the cloud secret manager.
- Create verified database and object-storage recovery points.
- Rehearse the migration against a restored database copy.
- Run the migration release command with the backup reference.
- Allow only the deployed Cloudflare frontend origin in the Render API CORS
  configuration.

For a single-server Hostinger deployment, use the Ubuntu 24.04 Docker VPS
template and follow [`deploy/HOSTINGER_VPS.md`](deploy/HOSTINGER_VPS.md).

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
