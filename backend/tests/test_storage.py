from pathlib import Path

import pytest

from app.services.storage import LocalStorage, StorageError, safe_relative_path


def test_safe_relative_path_rejects_traversal():
    with pytest.raises(StorageError):
        safe_relative_path("../secret.txt")
    with pytest.raises(StorageError):
        safe_relative_path("/absolute/path")
    with pytest.raises(StorageError):
        safe_relative_path(r"C:\Windows\secret.txt")
    with pytest.raises(StorageError):
        safe_relative_path(r"\\server\share\secret.txt")


def test_staged_delete_can_be_restored_or_finalized(tmp_path: Path):
    storage = LocalStorage(tmp_path)
    original = "active/company/file.pdf"
    path = storage.path(original)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"pdf")

    staged = storage.stage_delete(original)
    assert staged and not path.exists()
    storage.restore_staged_delete(staged, original)
    assert path.read_bytes() == b"pdf"

    staged = storage.stage_delete(original)
    assert staged
    storage.finalize_staged_delete(staged)
    assert not path.exists()
