from __future__ import annotations

import anyio.to_thread
from fastapi import status

from app.core.config import settings


async def configure_thread_pool() -> None:
    """Bound sync route/database concurrency for small cloud instances."""
    limiter = anyio.to_thread.current_default_thread_limiter()
    limiter.total_tokens = settings.thread_pool_workers


class RecordConflictError(Exception):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, current_version: int):
        super().__init__("This record was updated by another user. Reload the latest data before saving.")
        self.current_version = current_version


def verify_version(record, expected_version: int) -> None:
    current = int(getattr(record, "version", 1))
    if current != expected_version:
        raise RecordConflictError(current)
