from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.agent import AgentCustomer, AgentProfile, AgentTransaction
from app.models.auth import Company, Membership, Permission, Role, User
from app.models.finance import FinanceCategory, FinancialAccount
from app.models.operations import InventoryLocation, PricingBook
from app.models.workflow import TransactionApproval

PERMISSIONS = {
    "dashboard.view": ("Show Overview tab", "Show the overview dashboard."),
    "customers.view": ("Show Customers tab", "Open customer records and workflow."),
    "customers.create": ("Create customers", "Create customer records."),
    "customers.edit": ("Edit customers", "Change customer records."),
    "customers.archive": ("Archive customers", "Archive and restore customer records."),
    "sites.view": ("View customer sites", "View customer installation sites."),
    "sites.create": ("Create customer sites", "Create installation sites."),
    "sites.edit": ("Edit customer sites", "Change installation sites."),
    "sites.archive": ("Archive customer sites", "Archive and restore installation sites."),
    "quotations.view": ("View quotations", "View quotation records and revisions."),
    "quotations.create": ("Create quotations", "Create quotation drafts and revisions."),
    "quotations.edit": ("Edit quotations", "Change quotation drafts."),
    "quotations.archive": ("Archive quotations", "Archive and restore quotations."),
    "quotations.approve": ("Approve quotations", "Approve or reject quotation revisions."),
    "projects.view": ("View projects", "View EPC projects and their progress."),
    "projects.create": ("Create projects", "Create EPC project records."),
    "projects.edit": ("Edit projects", "Change EPC project records."),
    "projects.archive": ("Archive projects", "Archive and restore EPC projects."),
    "projects.manage": ("Manage projects", "Perform existing project-management operations."),
    "material_requests.view": ("View material requests", "View project material requests."),
    "material_requests.create": ("Create material requests", "Create project material requests."),
    "material_requests.edit": ("Edit material requests", "Change material-request drafts."),
    "material_requests.archive": ("Archive material requests", "Archive and restore material requests."),
    "material_requests.approve": ("Approve material requests", "Approve or reject material requests."),
    "inventory.view": ("Show Inventory tab", "View products, warehouses and stock balances."),
    "inventory.create": ("Create inventory records", "Create inventory items and movements."),
    "inventory.edit": ("Edit inventory records", "Change inventory records."),
    "inventory.archive": ("Archive inventory records", "Archive and restore inventory records."),
    "inventory.approve": ("Approve stock changes", "Approve physical stock posting."),
    "inventory.manage": ("Manage inventory", "Perform existing inventory-management operations."),
    "pricing.view": ("Show Solar pricing tab", "Open solar pricing."),
    "pricing.create": ("Create pricing", "Create pricing records."),
    "pricing.edit": ("Edit pricing", "Change pricing records."),
    "pricing.archive": ("Archive pricing", "Archive and restore pricing records."),
    "pricing.approve": ("Approve pricing", "Approve pricing records."),
    "documents.view": ("Show Customer data tab", "View customer and project documents."),
    "documents.create": ("Create documents", "Create documents and upload files."),
    "documents.edit": ("Edit documents", "Change document metadata and drafts."),
    "documents.archive": ("Archive documents", "Archive and restore documents."),
    "documents.approve": ("Approve documents", "Approve document versions."),
    "documents.manage": ("Manage documents", "Perform existing document-management operations."),
    "posters.view": ("Show Posters tab", "Open the poster library."),
    "posters.create": ("Upload posters", "Upload posters to the library."),
    "posters.edit": ("Edit posters", "Rename and change poster metadata."),
    "posters.archive": ("Archive posters", "Archive and restore posters."),
    "agents.view": ("Show Agents tab", "View an allowed agent profile, assigned customers and transaction history."),
    "agents.view_all": ("View all agents", "View every agent profile inside the current company."),
    "agents.manage": ("Manage agents", "Edit agent profiles and manage assigned customers."),
    "agents.transactions.submit": ("Submit agent transactions", "Submit agent financial entries for administrator approval."),
    "agents.transactions.approve": ("Approve agent transactions", "Approve or reject agent-submitted financial entries."),
    "security.sessions.view": ("Show Devices tab", "View active login devices."),
    "security.sessions.manage": ("Manage devices", "Revoke other login devices."),
    "users.view": ("View users", "View company users and their assigned roles."),
    "users.manage": ("Manage users", "Create, edit, activate and reset company users."),
    "roles.view": ("View roles", "View roles and the permission catalogue."),
    "roles.manage": ("Manage roles", "Create custom roles and change role permissions."),
    "finance.view": ("View finance", "View ledgers, invoices and company financial reports."),
    "finance.manage": ("Manage finance", "Create and post finance transactions."),
    "archive.view": ("View data archive", "View archive packages and job history."),
    "archive.create": ("Create archives", "Create project, customer and transaction archives."),
    "archive.download": ("Download archives", "Download verified archive ZIP packages."),
    "archive.verify": ("Verify archives", "Verify archive files and checksums."),
    "archive.cleanup": ("Clean archived data", "Remove eligible active copies after archive verification."),
    "archive.restore": ("Restore archives", "Restore records and files from an archive."),
    "archive.purge": ("Purge archives", "Permanently remove archive packages."),
    "events.view": ("View event history", "View the append-only event history."),
}

