from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.db.migrate import ACTIVE_MIGRATION_IDS, MIGRATION_CHECKSUMS
from app.db.session import session_scope
from app.services.storage import storage

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready() -> dict[str, str]:
    try:
        with session_scope() as db:
            db.execute(text("SELECT 1"))
            rows = db.execute(text("SELECT id, checksum FROM schema_migrations")).all()
            applied = {str(row.id): str(row.checksum or "") for row in rows}
            if any(
                applied.get(migration_id) != MIGRATION_CHECKSUMS[migration_id]
                for migration_id in ACTIVE_MIGRATION_IDS
            ):
                raise RuntimeError("Database migrations are incomplete or inconsistent")
        storage.check_ready()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Database schema or storage is not ready",
        ) from exc
    return {"status": "ready"}
