from __future__ import annotations

import struct
from pathlib import Path

from scripts import clamd_scan


class FakeClamdConnection:
    def __init__(self, response: bytes):
        self.response = response
        self.sent = bytearray()
        self.timeout = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def settimeout(self, timeout: float) -> None:
        self.timeout = timeout

    def sendall(self, payload: bytes) -> None:
        self.sent.extend(payload)

    def recv(self, _size: int) -> bytes:
        response, self.response = self.response, b""
        return response


def test_clamd_client_streams_file(monkeypatch, tmp_path: Path) -> None:
    candidate = tmp_path / "candidate.txt"
    candidate.write_bytes(b"safe file")
    connection = FakeClamdConnection(b"stream: OK\0")
    monkeypatch.setattr(
        clamd_scan.socket,
        "create_connection",
        lambda address, timeout: connection,
    )

    result = clamd_scan.scan(candidate, host="scanner", port=3310, timeout=5)

    assert result == "stream: OK"
    assert connection.timeout == 5
    assert connection.sent.startswith(b"zINSTREAM\0")
    assert struct.pack("!I", len(b"safe file")) + b"safe file" in connection.sent
    assert connection.sent.endswith(struct.pack("!I", 0))
