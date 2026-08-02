from __future__ import annotations

import os
import sys

from sqlalchemy import select

from app.core.config import settings
from app.db.seed import bootstrap_super_admin
from app.db.session import SessionLocal
from app.models.auth import User


def main() -> int:
    if not settings.is_production:
        print("Production administrator bootstrap requires ENVIRONMENT=production.", file=sys.stderr)
        return 64
    if os.getenv("BOOTSTRAP_ADMIN_ENABLED", "").strip().lower() != "true":
        print("Production administrator bootstrap is not enabled.", file=sys.stderr)
        return 64

    try:
        with SessionLocal() as db:
            username = settings.seed_admin_username.strip().lower()
            email = str(settings.seed_admin_email).strip().lower()
            username_user = db.scalar(select(User).where(User.username == username))
            email_user = db.scalar(select(User).where(User.email == email))
            password = settings.seed_admin_password
            if username_user is None and email_user is None and (
                password == "ChangeMe123!" or len(password) < 12
            ):
                print(
                    "SEED_ADMIN_PASSWORD must be a non-default password with at least 12 characters.",
                    file=sys.stderr,
                )
                return 64
            bootstrap_super_admin(db, allow_production=True)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 65
    print(
        f"Identity defaults and initial administrator "
        f"'{settings.seed_admin_username}' are ready."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
