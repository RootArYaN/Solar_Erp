from __future__ import annotations

import hashlib
import re
import shlex
import shutil
import subprocess
from pathlib import Path, PurePosixPath
from typing import BinaryIO
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings


class StorageError(Exception):
    pass


def safe_relative_path(value: str) -> str:
    supplied = value.strip()
    if supplied.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", supplied):
        raise StorageError("Unsafe storage path")
    raw = supplied.replace("\\", "/").strip("/")
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
            for chunk in iter(lambda: handle.read(settings.upload_chunk_bytes), b""):
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

    def stage_delete(self, relative_path: str) -> str | None:
        source = self.path(relative_path)
        if not source.exists():
            return None
        staged_relative = f"temp/delete-{uuid4().hex}/{source.name}"
        staged = self.path(staged_relative)
        staged.parent.mkdir(parents=True, exist_ok=True)
        source.replace(staged)
        return staged_relative

    def restore_staged_delete(self, staged_relative: str, original_relative: str) -> None:
        staged = self.path(staged_relative)
        if not staged.exists():
            return
        original = self.path(original_relative)
        original.parent.mkdir(parents=True, exist_ok=True)
        staged.replace(original)
        self._remove_empty_parent(staged.parent)

    def finalize_staged_delete(self, staged_relative: str) -> None:
        staged = self.path(staged_relative)
        staged.unlink(missing_ok=True)
        self._remove_empty_parent(staged.parent)

    def _remove_empty_parent(self, path: Path) -> None:
        if path != self.temp_root and path.exists():
            try:
                path.rmdir()
            except OSError:
                pass

    def scan(self, relative_path: str) -> None:
        command = settings.malware_scan_command.strip()
        if not command:
            if settings.require_malware_scan:
                raise StorageError("Malware scanning is required but not configured")
            return
        target = str(self.path(relative_path))
        arguments = shlex.split(command)
        if any("{path}" in item for item in arguments):
            arguments = [item.replace("{path}", target) for item in arguments]
        else:
            arguments.append(target)
        try:
            result = subprocess.run(
                arguments,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=settings.malware_scan_timeout_seconds,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise StorageError("The malware scanner could not inspect the upload") from exc
        if result.returncode != 0:
            raise StorageError("The uploaded file failed malware scanning")

    def save_upload(self, upload: UploadFile, relative_path: str, max_bytes: int) -> tuple[int, str]:
        target = self.path(relative_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        digest = hashlib.sha256()
        try:
            with target.open("wb") as handle:
                while True:
                    chunk = upload.file.read(settings.upload_chunk_bytes)
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
            upload.file.close()
        return total, digest.hexdigest()


storage = LocalStorage()
