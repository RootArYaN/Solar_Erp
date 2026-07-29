from __future__ import annotations

import argparse
import csv
import time
from pathlib import Path

import psutil


def main() -> None:
    parser = argparse.ArgumentParser(description="Sample API CPU, RAM and thread usage")
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--duration", type=int, default=75)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--output", type=Path, default=Path("reports/api_resources.csv"))
    args = parser.parse_args()

    process = psutil.Process(args.pid)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + args.duration
    process.cpu_percent(interval=None)

    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "timestamp",
                "cpu_percent",
                "rss_bytes",
                "vms_bytes",
                "threads",
                "open_files",
                "connections",
            ],
        )
        writer.writeheader()
        while time.monotonic() < deadline:
            if not process.is_running():
                break
            memory = process.memory_info()
            try:
                connections = len(process.net_connections(kind="inet"))
            except (psutil.AccessDenied, psutil.ZombieProcess):
                connections = -1
            try:
                open_files = len(process.open_files())
            except (psutil.AccessDenied, psutil.ZombieProcess):
                open_files = -1
            writer.writerow(
                {
                    "timestamp": time.time(),
                    "cpu_percent": process.cpu_percent(interval=args.interval),
                    "rss_bytes": memory.rss,
                    "vms_bytes": memory.vms,
                    "threads": process.num_threads(),
                    "open_files": open_files,
                    "connections": connections,
                }
            )
            handle.flush()


if __name__ == "__main__":
    main()
