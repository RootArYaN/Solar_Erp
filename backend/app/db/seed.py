from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.models.auth import Company, Membership, Permission, Role, User

PERMISSIONS = {
    "dashboard.view": ("View dashboard", "Open the company workspace and summary cards."),
    "users.view": ("View users", "View company users and their assigned roles."),
    "users.manage": ("Manage users", "Create, edit, activate and reset company users."),
    "roles.view": ("View roles", "View roles and the permission catalogue."),
    "roles.manage": ("Manage roles", "Create custom roles and change role permissions."),
    "inventory.view": ("View inventory", "View products, warehouses and stock balances."),
    "inventory.manage": ("Manage inventory", "Create stock movements and inventory records."),
    "projects.view": ("View EPC projects", "View surveys, projects and project progress."),
    "projects.manage": ("Manage EPC projects", "Create and update EPC project workflows."),
    "documents.view": ("View documents", "View company and project documents."),
    "documents.manage": ("Manage documents", "Create, approve and version documents."),
    "finance.view": ("View finance", "View ledgers, invoices and company financial reports."),
    "finance.manage": ("Manage finance", "Create and post finance transactions."),
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


def seed_development_data(db: Session) -> None:
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
        is_new = role is None
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
        if is_new or code in {"company_admin", "super_admin"}:
            role.permissions = [
                permissions_by_code[permission_code]
                for permission_code in blueprint["permissions"]
            ]
        roles_by_code[code] = role

    email = str(settings.seed_admin_email).lower()
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        user = User(
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
        membership = Membership(user_id=user.id, company_id=company.id)
        db.add(membership)
        db.flush()

    for role_code in ("company_admin", "super_admin"):
        role = roles_by_code[role_code]
        if role not in membership.roles:
            membership.roles.append(role)

    db.commit()
