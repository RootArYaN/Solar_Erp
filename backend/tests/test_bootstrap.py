from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.migrate import run_migrations
from app.db.seed import bootstrap_super_admin
from app.db.session import SessionLocal
from app.models.auth import Permission, Role


def _role(db, code: str) -> Role:
    role = db.scalar(
        select(Role)
        .where(Role.code == code)
        .options(selectinload(Role.permissions))
    )
    assert role is not None
    return role


def test_startup_does_not_reset_existing_role_permissions() -> None:
    with SessionLocal() as db:
        role = _role(db, "agent")
        original_permissions = list(role.permissions)
        posters_view = db.scalar(select(Permission).where(Permission.code == "posters.view"))
        assert posters_view is not None

        try:
            role.permissions = [posters_view]
            db.commit()

            bootstrap_super_admin(db)
            db.expire_all()

            assert {permission.code for permission in _role(db, "agent").permissions} == {
                "posters.view"
            }
        finally:
            role = _role(db, "agent")
            role.permissions = original_permissions
            db.commit()


def test_applied_migration_does_not_reassign_role_permissions() -> None:
    with SessionLocal() as db:
        role = _role(db, "accounts_admin")
        original_permissions = list(role.permissions)

        try:
            role.permissions = [
                permission
                for permission in role.permissions
                if permission.code != "finance.view"
            ]
            db.commit()

            run_migrations()
            db.expire_all()

            assert "finance.view" not in {
                permission.code
                for permission in _role(db, "accounts_admin").permissions
            }
        finally:
            role = _role(db, "accounts_admin")
            role.permissions = original_permissions
            db.commit()
