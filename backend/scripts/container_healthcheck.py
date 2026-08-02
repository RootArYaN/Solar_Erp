from __future__ import annotations

import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen


port = os.environ.get("PORT", "8000")
url = os.environ.get(
    "CONTAINER_HEALTHCHECK_URL",
    f"http://127.0.0.1:{port}/api/v1/ready",
)
request = Request(url, headers={"User-Agent": "solar-erp-container-healthcheck/1"})

try:
    with urlopen(request, timeout=3) as response:
        payload = json.load(response)
        if response.status != 200 or payload != {"status": "ready"}:
            raise SystemExit(1)
except (OSError, URLError, ValueError):
    raise SystemExit(1)
