from pathlib import Path
from io import BytesIO

import pytest

from app.services.storage import LocalStorage, S3Storage, StorageError, safe_relative_path


class FakeS3Error(Exception):
    def __init__(self, code: str = "404"):
        super().__init__(code)
        self.response = {
            "Error": {"Code": code},
            "ResponseMetadata": {"HTTPStatusCode": int(code) if code.isdigit() else 500},
        }


class FakeStreamingBody(BytesIO):
    def iter_chunks(self, chunk_size: int):
        while chunk := self.read(chunk_size):
            yield chunk


class FakeS3Client:
    def __init__(self):
        self.objects: dict[str, tuple[bytes, dict[str, str]]] = {}
        self.copy_args: list[dict] = []
        self.put_args: list[dict] = []
        self.delete_args: list[dict] = []
        self.head_bucket_calls = 0

    def head_object(self, *, Bucket, Key):
        del Bucket
        if Key not in self.objects:
            raise FakeS3Error()
        data, metadata = self.objects[Key]
        return {"ContentLength": len(data), "Metadata": metadata}

    def download_file(self, _bucket, key, filename):
        if key not in self.objects:
            raise FakeS3Error()
        Path(filename).write_bytes(self.objects[key][0])

    def get_object(self, *, Bucket, Key):
        del Bucket
        if Key not in self.objects:
            raise FakeS3Error()
        return {"Body": FakeStreamingBody(self.objects[Key][0])}

    def copy_object(self, *, Bucket, Key, CopySource, **kwargs):
        del Bucket
        self.copy_args.append(dict(kwargs))
        source = str(CopySource["Key"])
        if source not in self.objects:
            raise FakeS3Error()
        self.objects[Key] = self.objects[source]

    def delete_object(self, *, Bucket, Key):
        self.delete_args.append({"Bucket": Bucket, "Key": Key})
        self.objects.pop(Key, None)

    def head_bucket(self, *, Bucket):
        assert Bucket
        self.head_bucket_calls += 1

    def put_object(self, *, Bucket, Key, Body, Metadata, **kwargs):
        data = Body.read() if hasattr(Body, "read") else bytes(Body)
        self.put_args.append(
            {"Bucket": Bucket, "Key": Key, "Metadata": Metadata, **kwargs}
        )
        self.objects[Key] = (data, dict(Metadata))

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


def test_default_local_storage_uses_configured_ephemeral_temp_root(tmp_path: Path, monkeypatch):
    from app.services import storage as storage_module

    persistent_root = tmp_path / "documents"
    ephemeral_root = tmp_path / "uploads"
    monkeypatch.setattr(storage_module.settings, "storage_path", str(persistent_root))
    monkeypatch.setattr(storage_module.settings, "storage_temp_path", str(ephemeral_root))

    configured = LocalStorage()

    assert configured.root == persistent_root
    assert configured.temp_root == ephemeral_root


def test_s3_storage_round_trip_and_transactional_delete(tmp_path: Path, monkeypatch):
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "s3_bucket", "private-test-bucket")
    monkeypatch.setattr(storage_module.settings, "s3_prefix", "tenant-data")
    monkeypatch.setattr(storage_module.settings, "s3_sse_algorithm", "AES256")
    client = FakeS3Client()
    storage = S3Storage(client=client, temp_root=tmp_path / "temp")
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-test")
    checksum = "a" * 64
    original = "active/company/file.pdf"

    storage.put_file(
        source,
        original,
        content_type="application/pdf",
        checksum=checksum,
    )
    assert len(client.put_args) == 1
    assert client.put_args[0]["ContentLength"] == len(b"%PDF-test")
    assert client.put_args[0]["ContentType"] == "application/pdf"
    assert client.put_args[0]["Metadata"] == {"sha256": checksum}
    assert storage.exists(original)
    assert storage.size(original) == len(b"%PDF-test")
    assert b"".join(storage.iter_bytes(original)) == b"%PDF-test"
    with storage.materialize(original) as path:
        assert path.read_bytes() == b"%PDF-test"

    staged = storage.stage_delete(original)
    assert staged and not storage.exists(original)
    storage.restore_staged_delete(staged, original)
    assert storage.exists(original)

    staged = storage.stage_delete(original)
    assert staged
    storage.finalize_staged_delete(staged)
    assert not storage.exists(original)
    storage.check_ready()


def test_s3_readiness_caches_write_probe_but_always_checks_bucket(
    tmp_path: Path,
    monkeypatch,
):
    from app.services import storage as storage_module

    monkeypatch.setattr(storage_module.settings, "s3_bucket", "private-test-bucket")
    monkeypatch.setattr(storage_module.settings, "s3_prefix", "tenant-data")
    monkeypatch.setattr(
        storage_module.settings,
        "storage_write_probe_interval_seconds",
        900,
    )
    client = FakeS3Client()
    storage = S3Storage(client=client, temp_root=tmp_path / "temp")

    storage.check_ready()
    storage.check_ready()

    assert client.head_bucket_calls == 2
    assert len(client.put_args) == 1
    assert len(client.delete_args) == 1
    assert "/temp/readiness/" in client.put_args[0]["Key"]

    storage._last_write_probe_at = None
    storage.check_ready()

    assert client.head_bucket_calls == 3
    assert len(client.put_args) == 2
    assert len(client.delete_args) == 2
