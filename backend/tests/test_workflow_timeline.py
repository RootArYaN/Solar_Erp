import json
from datetime import UTC, datetime
from types import SimpleNamespace

from app.services import workflow_service


def timeline_context():
    timestamp = datetime(2026, 7, 25, tzinfo=UTC)
    project = SimpleNamespace(created_at=timestamp)
    customer = SimpleNamespace(created_at=timestamp)
    quotation = SimpleNamespace(created_at=timestamp, decided_at=timestamp, updated_at=timestamp)
    return timestamp, project, customer, quotation


def payment_mode_steps() -> list[dict[str, object]]:
    completed_keys = {
        "customer_registration",
        "quotation_created",
        "quotation_approved",
        "project_created",
        "documents_uploaded",
        "documents_approved",
        "final_registration",
    }
    steps = []
    for key, name, locked in workflow_service._timeline_definition(""):
        step = workflow_service._step_template(key, name, locked)
        if key in completed_keys:
            step["status"] = "completed"
        elif key == "payment_mode":
            step["status"] = "current"
        steps.append(step)
    return steps


def test_confirming_cash_advances_to_cash_payment(monkeypatch) -> None:
    timestamp, project, customer, quotation = timeline_context()
    timeline = SimpleNamespace(
        payment_mode="",
        current_step="payment_mode",
        progress=0,
        steps_json=json.dumps(payment_mode_steps()),
        updated_at=timestamp,
        updated_by_membership_id=None,
    )
    actor = SimpleNamespace(
        user=SimpleNamespace(full_name="Local Administrator", is_super_admin=True),
        membership=SimpleNamespace(id="membership-1"),
        role="company_admin",
    )
    db = SimpleNamespace(commit=lambda: None)

    monkeypatch.setattr(
        workflow_service,
        "_get_project_context",
        lambda *_: (project, customer, quotation),
    )
    monkeypatch.setattr(
        workflow_service,
        "_ensure_timeline",
        lambda *_: (timeline, json.loads(timeline.steps_json)),
    )
    monkeypatch.setattr(
        workflow_service,
        "get_project_timeline",
        lambda *_: SimpleNamespace(current_step=timeline.current_step),
    )

    response = workflow_service.set_project_payment_mode(
        db,
        actor,
        "project-1",
        "cash",
    )

    saved_steps = json.loads(timeline.steps_json)
    payment_step = next(step for step in saved_steps if step["key"] == "payment_mode")
    cash_step = next(step for step in saved_steps if step["key"] == "cash_payment")
    assert payment_step["status"] == "completed"
    assert payment_step["completed_by"] == "Local Administrator"
    assert cash_step["status"] == "current"
    assert timeline.current_step == "cash_payment"
    assert response.current_step == "cash_payment"


def test_loading_a_stuck_confirmation_repairs_and_advances_it() -> None:
    timestamp, project, customer, quotation = timeline_context()
    timeline = SimpleNamespace(
        payment_mode="cash",
        current_step="payment_mode",
        progress=47,
        steps_json=json.dumps(payment_mode_steps()),
        updated_at=timestamp,
    )

    merged = workflow_service._merge_timeline_steps(
        timeline,
        project,
        customer,
        quotation,
    )

    payment_step = next(step for step in merged if step["key"] == "payment_mode")
    cash_step = next(step for step in merged if step["key"] == "cash_payment")
    assert payment_step["status"] == "completed"
    assert payment_step["note"] == "Payment mode confirmed as cash."
    assert cash_step["status"] == "current"
    assert timeline.current_step == "cash_payment"
