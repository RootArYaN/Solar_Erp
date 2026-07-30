from __future__ import annotations

import argparse
import socket
import struct
import sys
from pathlib import Path


def scan(path: Path, *, host: str, port: int, timeout: float) -> str:
    if not path.is_file():
        raise RuntimeError("scan target is not a regular file")

    with socket.create_connection((host, port), timeout=timeout) as connection:
        connection.settimeout(timeout)
        connection.sendall(b"zINSTREAM\0")
        with path.open("rb") as source:
            while chunk := source.read(64 * 1024):
                connection.sendall(struct.pack("!I", len(chunk)))
                connection.sendall(chunk)
        connection.sendall(struct.pack("!I", 0))

        response = bytearray()
        while len(response) < 4096:
            chunk = connection.recv(4096)
            if not chunk:
                break
            response.extend(chunk)
            if b"\0" in chunk or b"\n" in chunk:
                break

    message = response.rstrip(b"\0\r\n").decode("utf-8", errors="replace")
    if not message:
        raise RuntimeError("clamd returned an empty response")
    return message


def main() -> int:
    parser = argparse.ArgumentParser(description="Stream one file to a clamd service")
    parser.add_argument("path", type=Path)
    parser.add_argument("--host", default="malware-scanner")
    parser.add_argument("--port", type=int, default=3310)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()

    try:
        result = scan(args.path, host=args.host, port=args.port, timeout=args.timeout)
    except (OSError, RuntimeError) as exc:
        print(f"Malware scan failed: {exc}", file=sys.stderr)
        return 2

    if result.endswith(" OK"):
        return 0
    print(result, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
