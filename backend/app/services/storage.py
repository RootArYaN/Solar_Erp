from __future__ import annotations

import hashlib
import re
import shlex
import shutil
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from threading import Lock
from time import monotonic
from uuid import uuid4

from fastapi import UploadFile

from app.core.config import settings


class StorageError(Exception):
    pass


@dataclass(frozen=True)
class UploadCandidate:
    path: Path
    size_bytes: int
    checksum: str


def safe_relative_path(value: str) -> str:
    supplied = value.strip()
    if supplied.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", supplied):
        raise StorageError("Unsafe storage path")
    raw = supplied.replace("\\", "/").strip("/")
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise StorageError("Unsafe storage path")
    return path.as_posix()


class StorageBackend:
    def __init__(self, temp_root: Path | None = None):
        self.temp_root = (temp_root or settings.storage_temp_root).resolve()
        self.temp_root.mkdir(parents=True, exist_ok=True, mode=0o700)

    @contextmanager
    def prepare_upload(self, upload: UploadFile, max_bytes: int) -> Iterator[UploadCandidate]:
        digest = hashlib.sha256()
        total = 0
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix="upload-",
                suffix=".candidate",
                dir=self.temp_root,
                delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                while True:
                    chunk = upload.file.read(settings.upload_chunk_bytes)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        raise StorageError(
                            f"File exceeds the {settings.max_upload_mb} MB upload limit"
                        )
                    digest.update(chunk)
                    handle.write(chunk)
            yield UploadCandidate(temporary_path, total, digest.hexdigest())
        except Exception:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise
        finally:
            upload.file.close()
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def scan_path(self, path: Path) -> None:
        command = settings.malware_scan_command.strip()
        if not command:
            if settings.require_malware_scan:
                raise StorageError("Malware scanning is required but not configured")
            return
        arguments = shlex.split(command)
        target = str(path.resolve())
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

    def put_file(
        self,
        source: Path,
        relative_path: str,
        *,
        content_type: str,
        checksum: str,
    ) -> str:
        raise NotImplementedError

    @contextmanager
    def materialize(self, relative_path: str) -> Iterator[Path]:
        raise NotImplementedError

    def iter_bytes(self, relative_path: str) -> Iterator[bytes]:
        raise NotImplementedError

    def exists(self, relative_path: str) -> bool:
        raise NotImplementedError

    def size(self, relative_path: str) -> int:
        raise NotImplementedError

    def copy(self, source: str, target: str) -> str:
        raise NotImplementedError

    def delete(self, relative_path: str) -> None:
        raise NotImplementedError

    def stage_delete(self, relative_path: str) -> str | None:
        raise NotImplementedError

    def restore_staged_delete(self, staged_relative: str, original_relative: str) -> None:
        raise NotImplementedError

    def finalize_staged_delete(self, staged_relative: str) -> None:
        raise NotImplementedError

    def check_ready(self) -> None:
        raise NotImplementedError