ROLE_BLUEPRINTS = {
    "customer": {
        "name": "Customer",
        "description": "Limited customer portal access for projects and documents.",
        "permissions": ["dashboard.view", "projects.view", "documents.view"],
    },
    "agent": {
        "name": "Agent",
        "description": "Operational access for field and customer-facing teams.",
        "permissions": [
            "dashboard.view",
            "inventory.view",
            "projects.view",
            "projects.manage",
            "documents.view",
            "documents.manage",
            "agents.view",
            "customers.create",
            "quotations.create",
            "agents.transactions.submit",
        ],
    },
    "accounts_admin": {
        "name": "Accounts Admin",
        "description": "Finance, ledger, billing and document administration.",
        "permissions": [
            "dashboard.view",
            "documents.view",
            "documents.manage",
            "finance.view",
            "finance.manage",
            "agents.view",
            "agents.view_all",
            "quotations.view",
            "quotations.create",
            "quotations.approve",
            "projects.view",
            "agents.transactions.approve",
            "archive.view",
            "archive.download",
            "events.view",
        ],
    },
    "company_admin": {
        "name": "Company Admin",
        "description": "Full operational and administrative access inside one company.",
        "permissions": list(PERMISSIONS.keys()),
    },
    "super_admin": {
        "name": "Super Admin",
        "description": "Platform-level administration with unrestricted access.",
        "permissions": list(PERMISSIONS.keys()),
    },
}


