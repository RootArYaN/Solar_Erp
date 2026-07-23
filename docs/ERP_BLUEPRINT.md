# Solar ERP Expansion Blueprint

## Architecture direction

Start as a modular monolith: one frontend, one FastAPI service and one relational database. Keep each business area isolated by routes, services, schemas, models and permission codes. This is easier to understand and deploy than microservices while the workflows are still evolving.

## Tenant and access boundary

Every business record must ultimately belong to a `company_id`. Branches, warehouses and projects sit below the company. Users receive access through memberships, roles and explicit permission codes.

Suggested access levels:

- `super_admin`: platform-wide maintenance
- `company_admin`: one company and all its branches
- `manager`: selected operational modules and approvals
- `agent`: assigned operational work
- `customer`: external portal and own projects/documents only

Do not rely only on frontend hiding. Every protected backend operation must check company scope and permissions.

## Core modules and order

### Foundation

Companies, branches, users, invitations, roles, permissions, audit events, numbering sequences, currencies, taxes, financial years and approval policies.

### CRM and EPC sales

Leads, customers, sites, surveys, load data, system designs, quotations, revisions, approvals, contracts and project conversion.

### Product and inventory

Items, categories, units, manufacturers, panels, inverters, batteries, structures, BOMs, warehouses, bins, batches, serial numbers, stock movements, reservations, reorder rules and cycle counts.

### Procurement

Vendors, purchase requests, comparisons, approvals, purchase orders, goods receipts, quality checks, returns and vendor bills.

### EPC project execution

Projects, milestones, tasks, site teams, material requests, dispatches, installation, testing, commissioning, snag lists and handover.

### Documents

Templates, generated quotations, work orders, invoices, delivery challans, inspection reports, warranties, attachments, versions, signatures and approval trails.

### Finance and ledger

Chart of accounts, journals, customer invoices, vendor bills, receipts, payments, taxes, expenses, bank reconciliation, project costing, profitability and financial reports.

### Service and customer portal

Assets, warranties, service tickets, preventive maintenance, visits, parts usage, customer documents and project status.

## Cross-module rules

- Use immutable stock movements instead of editing stock balances directly.
- Use balanced journal entries instead of changing ledger totals directly.
- Store document versions and approval history.
- Add audit events for sensitive writes and access changes.
- Use idempotency keys for integrations and payment/webhook operations.
- Use database transactions for workflows that touch multiple modules.
- Keep human-readable document numbers separate from internal UUIDs.

## Suggested next implementation phase

1. User invitation and password setup
2. Admin screens for users, roles and permissions
3. Company, branch and warehouse master data
4. Item catalogue and stock movement engine
5. Audit event recording
6. Project and quotation foundation