class LocalStorage(StorageBackend):
    def __init__(self, root: Path | None = None, temp_root: Path | None = None):
        self.root = (root or settings.storage_root).resolve()
        self.active_root = self.root / "active"
        effective_temp = temp_root or (self.root / "temp")
        super().__init__(effective_temp)
        for path in (self.root, self.active_root, self.temp_root):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)

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

    def put_file(
        self,
        source: Path,
        relative_path: str,
        *,
        content_type: str,
        checksum: str,
    ) -> str:
        del content_type, checksum
        relative = safe_relative_path(relative_path)
        target = self.path(relative)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_name(f".{target.name}.{uuid4().hex}.upload")
        try:
            shutil.copyfile(source, temporary)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        return relative

    @contextmanager
    def materialize(self, relative_path: str) -> Iterator[Path]:
        path = self.path(relative_path)
        if not path.is_file():
            raise StorageError("Stored file is missing")
        yield path

    def iter_bytes(self, relative_path: str) -> Iterator[bytes]:
        with self.path(relative_path).open("rb") as handle:
            while chunk := handle.read(settings.upload_chunk_bytes):
                yield chunk

    def copy(self, source: str, target: str) -> str:
        source_path = self.path(source)
        target_relative = safe_relative_path(target)
        target_path = self.path(target_relative)
        target_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copy2(source_path, target_path)
        return target_relative

    def delete(self, relative_path: str) -> None:
        self.path(relative_path).unlink(missing_ok=True)

    def stage_delete(self, relative_path: str) -> str | None:
        source = self.path(relative_path)
        if not source.exists():
            return None
        staged_relative = f"temp/delete-{uuid4().hex}/{source.name}"
        staged = self.path(staged_relative)
        staged.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        source.replace(staged)
        return staged_relative

    def restore_staged_delete(self, staged_relative: str, original_relative: str) -> None:
        staged = self.path(staged_relative)
        if not staged.exists():
            return
        original = self.path(original_relative)
        original.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
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

    def check_ready(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        probe = self.root / f".ready-{uuid4().hex}"
        probe.write_bytes(b"ready")
        probe.unlink(missing_ok=True)


class S3Storage(StorageBackend):
    def __init__(self, *, client=None, temp_root: Path | None = None):
        super().__init__(temp_root)
        self.provider = settings.normalized_s3_provider
        self.bucket = settings.s3_bucket.strip()
        self.prefix = settings.normalized_s3_prefix
        if not self.bucket:
            raise StorageError("S3 bucket is not configured")
        if client is None:
            try:
                import boto3
                from botocore.config import Config
            except ImportError as exc:
                raise StorageError("boto3 is required when STORAGE_TYPE=s3") from exc
            config_options: dict[str, object] = {
                "signature_version": "s3v4",
                "retries": {"max_attempts": 5, "mode": "standard"},
                "s3": {"addressing_style": settings.s3_addressing_style},
            }
            if self.provider == "r2":
                # Newer botocore releases add optional AWS checksum headers by
                # default. R2 supports only a subset, so send them only when an
                # operation requires one.
                config_options["request_checksum_calculation"] = "when_required"
                config_options["response_checksum_validation"] = "when_required"
            client_options: dict[str, object] = {
                "service_name": "s3",
                "region_name": settings.s3_region or None,
                "endpoint_url": settings.s3_endpoint_url or None,
                "config": Config(**config_options),
            }
            if settings.s3_access_key_id:
                client_options["aws_access_key_id"] = settings.s3_access_key_id
                client_options["aws_secret_access_key"] = settings.s3_secret_access_key
                if settings.s3_session_token:
                    client_options["aws_session_token"] = settings.s3_session_token
            self.client = boto3.client(**client_options)
        else:
            self.client = client
        self._last_write_probe_at: float | None = None
        self._write_probe_lock = Lock()

    def path(self, relative_path: str) -> Path:
        del relative_path
        raise StorageError("S3 objects do not have stable local filesystem paths; use materialize()")

    def _key(self, relative_path: str) -> str:
        relative = safe_relative_path(relative_path)
        return f"{self.prefix}/{relative}" if self.prefix else relative

    def _encryption_args(self) -> dict[str, str]:
        if self.provider == "r2":
            # R2 encrypts every object at rest with provider-managed AES-256
            # and rejects AWS's x-amz-server-side-encryption request headers.
            return {}
        values = {"ServerSideEncryption": settings.s3_sse_algorithm}
        if settings.s3_sse_algorithm == "aws:kms":
            values["SSEKMSKeyId"] = settings.s3_kms_key_id
        return values

    def _head(self, relative_path: str):
        return self.client.head_object(Bucket=self.bucket, Key=self._key(relative_path))

    def exists(self, relative_path: str) -> bool:
        try:
            self._head(relative_path)
            return True
        except Exception as exc:
            response = getattr(exc, "response", {})
            code = str(response.get("Error", {}).get("Code", ""))
            status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
                return False
            raise StorageError("Object storage availability check failed") from exc

    def size(self, relative_path: str) -> int:
        try:
            return int(self._head(relative_path)["ContentLength"])
        except Exception as exc:
            raise StorageError("Could not read object metadata") from exc

    def put_file(
        self,
        source: Path,
        relative_path: str,
        *,
        content_type: str,
        checksum: str,
    ) -> str:
        relative = safe_relative_path(relative_path)
        try:
            content_length = source.stat().st_size
            with source.open("rb") as body:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=self._key(relative),
                    Body=body,
                    ContentLength=content_length,
                    ContentType=content_type,
                    Metadata={"sha256": checksum},
                    **self._encryption_args(),
                )
        except Exception as exc:
            raise StorageError("Could not persist the validated upload") from exc
        return relative

    @contextmanager
    def materialize(self, relative_path: str) -> Iterator[Path]:
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                prefix="object-",
                suffix=".materialized",
                dir=self.temp_root,
                delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
            self.client.download_file(self.bucket, self._key(relative_path), str(temporary_path))
            yield temporary_path
        except Exception as exc:
            raise StorageError("Could not download the stored object") from exc
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def iter_bytes(self, relative_path: str) -> Iterator[bytes]:
        body = None
        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self._key(relative_path))
            body = response["Body"]
            for chunk in body.iter_chunks(chunk_size=settings.upload_chunk_bytes):
                if chunk:
                    yield chunk
        except Exception as exc:
            raise StorageError("Could not stream the stored object") from exc
        finally:
            if body is not None:
                body.close()

    def copy(self, source: str, target: str) -> str:
        target_relative = safe_relative_path(target)
        try:
            self.client.copy_object(
                Bucket=self.bucket,
                Key=self._key(target_relative),
                CopySource={"Bucket": self.bucket, "Key": self._key(source)},
                MetadataDirective="COPY",
                **self._encryption_args(),
            )
        except Exception as exc:
            raise StorageError("Could not copy the stored object") from exc
        return target_relative

    def delete(self, relative_path: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=self._key(relative_path))
        except Exception as exc:
            raise StorageError("Could not delete the stored object") from exc

    def stage_delete(self, relative_path: str) -> str | None:
        relative = safe_relative_path(relative_path)
        if not self.exists(relative):
            return None
        staged = f"temp/delete-{uuid4().hex}/{PurePosixPath(relative).name}"
        self.copy(relative, staged)
        try:
            self.delete(relative)
        except Exception:
            self.delete(staged)
            raise
        return staged

    def restore_staged_delete(self, staged_relative: str, original_relative: str) -> None:
        if not self.exists(staged_relative):
            return
        self.copy(staged_relative, original_relative)
        self.delete(staged_relative)

    def finalize_staged_delete(self, staged_relative: str) -> None:
        self.delete(staged_relative)

    def check_ready(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except Exception as exc:
            raise StorageError("Object storage is not readable") from exc

        now = monotonic()
        interval = settings.storage_write_probe_interval_seconds
        if (
            self._last_write_probe_at is not None
            and now - self._last_write_probe_at < interval
        ):
            return

        # Recheck after taking the lock so simultaneous readiness requests only
        # perform one billable write probe per process and interval.
        with self._write_probe_lock:
            now = monotonic()
            if (
                self._last_write_probe_at is not None
                and now - self._last_write_probe_at < interval
            ):
                return
            probe = f"temp/readiness/{uuid4().hex}"
            try:
                self.client.put_object(
                    Bucket=self.bucket,
                    Key=self._key(probe),
                    Body=b"ready",
                    ContentLength=len(b"ready"),
                    ContentType="text/plain",
                    Metadata={"sha256": hashlib.sha256(b"ready").hexdigest()},
                    **self._encryption_args(),
                )
                self.client.delete_object(Bucket=self.bucket, Key=self._key(probe))
            except Exception as exc:
                raise StorageError("Object storage is not writable") from exc
            self._last_write_probe_at = monotonic()


def build_storage() -> StorageBackend:
    if settings.storage_type == "s3":
        return S3Storage()
    return LocalStorage()


storage = build_storage()
