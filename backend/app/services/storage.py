from __future__ import annotations

import hashlib
import shutil
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from fastapi import UploadFile

from app.core.config import settings


class StorageError(Exception):
    pass


def safe_relative_path(value: str) -> str:
    raw = value.replace("\\", "/").strip("/")
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise StorageError("Unsafe storage path")
    return path.as_posix()


class LocalStorage:
    def __init__(self, root: Path | None = None):
        self.root = (root or settings.storage_root).resolve()
        self.active_root = self.root / "active"
        self.temp_root = self.root / "temp"
        for path in (self.active_root, self.temp_root):
            path.mkdir(parents=True, exist_ok=True)

    def path(self, relative_path: str) -> Path:
        relative = safe_relative_path(relative_path)
        target = (self.root / relative).resolve()
        if self.root not in target.parents:
            raise StorageError("Storage path escapes the configured root")
        return target

    def exists(self, relative_path: str) -> bool:
        return self.path(relative_path).is_file()

    def size(self, relative_path: str) -> int:
        return self.path(relative_path).stat().st_size

    def checksum(self, relative_path: str) -> str:
        digest = hashlib.sha256()
        with self.path(relative_path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def open(self, relative_path: str, mode: str = "rb") -> BinaryIO:
        return self.path(relative_path).open(mode)

    def copy(self, source: str, target: str) -> str:
        source_path = self.path(source)
        target_path = self.path(target)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target_path)
        return safe_relative_path(target)

    def delete(self, relative_path: str) -> None:
        target = self.path(relative_path)
        if target.exists():
            target.unlink()

    def delete_tree(self, relative_path: str) -> None:
        target = self.path(relative_path)
        if target.exists() and target.is_dir():
            shutil.rmtree(target)

    async def save_upload(self, upload: UploadFile, relative_path: str, max_bytes: int) -> tuple[int, str]:
        target = self.path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        digest = hashlib.sha256()
        try:
            with target.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise StorageError(f"File exceeds the {settings.max_upload_mb} MB upload limit")
                    digest.update(chunk)
                    handle.write(chunk)
        except Exception:
            target.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()
        return total, digest.hexdigest()


storage = LocalStorage()
