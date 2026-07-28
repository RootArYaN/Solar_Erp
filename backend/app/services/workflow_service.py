from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentProfile, AgentTransaction
from app.models.auth import Membership
from app.models.workflow import CustomerProject, CustomerQuotation, QuotationRequest, TransactionApproval
from app.services.audit_service import write_event
from app.schemas.workflow import (
    ApprovalCenterResponse,
    ApprovalDecisionRequest,
    CreateQuotationRequest,
    GenerateQuotationRequest,
    QuotationLineSummary,
    QuotationRequestSummary,
    QuotationSummary,
    TransactionApprovalSummary,
)


class WorkflowServiceError(Exception):
    status_code = 400


class WorkflowNotFoundError(WorkflowServiceError):
    status_code = 404


class WorkflowForbiddenError(WorkflowServiceError):
    status_code = 403


class WorkflowConflictError(WorkflowServiceError):
    status_code = 409


def _money(value: Decimal | float | int | None) -> float:
    return round(float(value or 0), 2)


def _quotation_lines(raw_value: str) -> list[QuotationLineSummary]:
    try:
        raw_lines = json.loads(raw_value or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(raw_lines, list):
        return []

    lines: list[QuotationLineSummary] = []
    for raw_line in raw_lines:
        if not isinstance(raw_line, dict):
            continue
        lines.append(QuotationLineSummary(
            description=str(raw_line.get("description") or "Item"),
            quantity=_money(raw_line.get("quantity")),
            unit=str(raw_line.get("unit") or "Unit"),
            unit_price=_money(raw_line.get("unit_price")),
            tax_rate=_money(raw_line.get("tax_rate")),
            line_total=_money(raw_line.get("line_total")),
        ))
    return lines


def _is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


def _load_customer(db: Session, actor: CurrentSession, customer_id: str) -> AgentCustomer:
    customer = db.scalar(select(AgentCustomer).where(
        AgentCustomer.id == customer_id,
        AgentCustomer.company_id == actor.membership.company_id,
    ))
    if not customer:
        raise WorkflowNotFoundError("Customer not found")
    return customer


def _assert_customer_access(db: Session, actor: CurrentSession, customer: AgentCustomer) -> None:
    if _is_admin(actor) or "agents.view_all" in actor.permissions or "agents.manage" in actor.permissions:
        return
    profile = db.scalar(select(AgentProfile).where(
        AgentProfile.id == customer.agent_profile_id,
        AgentProfile.membership_id == actor.membership.id,
    ))
    if not profile:
        raise WorkflowForbiddenError("You can only access customers assigned to you")


def create_quotation_request(
    db: Session,
    actor: CurrentSession,
    customer_id: str,
    payload: CreateQuotationRequest,
) -> QuotationRequestSummary:
    customer = _load_customer(db, actor, customer_id)
    _assert_customer_access(db, actor, customer)

    open_request = db.scalar(select(QuotationRequest).where(
        QuotationRequest.customer_id == customer.id,
        QuotationRequest.status.in_(["pending", "quotation_ready"]),
    ))
    if open_request:
        raise WorkflowConflictError("This customer already has an open quotation request")

    request = QuotationRequest(
        company_id=actor.membership.company_id,
        customer_id=customer.id,
        requested_by_membership_id=actor.membership.id,
        requirement_summary=payload.requirement_summary,
        proposed_capacity_kw=Decimal(str(payload.proposed_capacity_kw)),
        site_address=payload.site_address or customer.address,
        notes=payload.notes,
        status="pending",
    )
    customer.status = "quotation_requested"
    db.add(request)
    db.flush()
    write_event(
        db, company_id=request.company_id, event="quotation.requested", entity="quotation_request",
        entity_id=request.id, actor=actor, customer_id=customer.id,
        changes={"capacity_kw": str(request.proposed_capacity_kw), "summary": request.requirement_summary},
    )
    db.commit()
    return _quotation_request_summary(db, request)


def generate_quotation(
    db: Session,
    actor: CurrentSession,
    request_id: str,
    payload: GenerateQuotationRequest,
) -> QuotationRequestSummary:
    if not _is_admin(actor) and "quotations.approve" not in actor.permissions:
        raise WorkflowForbiddenError("Only an administrator can generate customer quotations")

    request = db.scalar(select(QuotationRequest).where(
        QuotationRequest.id == request_id,
        QuotationRequest.company_id == actor.membership.company_id,
    ))
    if not request:
        raise WorkflowNotFoundError("Quotation request not found")
    if request.status not in {"pending", "quotation_ready", "condition", "rejected"}:
        raise WorkflowConflictError("This quotation request cannot be edited")

    items: list[dict[str, object]] = []
    subtotal = Decimal("0.00")
    tax_total = Decimal("0.00")
    for line in payload.lines:
        quantity = Decimal(str(line.quantity))
        unit_price = Decimal(str(line.unit_price))
        tax_rate = Decimal(str(line.tax_rate))
        base = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        tax = (base * tax_rate / Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        subtotal += base
        tax_total += tax
        items.append({
            "description": line.description,
            "quantity": float(quantity),
            "unit": line.unit,
            "unit_price": float(unit_price),
            "tax_rate": float(tax_rate),
            "line_total": float(base + tax),
        })

    quotation = db.scalar(select(CustomerQuotation).where(CustomerQuotation.request_id == request.id))
    if not quotation:
        quote_id = __import__("uuid").uuid4().hex
        quotation = CustomerQuotation(
            id=f"{quote_id[0:8]}-{quote_id[8:12]}-{quote_id[12:16]}-{quote_id[16:20]}-{quote_id[20:32]}",
            company_id=request.company_id,
            request_id=request.id,
            customer_id=request.customer_id,
            quotation_number=f"QUO-{datetime.now(UTC).year}-{quote_id[:8].upper()}",
            created_by_membership_id=actor.membership.id,
            title=payload.title,
        )
        db.add(quotation)

    quotation.title = payload.title
    quotation.line_items_json = json.dumps(items, separators=(",", ":"))
    quotation.subtotal = subtotal
    quotation.tax_total = tax_total
    quotation.grand_total = subtotal + tax_total
    quotation.valid_until = payload.valid_until
    quotation.status = "pending_approval"
    quotation.decided_by_membership_id = None
    quotation.decided_at = None
    quotation.decision_comment = ""
    request.status = "quotation_ready"
    request.reviewed_by_membership_id = actor.membership.id
    request.reviewed_at = datetime.now(UTC)
    request.review_comment = "Quotation prepared and awaiting final approval."
    db.flush()
    write_event(
        db, company_id=quotation.company_id, event="quotation.created", entity="quotation",
        entity_id=quotation.id, actor=actor, customer_id=quotation.customer_id,
        changes={"quotation_number": quotation.quotation_number, "grand_total": str(quotation.grand_total)},
    )
    db.commit()
    return _quotation_request_summary(db, request)


def decide_quotation(
    db: Session,
    actor: CurrentSession,
    quotation_id: str,
    payload: ApprovalDecisionRequest,
) -> QuotationRequestSummary:
    if not _is_admin(actor) and "quotations.approve" not in actor.permissions:
        raise WorkflowForbiddenError("You cannot approve quotations")

    quotation = db.scalar(select(CustomerQuotation).where(
        CustomerQuotation.id == quotation_id,
        CustomerQuotation.company_id == actor.membership.company_id,
    ))
    if not quotation:
        raise WorkflowNotFoundError("Quotation not found")
    if quotation.status != "pending_approval":
        raise WorkflowConflictError("Only pending quotations can be approved or rejected")

    request = db.get(QuotationRequest, quotation.request_id)
    customer = db.get(AgentCustomer, quotation.customer_id)
    if not request or not customer:
        raise WorkflowNotFoundError("Quotation workflow is incomplete")

    quotation.status = payload.decision
    quotation.decided_by_membership_id = actor.membership.id
    quotation.decided_at = datetime.now(UTC)
    quotation.decision_comment = payload.comment
    request.status = payload.decision
    request.reviewed_by_membership_id = actor.membership.id
    request.reviewed_at = quotation.decided_at
    request.review_comment = payload.comment

    project_created = False
    if payload.decision == "approved":
        project = db.scalar(select(CustomerProject).where(CustomerProject.quotation_id == quotation.id))
        if not project:
            project_created = True
            project_id = __import__("uuid").uuid4().hex
            project = CustomerProject(
                id=f"{project_id[0:8]}-{project_id[8:12]}-{project_id[12:16]}-{project_id[16:20]}-{project_id[20:32]}",
                company_id=quotation.company_id,
                customer_id=customer.id,
                quotation_id=quotation.id,
                project_number=f"PRJ-{datetime.now(UTC).year}-{project_id[:8].upper()}",
                name=quotation.title,
                status="planning",
                capacity_kw=request.proposed_capacity_kw,
                approved_value=quotation.grand_total,
                site_address=request.site_address or customer.site_address or customer.address,
                payment_mode="",
                loan_status="not_required",
                documentation_status="pending",
                registration_status="pending",
                material_status="pending",
                installation_status="pending",
                dcr_status="pending",
                subsidy_status="pending",
                subsidiary_payment_status="pending",
            )
            db.add(project)
        db.flush()
        _ensure_timeline(db, project, customer, quotation)
        customer.status = "active"
        customer.project_name = quotation.title
        customer.outstanding_balance = quotation.grand_total
    elif payload.decision == "condition":
        customer.status = "quotation_condition"
    else:
        customer.status = "quotation_rejected"

    db.flush()
    write_event(
        db, company_id=quotation.company_id,
        event=f"quotation.{payload.decision}", entity="quotation", entity_id=quotation.id,
        actor=actor, project_id=project.id if payload.decision == "approved" and project else None,
        customer_id=customer.id, changes={"comment": payload.comment},
    )
    if payload.decision == "approved" and project_created and project:
        write_event(
            db, company_id=project.company_id, event="project.created", entity="project",
            entity_id=project.id, actor=actor, project_id=project.id, customer_id=customer.id,
            changes={"project_number": project.project_number, "approved_value": str(project.approved_value)},
        )
    db.commit()
    return _quotation_request_summary(db, request)


def decide_transaction(
    db: Session,
    actor: CurrentSession,
    approval_id: str,
    payload: ApprovalDecisionRequest,
) -> TransactionApprovalSummary:
    if payload.decision not in {"approved", "rejected"}:
        raise WorkflowConflictError("Transactions can only be approved or rejected")
    if not _is_admin(actor) and not {"agents.transactions.approve", "finance.manage"}.intersection(actor.permissions):
        raise WorkflowForbiddenError("You cannot approve agent transactions")

    approval = db.scalar(select(TransactionApproval).where(
        TransactionApproval.id == approval_id,
        TransactionApproval.company_id == actor.membership.company_id,
    ))
    if not approval:
        raise WorkflowNotFoundError("Transaction approval not found")
    if approval.status != "pending":
        raise WorkflowConflictError("Only pending transactions can be approved or rejected")

    approval.status = payload.decision
    approval.decided_by_membership_id = actor.membership.id
    approval.decided_at = datetime.now(UTC)
    approval.decision_comment = payload.comment
    transaction = db.get(AgentTransaction, approval.transaction_id)
    write_event(
        db, company_id=approval.company_id, event=f"transaction.{payload.decision}",
        entity="agent_transaction", entity_id=approval.transaction_id, actor=actor,
        project_id=transaction.project_id if transaction else None,
        changes={"comment": payload.comment},
    )
    db.commit()
    return _transaction_summary(db, approval)


def get_approval_center(db: Session, actor: CurrentSession) -> ApprovalCenterResponse:
    if not _is_admin(actor) and not {
        "quotations.approve",
        "agents.transactions.approve",
        "finance.manage",
    }.intersection(actor.permissions):
        raise WorkflowForbiddenError("You cannot view the approval center")

    quotation_requests = list(db.scalars(
        select(QuotationRequest)
        .where(QuotationRequest.company_id == actor.membership.company_id)
        .order_by(QuotationRequest.created_at.desc())
        .limit(100)
    ).all())
    transaction_approvals = list(db.scalars(
        select(TransactionApproval)
        .where(
            TransactionApproval.company_id == actor.membership.company_id,
            TransactionApproval.status == "pending",
        )
        .order_by(TransactionApproval.created_at.asc())
        .limit(100)
    ).all())

    return ApprovalCenterResponse(
        quotation_requests=[_quotation_request_summary(db, item) for item in quotation_requests],
        transactions=[_transaction_summary(db, item) for item in transaction_approvals],
    )


def _quotation_request_summary(db: Session, request: QuotationRequest) -> QuotationRequestSummary:
    customer = db.get(AgentCustomer, request.customer_id)
    profile = db.get(AgentProfile, customer.agent_profile_id) if customer else None
    membership = db.scalar(select(Membership).where(Membership.id == (profile.membership_id if profile else "")).options(selectinload(Membership.user))) if profile else None
    quotation = db.scalar(select(CustomerQuotation).where(CustomerQuotation.request_id == request.id))
    project = db.scalar(select(CustomerProject).where(CustomerProject.quotation_id == quotation.id)) if quotation else None
    quotation_summary = None
    if quotation:
        quotation_summary = QuotationSummary(
            id=quotation.id,
            quotation_number=quotation.quotation_number,
            title=quotation.title,
            subtotal=_money(quotation.subtotal),
            tax_total=_money(quotation.tax_total),
            grand_total=_money(quotation.grand_total),
            valid_until=quotation.valid_until,
            status=quotation.status,
            decision_comment=quotation.decision_comment,
            created_at=quotation.created_at,
            approved_at=quotation.decided_at if quotation.status == "approved" else None,
            lines=_quotation_lines(quotation.line_items_json),
        )
    return QuotationRequestSummary(
        id=request.id,
        customer_id=request.customer_id,
        customer_name=customer.customer_name if customer else "Unknown customer",
        company_name=customer.company_name if customer else "",
        customer_phone=customer.phone if customer else "",
        customer_email=customer.email if customer else "",
        customer_address=customer.address if customer else "",
        agent_membership_id=profile.membership_id if profile else "",
        agent_name=membership.user.full_name if membership else "Unknown agent",
        requirement_summary=request.requirement_summary,
        proposed_capacity_kw=_money(request.proposed_capacity_kw),
        site_address=request.site_address,
        notes=request.notes,
        status=request.status,
        review_comment=request.review_comment,
        created_at=request.created_at,
        quotation=quotation_summary,
        project_number=project.project_number if project else None,
        project_status=project.status if project else None,
    )


def _transaction_summary(db: Session, approval: TransactionApproval) -> TransactionApprovalSummary:
    transaction = db.get(AgentTransaction, approval.transaction_id)
    profile = db.get(AgentProfile, transaction.agent_profile_id) if transaction else None
    membership = db.scalar(select(Membership).where(Membership.id == (profile.membership_id if profile else "")).options(selectinload(Membership.user))) if profile else None
    if not transaction:
        raise WorkflowNotFoundError("Transaction not found")
    return TransactionApprovalSummary(
        approval_id=approval.id,
        transaction_id=transaction.id,
        agent_membership_id=profile.membership_id if profile else "",
        agent_name=membership.user.full_name if membership else "Unknown agent",
        transaction_date=transaction.transaction_date,
        reference=transaction.reference,
        transaction_type=transaction.transaction_type,
        description=transaction.description,
        debit=_money(transaction.debit),
        credit=_money(transaction.credit),
        status=approval.status,
        decision_comment=approval.decision_comment,
        created_at=approval.created_at,
    )


# Project timeline -----------------------------------------------------------

_TIMELINE_BASE_STEPS = [
    ("customer_registration", "Customer registered", True),
    ("quotation_created", "Quotation created", True),
    ("quotation_approved", "Quotation approved", True),
    ("project_created", "Project created", True),
    ("documents_uploaded", "Documents uploaded", False),
    ("documents_approved", "Documents approved", False),
    ("final_registration", "Final registration", False),
    ("payment_mode", "Payment mode selected", False),
]
_TIMELINE_CASH_STEPS = [("cash_payment", "Cash payment received", False)]
_TIMELINE_LOAN_STEPS = [
    ("loan_application", "Loan application submitted", False),
    ("bank_approval", "Bank approval completed", False),
]
_TIMELINE_FINAL_STEPS = [
    ("material_arrival", "Material arrived at site", False),
    ("installation", "Installation completed", False),
    ("dcr_upload", "DCR uploaded", False),
    ("second_payment", "Second payment received", False),
    ("subsidy", "Subsidy completed", False),
    ("project_completed", "Project completed", False),
]


def _timeline_can_manage(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin or bool({"projects.edit", "projects.manage"}.intersection(actor.permissions))


def _timeline_definition(payment_mode: str) -> list[tuple[str, str, bool]]:
    branch = _TIMELINE_CASH_STEPS if payment_mode == "cash" else _TIMELINE_LOAN_STEPS if payment_mode == "loan" else []
    final_steps = list(_TIMELINE_FINAL_STEPS)
    if payment_mode == "loan":
        final_steps = [
            (key, "Second EMI received" if key == "second_payment" else name, locked)
            for key, name, locked in final_steps
        ]
    return [*_TIMELINE_BASE_STEPS, *branch, *final_steps]


def _step_template(key: str, name: str, locked: bool) -> dict[str, object]:
    return {
        "key": key,
        "name": name,
        "status": "pending",
        "completed_at": None,
        "completed_by": "",
        "note": "",
        "event_date": None,
        "locked": locked,
    }


def _load_steps(timeline) -> list[dict[str, object]]:
    try:
        value = json.loads(timeline.steps_json or "[]")
        return value if isinstance(value, list) else []
    except (TypeError, ValueError, json.JSONDecodeError):
        return []


def _merge_timeline_steps(timeline, project: CustomerProject, customer: AgentCustomer, quotation: CustomerQuotation) -> list[dict[str, object]]:
    existing = {str(step.get("key")): step for step in _load_steps(timeline) if isinstance(step, dict) and step.get("key")}
    merged: list[dict[str, object]] = []
    for key, name, locked in _timeline_definition(timeline.payment_mode):
        step = {**_step_template(key, name, locked), **existing.get(key, {})}
        step["name"] = name
        step["locked"] = locked
        merged.append(step)

    historical = {
        "customer_registration": customer.created_at,
        "quotation_created": quotation.created_at,
        "quotation_approved": quotation.decided_at or quotation.updated_at,
        "project_created": project.created_at,
    }
    for step in merged:
        if step["key"] in historical:
            step.update({
                "status": "completed",
                "completed_at": historical[step["key"]].isoformat() if historical[step["key"]] else None,
                "completed_by": step.get("completed_by") or "System",
                "locked": True,
            })

    # Older confirmations stored the selected mode but lost the in-memory step
    # update before serializing the timeline. Repair those records as they load.
    payment_step = next((step for step in merged if step["key"] == "payment_mode"), None)
    if (
        timeline.payment_mode
        and payment_step
        and payment_step["status"] == "current"
        and not payment_step.get("completed_at")
        and not payment_step.get("note")
    ):
        payment_step.update({
            "status": "completed",
            "completed_at": timeline.updated_at.isoformat(),
            "completed_by": payment_step.get("completed_by") or "Administrator",
            "note": f"Payment mode confirmed as {timeline.payment_mode}.",
        })

    first_open = next((step for step in merged if step["status"] != "completed"), None)
    for step in merged:
        if step["status"] == "current" and step is not first_open:
            step["status"] = "pending"
    if first_open:
        first_open["status"] = "current"
        timeline.current_step = str(first_open["key"])
    else:
        timeline.current_step = "project_completed"

    completed = sum(1 for step in merged if step["status"] == "completed")
    timeline.progress = round((completed / len(merged)) * 100) if merged else 0
    timeline.steps_json = json.dumps(merged, separators=(",", ":"))
    return merged


def _get_project_context(db: Session, actor: CurrentSession, project_id: str):
    project = db.scalar(select(CustomerProject).where(
        CustomerProject.id == project_id,
        CustomerProject.company_id == actor.membership.company_id,
    ))
    if not project:
        raise WorkflowNotFoundError("Project not found")
    customer = db.get(AgentCustomer, project.customer_id)
    quotation = db.get(CustomerQuotation, project.quotation_id)
    if not customer or not quotation:
        raise WorkflowNotFoundError("Project workflow is incomplete")

    if actor.role == "customer" and customer.customer_membership_id != actor.membership.id:
        raise WorkflowForbiddenError("You can only view your own project")
    if actor.role == "agent":
        profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == actor.membership.id))
        if not profile or customer.agent_profile_id != profile.id:
            raise WorkflowForbiddenError("You can only view assigned projects")
    return project, customer, quotation


def _ensure_timeline(db: Session, project: CustomerProject, customer: AgentCustomer, quotation: CustomerQuotation):
    from app.models.workflow import ProjectTimeline

    timeline = db.scalar(select(ProjectTimeline).where(ProjectTimeline.project_id == project.id))
    if not timeline:
        timeline = ProjectTimeline(
            company_id=project.company_id,
            project_id=project.id,
            payment_mode="",
            current_step="documents_uploaded",
            progress=0,
        )
        db.add(timeline)
        db.flush()
    steps = _merge_timeline_steps(timeline, project, customer, quotation)
    return timeline, steps


def _timeline_list_item(project: CustomerProject, customer: AgentCustomer, timeline, steps: list[dict[str, object]]):
    from app.schemas.workflow import ProjectTimelineListItem

    current = next((step for step in steps if step["status"] == "current"), steps[-1] if steps else {"key": "", "name": ""})
    return ProjectTimelineListItem(
        project_id=project.id,
        customer_id=customer.id,
        project_number=project.project_number,
        project_name=project.name,
        customer_name=customer.customer_name,
        customer_phone=customer.phone,
        project_status=project.status,
        payment_mode=timeline.payment_mode,
        current_step=str(current.get("key", "")),
        current_step_name=str(current.get("name", "")),
        progress=timeline.progress,
        updated_at=timeline.updated_at,
    )


def list_project_timelines(db: Session, actor: CurrentSession):
    from app.models.workflow import ProjectTimeline
    from app.schemas.workflow import ProjectTimelineListItem

    statement = (
        select(CustomerProject, AgentCustomer, CustomerQuotation)
        .join(AgentCustomer, AgentCustomer.id == CustomerProject.customer_id)
        .join(CustomerQuotation, CustomerQuotation.id == CustomerProject.quotation_id)
        .where(CustomerProject.company_id == actor.membership.company_id)
        .order_by(CustomerProject.updated_at.desc())
        .limit(200)
    )
    if actor.role == "customer":
        statement = statement.where(AgentCustomer.customer_membership_id == actor.membership.id)
    elif actor.role == "agent":
        profile = db.scalar(select(AgentProfile).where(AgentProfile.membership_id == actor.membership.id))
        if not profile:
            return []
        statement = statement.where(AgentCustomer.agent_profile_id == profile.id)

    rows = list(db.execute(statement).all())
    project_ids = [project.id for project, _, _ in rows]
    timelines = list(db.scalars(select(ProjectTimeline).where(ProjectTimeline.project_id.in_(project_ids))).all()) if project_ids else []
    timelines_by_project = {timeline.project_id: timeline for timeline in timelines}

    result: list[ProjectTimelineListItem] = []
    for project, customer, quotation in rows:
        timeline = timelines_by_project.get(project.id)
        if not timeline:
            timeline = ProjectTimeline(
                company_id=project.company_id,
                project_id=project.id,
                payment_mode="",
                current_step="documents_uploaded",
                progress=0,
            )
            db.add(timeline)
            db.flush()
            timelines_by_project[project.id] = timeline
        steps = _merge_timeline_steps(timeline, project, customer, quotation)
        result.append(_timeline_list_item(project, customer, timeline, steps))

    if rows:
        db.commit()
    return result


def get_project_timeline(db: Session, actor: CurrentSession, project_id: str):
    from app.schemas.workflow import ProjectTimelineResponse, ProjectTimelineStep

    project, customer, quotation = _get_project_context(db, actor, project_id)
    timeline, steps = _ensure_timeline(db, project, customer, quotation)
    db.commit()
    item = _timeline_list_item(project, customer, timeline, steps)
    return ProjectTimelineResponse(
        **item.model_dump(),
        capacity_kw=_money(project.capacity_kw),
        approved_value=_money(project.approved_value),
        can_manage=_timeline_can_manage(actor),
        steps=[ProjectTimelineStep(**step) for step in steps],
    )


def sync_documentation_progress(
    db: Session,
    actor: CurrentSession,
    project_id: str,
    documentation_status: str,
) -> bool:
    """Advance system-owned document milestones after pack generation/finalization."""
    if documentation_status not in {"in_progress", "approved"}:
        raise WorkflowConflictError("Unsupported documentation status")

    project, customer, quotation = _get_project_context(db, actor, project_id)
    status_rank = {"pending": 0, "in_progress": 1, "approved": 2}
    if status_rank.get(project.documentation_status, 0) > status_rank[documentation_status]:
        return False
    timeline, steps = _ensure_timeline(db, project, customer, quotation)
    target_keys = {"documents_uploaded"}
    if documentation_status == "approved":
        target_keys.add("documents_approved")

    changed = project.documentation_status != documentation_status
    completed_at = datetime.now(UTC).isoformat()
    for step in steps:
        if step["key"] not in target_keys or step["status"] == "completed":
            continue
        step.update({
            "status": "completed",
            "completed_at": completed_at,
            "completed_by": actor.user.full_name,
            "note": (
                "Mandatory customer documents uploaded and full document pack generated."
                if step["key"] == "documents_uploaded"
                else "Final document pack approved and locked."
            ),
        })
        changed = True

    if not changed:
        return False

    project.documentation_status = documentation_status
    if project.status == "planning":
        project.status = "in_progress"
    timeline.steps_json = json.dumps(steps, separators=(",", ":"))
    timeline.updated_by_membership_id = actor.membership.id
    _merge_timeline_steps(timeline, project, customer, quotation)
    return True


def set_project_payment_mode(db: Session, actor: CurrentSession, project_id: str, payment_mode: str):
    if not _timeline_can_manage(actor):
        raise WorkflowForbiddenError("Only an administrator can update the project timeline")
    project, customer, quotation = _get_project_context(db, actor, project_id)
    timeline, steps = _ensure_timeline(db, project, customer, quotation)
    current = next((step for step in steps if step["status"] == "current"), None)
    if not current or current["key"] != "payment_mode":
        if timeline.payment_mode == payment_mode:
            db.commit()
            return get_project_timeline(db, actor, project_id)
        raise WorkflowConflictError("Payment mode can only be selected at the active payment milestone")

    current.update({
        "status": "completed",
        "completed_at": datetime.now(UTC).isoformat(),
        "completed_by": actor.user.full_name,
        "note": f"Payment mode confirmed as {payment_mode}.",
    })
    timeline.steps_json = json.dumps(steps, separators=(",", ":"))
    timeline.payment_mode = payment_mode
    project.payment_mode = payment_mode
    project.loan_status = "draft" if payment_mode == "loan" else "not_required"
    timeline.updated_by_membership_id = actor.membership.id
    _merge_timeline_steps(timeline, project, customer, quotation)
    write_event(
        db, company_id=project.company_id, event="project.payment_mode_changed", entity="project",
        entity_id=project.id, actor=actor, project_id=project.id, customer_id=project.customer_id,
        changes={"payment_mode": payment_mode},
    )

    db.commit()
    return get_project_timeline(db, actor, project_id)


def update_project_timeline_step(db: Session, actor: CurrentSession, project_id: str, step_key: str, payload):
    if not _timeline_can_manage(actor):
        raise WorkflowForbiddenError("Only an administrator can update the project timeline")
    project, customer, quotation = _get_project_context(db, actor, project_id)
    timeline, steps = _ensure_timeline(db, project, customer, quotation)
    target_index = next((index for index, step in enumerate(steps) if step["key"] == step_key), -1)
    if target_index < 0:
        raise WorkflowNotFoundError("Timeline step not found")
    target = steps[target_index]

    if payload.action == "complete":
        if target["status"] != "current":
            raise WorkflowConflictError("Only the current step can be completed")
        if step_key == "payment_mode" and not timeline.payment_mode:
            raise WorkflowConflictError("Select cash or loan before completing this step")
        target.update({
            "status": "completed",
            "completed_at": datetime.now(UTC).isoformat(),
            "completed_by": actor.user.full_name,
            "note": payload.note,
            "event_date": payload.event_date.isoformat() if payload.event_date else None,
        })
        project.status = "completed" if step_key == "project_completed" else "in_progress"
        if step_key == "documents_uploaded": project.documentation_status = "in_progress"
        elif step_key == "documents_approved": project.documentation_status = "approved"
        elif step_key == "final_registration": project.registration_status = "completed"
        elif step_key == "loan_application": project.loan_status = "applied"
        elif step_key == "bank_approval": project.loan_status = "approved"
        elif step_key == "material_arrival": project.material_status = "arrived"
        elif step_key == "installation": project.installation_status = "completed"
        elif step_key == "dcr_upload": project.dcr_status = "completed"
        elif step_key == "subsidy": project.subsidy_status = "completed"
        elif step_key == "project_completed":
            project.subsidiary_payment_status = project.subsidiary_payment_status or "pending"
    else:
        if target.get("locked"):
            raise WorkflowConflictError("System-created milestones cannot be reopened")
        if target["status"] != "completed":
            raise WorkflowConflictError("Only a completed step can be reopened")
        for index, step in enumerate(steps):
            if index < target_index:
                continue
            step.update({
                "status": "current" if index == target_index else "pending",
                "completed_at": None,
                "completed_by": "",
                "note": "" if index > target_index else payload.note,
                "event_date": None,
            })
        if step_key == "payment_mode":
            timeline.payment_mode = ""
        project.status = "in_progress"

    timeline.steps_json = json.dumps(steps, separators=(",", ":"))
    timeline.updated_by_membership_id = actor.membership.id
    _merge_timeline_steps(timeline, project, customer, quotation)
    write_event(
        db, company_id=project.company_id, event="project.timeline_changed", entity="project",
        entity_id=project.id, actor=actor, project_id=project.id, customer_id=project.customer_id,
        changes={"step": step_key, "action": payload.action, "note": payload.note},
    )
    db.commit()
    return get_project_timeline(db, actor, project_id)
