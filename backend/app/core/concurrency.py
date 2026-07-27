from __future__ import annotations

from fastapi import status


class RecordConflictError(Exception):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, current_version: int):
        super().__init__("This record was updated by another user. Reload the latest data before saving.")
        self.current_version = current_version


def verify_version(record, expected_version: int) -> None:
    current = int(getattr(record, "version", 1))
    if current != expected_version:
        raise RecordConflictError(current)
