from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready() -> dict[str, str]:
    db: Session = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        settings.storage_root.mkdir(parents=True, exist_ok=True)
        probe = settings.storage_root / ".ready"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database or storage is not ready") from exc
    finally:
        db.close()
    return {"status": "ready"}