def _seed_agent_workspace(db: Session, company: Company, agent_role: Role) -> None:
    username = "agent"
    email = "agent@solarerp.dev"
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        user = User(
            username=username,
            email=email,
            full_name="Ravi Shah",
            hashed_password=hash_password("AgentPass123!"),
            is_super_admin=False,
        )
        db.add(user)
        db.flush()

    membership = db.scalar(
        select(Membership).where(Membership.user_id == user.id, Membership.company_id == company.id)
    )
    if not membership:
        membership = Membership(user_id=user.id, company_id=company.id, role=agent_role)
        db.add(membership)
        db.flush()
    else:
        membership.role = agent_role

    profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == membership.id))
    if not profile:
        profile = AgentProfile(
            company_id=company.id,
            membership_id=membership.id,
            phone="+91 98765 43210",
            alternate_phone="+91 98250 11223",
            address_line_1="B-402, Sun Avenue",
            address_line_2="Vesu",
            city="Surat",
            state="Gujarat",
            postal_code="395007",
            opening_balance=Decimal("12500.00"),
        )
        db.add(profile)
        db.flush()

    customer_rows = [
        ("Mehul Patel", "mehul@example.com", "+91 98980 11001", "Udhna, Surat", "3.24 kW Residential Rooftop", "active", "18500.00", "PGVCL-1001", "PGVCL", "residential"),
        ("Nisha Desai", "nisha@example.com", "+91 98251 22002", "Palsana, Surat", "5.00 kW Residential Rooftop", "active", "42000.00", "PGVCL-1002", "PGVCL", "residential"),
        ("Harsh Mehta", "harsh@example.com", "+91 99090 33003", "Adajan, Surat", "3.60 kW Residential Rooftop", "proposal", "75000.00", "DGVCL-1003", "DGVCL", "residential"),
        ("Krupa Shah", "krupa@example.com", "+91 97277 44004", "Morbi, Gujarat", "6.00 kW Residential Rooftop", "on_hold", "62500.00", "PGVCL-1004", "PGVCL", "residential"),
    ]
    for name, customer_email, phone, address, project, status, outstanding, consumer_number, provider, customer_type in customer_rows:
        customer = db.scalar(
            select(AgentCustomer).where(
                AgentCustomer.agent_profile_id == profile.id,
                AgentCustomer.customer_name == name,
            )
        )
        if not customer:
            customer = AgentCustomer(
                company_id=company.id,
                agent_profile_id=profile.id,
                customer_name=name,
                email=customer_email,
                phone=phone,
                address=address,
                project_name=project,
                status=status,
                outstanding_balance=Decimal(outstanding),
            )
            db.add(customer)
        customer.company_name = ""
        customer.email = customer_email
        customer.phone = phone
        customer.address = address
        customer.billing_address = address
        customer.site_address = address
        customer.district = "Surat" if "Surat" in address else "Morbi"
        customer.state = "Gujarat"
        customer.consumer_number = consumer_number
        customer.electricity_provider = provider
        customer.customer_type = customer_type
        customer.lead_source = "Agent referral"
        customer.project_name = project
        customer.status = status
        customer.outstanding_balance = Decimal(outstanding)

    transaction_rows = [
        (-35, "AGT-OPEN-001", "opening_adjustment", "Opening balance verification", "0.00", "2500.00"),
        (-24, "COM-2026-041", "commission", "Commission for Patel Textiles milestone", "0.00", "18500.00"),
        (-18, "EXP-2026-016", "expense", "Approved site travel reimbursement adjustment", "2300.00", "0.00"),
        (-11, "PAY-2026-027", "payout", "Agent payout through bank transfer", "10000.00", "0.00"),
        (-4, "COM-2026-052", "commission", "Commission for Desai Foods procurement milestone", "0.00", "22400.00"),
    ]
    for days, reference, transaction_type, description, debit, credit in transaction_rows:
        transaction = db.scalar(
            select(AgentTransaction).where(
                AgentTransaction.agent_profile_id == profile.id,
                AgentTransaction.reference == reference,
            )
        )
        if not transaction:
            transaction = AgentTransaction(
                    company_id=company.id,
                    agent_profile_id=profile.id,
                    created_by_membership_id=membership.id,
                    transaction_date=datetime.now(UTC) + timedelta(days=days),
                    reference=reference,
                    transaction_type=transaction_type,
                    description=description,
                    debit=Decimal(debit),
                    credit=Decimal(credit),
                )
            db.add(transaction)
            db.flush()
            db.add(TransactionApproval(
                company_id=company.id,
                transaction_id=transaction.id,
                submitted_by_membership_id=membership.id,
                status="approved",
                decided_by_membership_id=membership.id,
                decided_at=datetime.now(UTC),
                decision_comment="Seeded approved transaction",
            ))


