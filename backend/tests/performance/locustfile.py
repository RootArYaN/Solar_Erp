from __future__ import annotations

import os
import random
from datetime import datetime, timezone
from uuid import uuid4

from locust import HttpUser, between, task


class SolarErpUser(HttpUser):
    wait_time = between(0.4, 1.5)

    def on_start(self) -> None:
        username = os.getenv("SOLAR_LOAD_USERNAME", "admin")
        password = os.getenv("SOLAR_LOAD_PASSWORD", "ChangeMe123!")
        with self.client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password, "remember": False},
            name="POST /auth/login",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"Login failed: {response.status_code} {response.text[:200]}")
                self.access_token = ""
                self.csrf_token = ""
                self.agent_membership_id = ""
                return
            body = response.json()
            self.access_token = body["access_token"]
            self.csrf_token = response.headers.get("X-CSRF-Token", "")

        self.agent_membership_id = ""
        agents = self.client.get("/api/v1/agents", headers=self.read_headers, name="GET /agents bootstrap")
        if agents.status_code == 200 and agents.json():
            self.agent_membership_id = agents.json()[0]["membership_id"]

    @property
    def read_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def write_headers(self) -> dict[str, str]:
        return {
            **self.read_headers,
            "X-CSRF-Token": self.csrf_token,
            "Idempotency-Key": f"locust-{uuid4().hex}",
        }

    @task(8)
    def dashboard_summary(self) -> None:
        self.client.get("/api/v1/dashboard/summary", headers=self.read_headers, name="GET /dashboard/summary")

    @task(6)
    def customer_flow(self) -> None:
        self.client.get(
            "/api/v1/customer-flow/customers?page=1&page_size=25",
            headers=self.read_headers,
            name="GET /customer-flow/customers",
        )

    @task(5)
    def finance_transactions(self) -> None:
        self.client.get(
            "/api/v1/finance/transactions?page=1&page_size=25",
            headers=self.read_headers,
            name="GET /finance/transactions",
        )

    @task(4)
    def project_timelines(self) -> None:
        self.client.get(
            "/api/v1/workflow/projects/timelines?page=1&page_size=50",
            headers=self.read_headers,
            name="GET /workflow/projects/timelines",
        )

    @task(3)
    def approval_center(self) -> None:
        self.client.get(
            "/api/v1/workflow/approvals?quotation_limit=25&transaction_limit=25",
            headers=self.read_headers,
            name="GET /workflow/approvals",
        )

    @task(3)
    def inventory_summary(self) -> None:
        self.client.get(
            "/api/v1/inventory/summary?item_page=1&item_page_size=50&movement_limit=20",
            headers=self.read_headers,
            name="GET /inventory/summary",
        )

    @task(2)
    def files_list(self) -> None:
        page = random.randint(1, 3)
        self.client.get(
            f"/api/v1/files?page={page}&page_size=25",
            headers=self.read_headers,
            name="GET /files",
        )

    @task(1)
    def submit_agent_transaction(self) -> None:
        if not self.agent_membership_id:
            return
        reference = uuid4().hex[:12]
        self.client.post(
            f"/api/v1/agents/{self.agent_membership_id}/transactions",
            headers=self.write_headers(),
            json={
                "transaction_date": datetime.now(timezone.utc).isoformat(),
                "reference": f"LOAD-{reference}",
                "transaction_type": "site_expense",
                "description": "Phase 2 load-test transaction",
                "debit": random.randint(100, 2500),
                "credit": 0,
            },
            name="POST /agents/:id/transactions",
        )
