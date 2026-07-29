#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
export PYTHONPATH="$ROOT_DIR${PYTHONPATH:+:$PYTHONPATH}"

MODE="${1:-all}"
COMPOSE=(docker compose -f docker-compose.performance.yml)
if [[ -n "${PYTHON_BIN:-}" ]]; then
  PYTHON="$PYTHON_BIN"
elif [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON="$ROOT_DIR/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
else
  echo "Missing Python interpreter. Create backend/.venv or install python3." >&2
  exit 1
fi
TEST_DB="solar_erp_test"
TEST_URL="postgresql+psycopg://solar_erp:solar_erp_test_password@127.0.0.1:5433/${TEST_DB}"
export ENVIRONMENT=test
export DATABASE_URL="${DATABASE_URL:-$TEST_URL}"
export SOLAR_TEST_DATABASE_URL="${SOLAR_TEST_DATABASE_URL:-$DATABASE_URL}"
export DATABASE_SSLMODE="${DATABASE_SSLMODE:-disable}"
export JWT_SECRET="${JWT_SECRET:-local-phase2-test-secret-change-me-1234567890}"
export RATE_LIMIT_LOGIN_PER_MINUTE="${RATE_LIMIT_LOGIN_PER_MINUTE:-500}"
export RATE_LIMIT_READ_PER_MINUTE="${RATE_LIMIT_READ_PER_MINUTE:-100000}"
export RATE_LIMIT_WRITE_PER_MINUTE="${RATE_LIMIT_WRITE_PER_MINUTE:-10000}"
export RATE_LIMIT_SEARCH_PER_MINUTE="${RATE_LIMIT_SEARCH_PER_MINUTE:-10000}"
export RATE_LIMIT_UPLOAD_PER_MINUTE="${RATE_LIMIT_UPLOAD_PER_MINUTE:-1000}"
export RATE_LIMIT_REFRESH_PER_MINUTE="${RATE_LIMIT_REFRESH_PER_MINUTE:-1000}"
export LOGIN_LIMIT="${LOGIN_LIMIT:-500}"
export STORAGE_PATH="${STORAGE_PATH:-./storage-test}"
mkdir -p reports

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

stop_process() {
  local pid="${1:-}"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill -TERM "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi
}

cleanup() {
  stop_process "${LOCUST_PID:-}"
  stop_process "${MONITOR_PID:-}"
  stop_process "${API_PID:-}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for_database() {
  for _ in $(seq 1 40); do
    if "${COMPOSE[@]}" exec -T postgres-performance pg_isready -U solar_erp -d "$TEST_DB" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL performance container did not become ready" >&2
  exit 1
}

wait_for_api() {
  "$PYTHON" - <<'PY'
import time
import urllib.request
for _ in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/api/v1/ready", timeout=1) as response:
            if response.status == 200:
                raise SystemExit(0)
    except Exception:
        time.sleep(0.5)
raise SystemExit("API did not become ready")
PY
}

start_database() {
  require_command docker
  "${COMPOSE[@]}" up -d
  wait_for_database
}

reset_and_seed() {
  if [[ "${PHASE2_RESET:-0}" != "1" ]]; then
    echo "Set PHASE2_RESET=1 to reset and reseed the isolated test database." >&2
    exit 1
  fi
  "$PYTHON" scripts/reset_test_database.py --confirm "$TEST_DB"
  "$PYTHON" -m app.db.migrate upgrade
  "$PYTHON" scripts/seed_performance_data.py
  "$PYTHON" scripts/inspect_database.py --output reports/database_before_load.json
}

start_api() {
  "$PYTHON" -m uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 1 \
    --loop uvloop \
    --http httptools \
    > reports/api.log 2>&1 &
  API_PID=$!
  export API_PID
  wait_for_api
}

run_tests() {
  "$PYTHON" -m pytest -m "integration or workflow or performance"
}

run_load() {
  "$PYTHON" scripts/monitor_process.py --pid "$API_PID" --duration "${MONITOR_DURATION_SECONDS:-75}" --output reports/api_resources.csv &
  MONITOR_PID=$!
  docker stats --no-stream solar-erp-postgres-performance > reports/postgres_container_stats_before.txt 2>&1 || true
  "$PYTHON" -m locust -f tests/performance/locustfile.py \
    --headless \
    --host http://127.0.0.1:8000 \
    --users "${LOAD_USERS:-10}" \
    --spawn-rate "${LOAD_SPAWN_RATE:-2}" \
    --run-time "${LOAD_RUN_TIME:-60s}" \
    --stop-timeout 10 \
    --csv reports/locust &
  LOCUST_PID=$!
  wait "$LOCUST_PID"
  unset LOCUST_PID
  wait "$MONITOR_PID" || true
  unset MONITOR_PID
  docker stats --no-stream solar-erp-postgres-performance > reports/postgres_container_stats_after.txt 2>&1 || true
}

collect_report() {
  "$PYTHON" scripts/inspect_database.py --output reports/database_after_load.json
  "$PYTHON" scripts/summarize_performance.py
}

case "$MODE" in
  setup)
    start_database
    reset_and_seed
    ;;
  test)
    start_database
    start_api
    run_tests
    ;;
  load)
    start_database
    start_api
    run_load
    collect_report
    ;;
  report)
    start_database
    collect_report
    ;;
  all)
    start_database
    reset_and_seed
    start_api
    run_tests
    run_load
    collect_report
    ;;
  down)
    "${COMPOSE[@]}" down
    ;;
  *)
    echo "Usage: $0 {setup|test|load|report|all|down}" >&2
    exit 2
    ;;
esac
