from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.auth import Company, Membership, Permission, Role, User

PERMISSIONS = {
    "dashboard.view": ("Show Overview tab", "Show the overview dashboard."),
    "customers.view": ("Show Customers tab", "Open customer records and workflow."),
    "customers.create": ("Create customers", "Create customer records."),
    "customers.edit": ("Edit customers", "Change customer records."),
    "sites.view": ("View customer sites", "View customer installation sites."),
    "sites.create": ("Create customer sites", "Create installation sites."),
    "sites.edit": ("Edit customer sites", "Change installation sites."),
    "quotations.view": ("View quotations", "View quotation records and revisions."),
    "quotations.create": ("Create quotations", "Create quotation drafts and revisions."),
    "quotations.edit": ("Edit quotations", "Change quotation drafts."),
    "quotations.approve": ("Approve quotations", "Approve or reject quotation revisions."),
    "projects.view": ("View projects", "View EPC projects and their progress."),
    "projects.create": ("Create projects", "Create EPC project records."),
    "projects.edit": ("Edit projects", "Change EPC project records."),
    "projects.manage": ("Manage projects", "Perform existing project-management operations."),
    "material_requests.view": ("View material requests", "View project material requests."),
    "material_requests.create": ("Create material requests", "Create project material requests."),
    "material_requests.edit": ("Edit material requests", "Change material-request drafts."),
    "material_requests.approve": ("Approve material requests", "Approve or reject material requests."),
    "inventory.view": ("Show Inventory tab", "View products, warehouses and stock balances."),
    "inventory.create": ("Create inventory records", "Create inventory items and movements."),
    "inventory.edit": ("Edit inventory records", "Change inventory records."),
    "inventory.approve": ("Approve stock changes", "Approve physical stock posting."),
    "inventory.manage": ("Manage inventory", "Perform existing inventory-management operations."),
    "pricing.view": ("Show Solar pricing tab", "Open solar pricing."),
    "pricing.create": ("Create pricing", "Create pricing records."),
    "pricing.edit": ("Edit pricing", "Change pricing records."),
    "pricing.approve": ("Approve pricing", "Approve pricing records."),
    "documents.view": ("Show Customer data tab", "View customer and project documents."),
    "documents.create": ("Create documents", "Create generated document packs and upload files."),
    "documents.edit": ("Edit documents", "Change generated document drafts and metadata."),
    "documents.approve": ("Approve documents", "Finalize generated document versions."),
    "documents.manage": ("Manage documents", "Manage shared company document templates and all document operations."),
    "posters.view": ("Show Posters tab", "Open the poster library."),
    "posters.create": ("Upload posters", "Upload posters to the library."),
    "posters.edit": ("Edit posters", "Rename and change poster metadata."),
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
    "finance.view": ("View finance", "View ledgers, bills, accounts and company financial reports."),
    "finance.manage": ("Manage finance", "Create and post finance transactions, bills and account movements."),
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
            "documents.create",
            "documents.edit",
            "posters.view",
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
            "documents.approve",
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


def ensure_identity_defaults(db: Session, company: Company) -> dict[str, Role]:
    """Create missing permissions, built-in roles, and required role links.

    Existing names, descriptions, flags, and extra permission assignments are
    deliberately preserved. This makes the initializer safe to run after an
    administrator has customized the database.
    """
    permissions_by_code: dict[str, Permission] = {}
    for code, (name, description) in PERMISSIONS.items():
        permission = db.scalar(select(Permission).where(Permission.code == code))
        if not permission:
            permission = Permission(code=code, name=name, description=description)
            db.add(permission)
            db.flush()
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
        assigned_codes = {permission.code for permission in role.permissions}
        role.permissions.extend(
            permissions_by_code[permission_code]
            for permission_code in blueprint["permissions"]
            if permission_code not in assigned_codes
        )
        roles_by_code[code] = role
    return roles_by_code


def bootstrap_super_admin(db: Session, *, allow_production: bool = False) -> None:
    """Ensure required identity rows and create the initial administrator once."""
    if settings.is_production and not allow_production:
        raise RuntimeError("Development bootstrap is disabled in production")

    username = settings.seed_admin_username.strip().lower()
    email = str(settings.seed_admin_email).strip().lower()
    company = db.scalar(select(Company).where(Company.code == settings.seed_company_code.upper()))
    if not company:
        company = Company(name=settings.seed_company_name, code=settings.seed_company_code.upper())
        db.add(company)
        db.flush()

    roles_by_code = ensure_identity_defaults(db, company)
    username_user = db.scalar(select(User).where(User.username == username))
    email_user = db.scalar(select(User).where(User.email == email))
    if username_user and email_user and username_user.id != email_user.id:
        raise RuntimeError(
            "Bootstrap conflict: SEED_ADMIN_USERNAME and SEED_ADMIN_EMAIL belong "
            "to different existing users"
        )
    existing_user = username_user or email_user
    if existing_user:
        if existing_user.username != username or existing_user.email.lower() != email:
            raise RuntimeError(
                "Bootstrap conflict: the configured admin username/email does not "
                "exactly identify one existing user"
            )
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == existing_user.id,
                Membership.company_id == company.id,
            )
        )
        if (
            not existing_user.is_super_admin
            or not membership
            or membership.role_id != roles_by_code["super_admin"].id
        ):
            raise RuntimeError(
                "Bootstrap conflict: the configured existing user is not the "
                "super administrator for the configured company"
            )
        db.commit()
        return

    user = User(
        username=username,
        email=email,
        full_name=settings.seed_admin_name,
        hashed_password=hash_password(settings.seed_admin_password),
        is_super_admin=True,
    )
    db.add(user)
    db.flush()
    db.add(Membership(user_id=user.id, company_id=company.id, role=roles_by_code["super_admin"]))
    db.commit()