def _seed_business_defaults(db: Session, company: Company, membership: Membership) -> None:
    account_defaults = [
        ("Office Cash", "cash", "", ""),
        ("Primary Bank Account", "bank", "", ""),
    ]
    for name, account_type, bank_name, masked in account_defaults:
        row = db.scalar(select(FinancialAccount).where(FinancialAccount.company_id == company.id, FinancialAccount.name == name))
        if not row:
            db.add(FinancialAccount(company_id=company.id, name=name, account_type=account_type, bank_name=bank_name, masked_account_number=masked, opening_balance=Decimal("0.00")))

    category_defaults = [
        ("customer_payment", "Customer Payment", "income"),
        ("subsidy_received", "Subsidy Received", "income"),
        ("office_rent", "Office Rent", "expense"),
        ("salary", "Salary", "expense"),
        ("agent_commission", "Agent Commission", "expense"),
        ("transport", "Transport", "expense"),
        ("fuel", "Fuel", "expense"),
        ("installation_labour", "Installation Labour", "expense"),
        ("site_expense", "Site Expense", "expense"),
        ("bank_charges", "Bank Charges", "expense"),
        ("marketing", "Marketing", "expense"),
        ("miscellaneous", "Miscellaneous", "expense"),
    ]
    for code, name, category_type in category_defaults:
        row = db.scalar(select(FinanceCategory).where(FinanceCategory.company_id == company.id, FinanceCategory.code == code))
        if not row:
            db.add(FinanceCategory(company_id=company.id, code=code, name=name, category_type=category_type))

    if not db.scalar(select(InventoryLocation).where(InventoryLocation.company_id == company.id, InventoryLocation.name == "Main Warehouse")):
        db.add(InventoryLocation(company_id=company.id, name="Main Warehouse", location_type="warehouse", address=""))

    if not db.scalar(select(PricingBook).where(PricingBook.company_id == company.id, PricingBook.is_default.is_(True))):
        db.add(PricingBook(company_id=company.id, name="Master Price List", version=1, is_default=True, is_active=True, created_by=membership.id, updated_by=membership.id))


def seed_development_data(db: Session) -> None:
    if settings.is_production:
        raise RuntimeError("Development seed data is disabled in production")
    company = db.scalar(select(Company).where(Company.code == settings.seed_company_code.upper()))
    if not company:
        company = Company(name=settings.seed_company_name, code=settings.seed_company_code.upper())
        db.add(company)
        db.flush()

    permissions_by_code: dict[str, Permission] = {}
    for code, (name, description) in PERMISSIONS.items():
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if not permission:
            permission = Permission(code=code, name=name, description=description)
            db.add(permission)
            db.flush()
        else:
            permission.name = name
            permission.description = description
        permissions_by_code[code] = permission

    roles_by_code: dict[str, Role] = {}
    for code, blueprint in ROLE_BLUEPRINTS.items():
        role = db.scalar(select(Role).where(Role.company_id == company.id, Role.code == code))
        if not role:
            role = Role(
                company_id=company.id,
                code=code,
                name=str(blueprint["name"]),
                description=str(blueprint["description"]),
                is_system=True,
            )
            db.add(role)
            db.flush()
        role.name = str(blueprint["name"])
        role.description = str(blueprint["description"])
        role.is_system = True
        role.permissions = [
            permissions_by_code[permission_code]
            for permission_code in blueprint["permissions"]
        ]
        roles_by_code[code] = role

    username = settings.seed_admin_username.strip().lower()
    email = str(settings.seed_admin_email).lower()
    user = db.scalar(select(User).where(User.username == username))
    if not user:
        user = User(
            username=username,
            email=email,
            full_name=settings.seed_admin_name,
            hashed_password=hash_password(settings.seed_admin_password),
            is_super_admin=True,
        )
        db.add(user)
        db.flush()
    else:
        user.is_super_admin = True

    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.company_id == company.id,
        )
    )
    if not membership:
        membership = Membership(
            user_id=user.id,
            company_id=company.id,
            role=roles_by_code["super_admin"],
        )
        db.add(membership)
        db.flush()
    else:
        membership.role = roles_by_code["super_admin"]

    _seed_agent_workspace(db, company, roles_by_code["agent"])
    _seed_business_defaults(db, company, membership)
    db.commit()
