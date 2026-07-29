from __future__ import annotations

import csv
import json
from pathlib import Path

REPORTS = Path("reports")


def _number(row: dict[str, str], key: str) -> float:
    return float(row.get(key) or 0)


def _locust_summary() -> dict:
    path = REPORTS / "locust_stats.csv"
    if not path.exists():
        return {"available": False}
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    aggregate = next((row for row in rows if row.get("Name") == "Aggregated"), None)
    if not aggregate:
        return {"available": False}
    requests = int(_number(aggregate, "Request Count"))
    failures = int(_number(aggregate, "Failure Count"))
    failure_rate = (failures / requests * 100) if requests else 0.0
    endpoints: dict[str, dict[str, float | int]] = {}
    for row in rows:
        name = row.get("Name") or ""
        if not name or name == "Aggregated":
            continue
        endpoints[name] = {
            "requests": int(_number(row, "Request Count")),
            "failures": int(_number(row, "Failure Count")),
            "average_ms": round(_number(row, "Average Response Time"), 2),
            "p95_ms": _number(row, "95%"),
            "p99_ms": _number(row, "99%"),
            "average_response_bytes": round(_number(row, "Average Content Size"), 2),
        }
    return {
        "available": True,
        "requests": requests,
        "failures": failures,
        "failure_rate_percent": round(failure_rate, 3),
        "requests_per_second": _number(aggregate, "Requests/s"),
        "p50_ms": _number(aggregate, "50%"),
        "p95_ms": _number(aggregate, "95%"),
        "p99_ms": _number(aggregate, "99%"),
        "endpoints": endpoints,
    }


def _resource_summary() -> dict:
    path = REPORTS / "api_resources.csv"
    if not path.exists():
        return {"available": False}
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    if not rows:
        return {"available": False}
    cpu = [float(row["cpu_percent"]) for row in rows]
    rss = [int(row["rss_bytes"]) for row in rows]
    threads = [int(row["threads"]) for row in rows]
    connections = [int(row["connections"]) for row in rows if int(row["connections"]) >= 0]
    return {
        "available": True,
        "samples": len(rows),
        "average_cpu_percent": round(sum(cpu) / len(cpu), 2),
        "peak_cpu_percent": round(max(cpu), 2),
        "average_rss_mb": round((sum(rss) / len(rss)) / (1024 * 1024), 2),
        "peak_rss_mb": round(max(rss) / (1024 * 1024), 2),
        "peak_threads": max(threads),
        "peak_connections": max(connections) if connections else None,
    }


def _database_summary() -> dict:
    path = REPORTS / "database_after_load.json"
    if not path.exists():
        return {"available": False}
    report = json.loads(path.read_text(encoding="utf-8"))
    connection_count = sum(int(row.get("count") or 0) for row in report.get("connections", []))
    return {
        "available": True,
        "database_size_bytes": report.get("database_size_bytes"),
        "connections": connection_count,
        "long_transactions": len(report.get("long_transactions", [])),
        "blocked_queries": len(report.get("blocked_queries", [])),
        "top_statement_count": len(report.get("top_statements", [])),
    }


def main() -> None:
    locust = _locust_summary()
    resources = _resource_summary()
    database = _database_summary()
    endpoint_rows = list(locust.get("endpoints", {}).values())
    max_endpoint_p95 = max((float(row["p95_ms"]) for row in endpoint_rows), default=0)
    max_average_response = max((float(row["average_response_bytes"]) for row in endpoint_rows), default=0)
    checks = {
        "failure_rate_below_1_percent": not locust.get("available") or locust["failure_rate_percent"] < 1,
        "aggregate_p95_below_750_ms": not locust.get("available") or locust["p95_ms"] < 750,
        "aggregate_p99_below_1500_ms": not locust.get("available") or locust["p99_ms"] < 1500,
        "each_endpoint_p95_below_1000_ms": not locust.get("available") or max_endpoint_p95 < 1000,
        "average_response_below_150kb": not locust.get("available") or max_average_response < 150 * 1024,
        "api_peak_rss_below_256mb": not resources.get("available") or resources["peak_rss_mb"] < 256,
        "no_blocked_queries": not database.get("available") or database["blocked_queries"] == 0,
        "no_long_transactions": not database.get("available") or database["long_transactions"] == 0,
    }
    summary = {
        "locust": locust,
        "api_resources": resources,
        "database": database,
        "observed_max_endpoint_p95_ms": max_endpoint_p95,
        "observed_max_average_response_bytes": max_average_response,
        "checks": checks,
        "passed": all(checks.values()),
    }
    output = REPORTS / "performance_summary.json"
    output.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"Summary written to {output}")


if __name__ == "__main__":
    main()
