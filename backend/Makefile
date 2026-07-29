SHELL := /bin/bash
COMPOSE := docker compose -f docker-compose.performance.yml
TEST_DB := solar_erp_test
TEST_URL := postgresql+psycopg://solar_erp:solar_erp_test_password@127.0.0.1:5433/solar_erp_test

.PHONY: perf-up perf-down perf-reset perf-migrate perf-seed perf-api perf-test perf-load perf-report perf-all

perf-up:
	$(COMPOSE) up -d

perf-down:
	$(COMPOSE) down

perf-reset:
	DATABASE_URL=$(TEST_URL) python scripts/reset_test_database.py --confirm $(TEST_DB)

perf-migrate:
	ENVIRONMENT=test DATABASE_SSLMODE=disable DATABASE_URL=$(TEST_URL) python -m app.db.migrate upgrade

perf-seed:
	ENVIRONMENT=test DATABASE_SSLMODE=disable DATABASE_URL=$(TEST_URL) python scripts/seed_performance_data.py

perf-api:
	ENVIRONMENT=test DATABASE_SSLMODE=disable DATABASE_URL=$(TEST_URL) RATE_LIMIT_LOGIN_PER_MINUTE=500 LOGIN_LIMIT=500 uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --loop uvloop --http httptools

perf-test:
	ENVIRONMENT=test DATABASE_SSLMODE=disable DATABASE_URL=$(TEST_URL) SOLAR_TEST_DATABASE_URL=$(TEST_URL) python -m pytest -m "integration or workflow or performance"

perf-load:
	locust -f tests/performance/locustfile.py --headless --host http://127.0.0.1:8000 --users 10 --spawn-rate 2 --run-time 2m --csv reports/locust

perf-report:
	ENVIRONMENT=test DATABASE_SSLMODE=disable DATABASE_URL=$(TEST_URL) python scripts/inspect_database.py --output reports/database_diagnostics.json

perf-all:
	PHASE2_RESET=1 ./scripts/run_local_performance.sh all
