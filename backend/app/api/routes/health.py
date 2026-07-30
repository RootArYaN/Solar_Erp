from fastapi import APIRouter, HTTPException
from sqlalchemy import text

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
        storage.check_ready()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database or storage is not ready") from exc
    return {"status": "ready"}
