from __future__ import annotations

import pytest
from sqlalchemy import event

from app.db.session import engine


def _statement_count(client, path: str, headers: dict[str, str]) -> tuple[int, object]:
    statements: list[str] = []

    def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.split()).lower()
        if not normalized.startswith(("begin", "commit", "rollback")):
            statements.append(normalized)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        response = client.get(path, headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    return len(statements), response


@pytest.mark.performance
def test_dashboard_has_bounded_query_count(admin_auth):
    count, response = _statement_count(
        admin_auth.client,
        "/api/v1/dashboard/summary",
        admin_auth.read_headers,
    )
    assert response.status_code == 200, response.text
    assert count <= 10, f"Dashboard executed {count} statements"


@pytest.mark.performance
def test_customer_list_respects_page_size(admin_auth):
    count, response = _statement_count(
        admin_auth.client,
        "/api/v1/customer-flow/customers?page=1&page_size=7",
        admin_auth.read_headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["items"]) <= 7
    assert count <= 8, f"Customer list executed {count} statements"


@pytest.mark.performance
def test_large_read_endpoints_respect_limits(admin_auth):
    approvals = admin_auth.client.get(
        "/api/v1/workflow/approvals?quotation_limit=3&transaction_limit=4",
        headers=admin_auth.read_headers,
    )
    assert approvals.status_code == 200, approvals.text
    approval_body = approvals.json()
    assert len(approval_body["quotation_requests"]) <= 3
    assert len(approval_body["transactions"]) <= 4

    timelines = admin_auth.client.get(
        "/api/v1/workflow/projects/timelines?page=1&page_size=5",
        headers=admin_auth.read_headers,
    )
    assert timelines.status_code == 200, timelines.text
    assert len(timelines.json()) <= 5

    inventory = admin_auth.client.get(
        "/api/v1/inventory/summary?item_page=1&item_page_size=7&movement_limit=4",
        headers=admin_auth.read_headers,
    )
    assert inventory.status_code == 200, inventory.text
    inventory_body = inventory.json()
    assert len(inventory_body["items"]) <= 7
    assert len(inventory_body["movements"]) <= 4
    assert inventory_body["total_items"] >= len(inventory_body["items"])
