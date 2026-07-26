from __future__ import annotations

import argparse
import logging
import time

from app.db.session import SessionLocal
from app.services.archive_service import claim_next_job, process_job

logger = logging.getLogger(__name__)


def run_once() -> bool:
    with SessionLocal() as db:
        job = claim_next_job(db)
        if not job:
            return False
        try:
            process_job(db, job)
        except Exception:
            logger.exception("Archive job %s failed", job.id)
        return True


def run_forever(interval: float = 2.0) -> None:
    logger.info("Archive worker started")
    while True:
        if not run_once():
            time.sleep(interval)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description="Process Solar ERP archive jobs")
    parser.add_argument("--once", action="store_true", help="Process one queued job and exit")
    parser.add_argument("--interval", type=float, default=2.0, help="Idle polling interval in seconds")
    args = parser.parse_args()
    if args.once:
        run_once()
        return
    run_forever(max(0.5, args.interval))


if __name__ == "__main__":
    main()
