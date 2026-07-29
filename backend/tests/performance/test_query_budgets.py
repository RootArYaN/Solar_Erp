from __future__ import annotations

import pytest
from sqlalchemy import event

from app.db.session import engine


@pytest.mark.performance
def test_approval_center_has_bounded_query_count(admin_auth):
    statements: list[str] = []

    def before_cursor_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.split()).lower()
        if not normalized.startswith(("begin", "commit", "rollback")):
            statements.append(normalized)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        response = admin_auth.client.get(
            "/api/v1/workflow/approvals",
            headers=admin_auth.read_headers,
        )
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    assert response.status_code == 200, response.text
    assert len(statements) <= 12, "Approval center query budget exceeded:\n" + "\n".join(statements)
