# Solar ERP Starter

A clean, responsive authentication foundation for a Solar EPC ERP.

## Included

- React + Vite + TypeScript frontend
- Responsive desktop and mobile login UI
- FastAPI backend
- SQLite for local development
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
└── backend/                  FastAPI application
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

## Google Drive customer documents

Customer document uploads can be stored in a company Google Drive. Copy the
Google Drive variables from `backend/.env.example` into `backend/.env`, enable
the Google Drive API in Google Cloud, and create a Web application OAuth client
with this authorized redirect URI:

```text
http://localhost:8000/api/v1/documents/google-drive/callback
```

Sign in as a company administrator, open **Customer data**, and select
**Connect** beside Google Drive. The app creates this structure automatically:

```text
Solar ERP Customers/
└── <customer number> - <customer name>/
    └── uploaded documents
```

The integration requests the limited `drive.file` scope and encrypts the saved
refresh token with `GOOGLE_DRIVE_TOKEN_KEY`.

## Production migration path

- Replace `DATABASE_URL` with PostgreSQL, for example `postgresql+psycopg://...`.
- Replace the development JWT secret.
- Add Alembic migrations before the first shared environment.
- Move access tokens to secure HttpOnly cookies if the frontend and API share a controlled domain.
- Add audit events, password reset, invitation flows, MFA, session revocation, and rate limiting.

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
