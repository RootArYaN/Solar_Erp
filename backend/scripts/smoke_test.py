from __future__ import annotations

import argparse
import json
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


def fetch_json(url: str, *, timeout: float) -> tuple[int, dict, dict[str, str]]:
    request = Request(url, headers={"User-Agent": "solar-erp-release-smoke/1"})
    with urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
        body = json.load(response)
        return response.status, body, {key.lower(): value for key, value in response.headers.items()}


def wait_for_probe(url: str, *, attempts: int, delay: float, timeout: float) -> None:
    last_error = "probe did not run"
    for attempt in range(1, attempts + 1):
        try:
            status, body, headers = fetch_json(url, timeout=timeout)
            if status != 200 or body.get("status") not in {"ok", "ready"}:
                raise RuntimeError(f"unexpected response: HTTP {status} {body!r}")
            if headers.get("x-content-type-options", "").lower() != "nosniff":
                raise RuntimeError("security headers are missing")
            print(f"PASS {url}")
            return
        except (HTTPError, URLError, OSError, ValueError, RuntimeError) as exc:
            last_error = str(exc)
            if attempt < attempts:
                time.sleep(delay)
    raise RuntimeError(f"FAIL {url}: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Solar ERP post-deployment smoke test")
    parser.add_argument("--base-url", required=True, help="Public origin, for example https://erp.example.com")
    parser.add_argument("--attempts", type=int, default=12)
    parser.add_argument("--delay", type=float, default=5)
    parser.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()

    origin = args.base_url.rstrip("/") + "/"
    for path in ("api/v1/health", "api/v1/ready"):
        wait_for_probe(
            urljoin(origin, path),
            attempts=args.attempts,
            delay=args.delay,
            timeout=args.timeout,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
