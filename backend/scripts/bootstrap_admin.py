from __future__ import annotations

import os
import sys

from app.core.config import settings
from app.db.seed import bootstrap_super_admin
from app.db.session import SessionLocal


def main() -> int:
    if not settings.is_production:
        print("Production administrator bootstrap requires ENVIRONMENT=production.", file=sys.stderr)
        return 64
    if os.getenv("BOOTSTRAP_ADMIN_ENABLED", "").strip().lower() != "true":
        print("Production administrator bootstrap is not enabled.", file=sys.stderr)
        return 64

    password = settings.seed_admin_password
    if password == "ChangeMe123!" or len(password) < 12:
        print(
            "SEED_ADMIN_PASSWORD must be a non-default password with at least 12 characters.",
            file=sys.stderr,
        )
        return 64

    with SessionLocal() as db:
        bootstrap_super_admin(db, allow_production=True)
    print(f"Initial administrator '{settings.seed_admin_username}' is ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
