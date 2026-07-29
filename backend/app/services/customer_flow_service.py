from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer, AgentProfile
from app.models.finance import CustomerLoan, FinanceTransaction, FinancialAccount
from app.models.system import AuditEvent, StoredFile
from app.models.workflow import CustomerProject, CustomerQuotation, MaterialRequest, ProjectTimeline, QuotationRequest
from app.schemas.customer_flow import (
    CustomerFlowList,
    CustomerFlowSnapshot,
    FlowActivity,
    FlowAddress,
    FlowContact,
    FlowCustomer,
    FlowDocument,
    FlowLoan,
    FlowMaterialLine,
    FlowMaterialRequest,
    FlowPayment,
    FlowProject,
    FlowQuotation,
    FlowQuotationApproval,
    FlowQuotationLine,
    FlowQuotationRevision,
    FlowSite,
    FlowTimelineStep,
    SaveMaterialDraftRequest,
    UpdateCustomerRequest,
)
from app.services.audit_service import write_event


class CustomerFlowError(Exception):
    status_code = 400


class CustomerFlowNotFoundError(CustomerFlowError):
    status_code = 404


class CustomerFlowForbiddenError(CustomerFlowError):
    status_code = 403


class CustomerFlowConflictError(CustomerFlowError):
    status_code = 409


def _is_admin(actor: CurrentSession) -> bool:
    return actor.user.is_super_admin


def _record_number(prefix: str, created_at: datetime, entity_id: str) -> str:
    return f'{prefix}-{created_at.year}-{entity_id.replace("-", "")[:8].upper()}'


def _money(value: Decimal | float | int | None) -> str:
    return f'{Decimal(value or 0):.2f}'


def _customer_query(actor: CurrentSession):
    statement = select(AgentCustomer).where(AgentCustomer.company_id == actor.membership.company_id)
    if not _is_admin(actor) and 'agents.view_all' not in actor.permissions and 'agents.manage' not in actor.permissions:
        if actor.role == 'customer':
            statement = statement.where(AgentCustomer.customer_membership_id == actor.membership.id)
        else:
            statement = statement.where(AgentCustomer.agent_profile_id.in_(
                select(AgentProfile.id).where(AgentProfile.membership_id == actor.membership.id)
            ))
    return statement


def _load_customer(db: Session, actor: CurrentSession, customer_id: str) -> AgentCustomer:
    customer = db.scalar(_customer_query(actor).where(AgentCustomer.id == customer_id))
    if not customer:
        raise CustomerFlowNotFoundError('Customer not found')
    return customer


def _profile(db: Session, customer: AgentCustomer) -> AgentProfile | None:
    return db.get(AgentProfile, customer.agent_profile_id)


def _customer_summary(
    customer: AgentCustomer,
    payment_mode: str = "",
    profile: AgentProfile | None = None,
) -> FlowCustomer:
    site_address = customer.site_address or customer.address
    billing_address = customer.billing_address or site_address
    contact = FlowContact(
        id=f'{customer.id}-contact', full_name=customer.customer_name, designation='Primary contact',
        email=customer.email, phone=customer.phone, alternate_phone=customer.alternate_phone,
    )
    addresses = [
        FlowAddress(id=f'{customer.id}-site', label='Installation site', line_1=site_address or 'Address not provided', district=customer.district, state=customer.state, postal_code=customer.postal_code),
    ]
    if billing_address and billing_address != site_address:
        addresses.append(FlowAddress(id=f'{customer.id}-billing', label='Billing', line_1=billing_address, district=customer.district, state=customer.state, postal_code=customer.postal_code, is_primary=False))
    return FlowCustomer(
        id=customer.id, record_number=_record_number('CUS', customer.created_at, customer.id), version=1,
        created_at=customer.created_at, updated_at=customer.updated_at,
        display_name=customer.customer_name, legal_name=customer.customer_name,
        customer_type=customer.customer_type or 'residential', status=customer.status,
        primary_contact_id=contact.id, contacts=[contact], addresses=addresses,
        assigned_agent_id=profile.membership_id if profile else None,
        alternate_phone=customer.alternate_phone, billing_address=billing_address, site_address=site_address,
        district=customer.district, state=customer.state, postal_code=customer.postal_code,
        consumer_number=customer.consumer_number, electricity_provider=customer.electricity_provider,
        lead_source=customer.lead_source, payment_mode=payment_mode,
        outstanding_balance=_money(customer.outstanding_balance),
    )


def _requests(db: Session, customer_id: str) -> list[QuotationRequest]:
    return list(db.scalars(select(QuotationRequest).where(QuotationRequest.customer_id == customer_id).order_by(QuotationRequest.created_at.desc())).all())


def _quotation_map(db: Session, requests: list[QuotationRequest]) -> dict[str, CustomerQuotation]:
    if not requests:
        return {}
    rows = db.scalars(select(CustomerQuotation).where(CustomerQuotation.request_id.in_([row.id for row in requests]))).all()
    return {row.request_id: row for row in rows}


def _project_map(db: Session, quotations: list[CustomerQuotation]) -> dict[str, CustomerProject]:
    if not quotations:
        return {}
    rows = db.scalars(select(CustomerProject).where(CustomerProject.quotation_id.in_([row.id for row in quotations])).order_by(CustomerProject.created_at.desc())).all()
    return {row.quotation_id: row for row in rows}


def _site_summary(customer: AgentCustomer, request: QuotationRequest, quotation: CustomerQuotation | None, project: CustomerProject | None) -> FlowSite:
    status = 'converted' if project else 'approved' if quotation and quotation.status == 'approved' else 'quotation_ready' if quotation else 'surveyed'
    address = request.site_address or customer.site_address or customer.address
    return FlowSite(
        id=request.id, record_number=_record_number('SITE', request.created_at, request.id), created_at=request.created_at,
        updated_at=request.updated_at, customer_id=customer.id, name=request.requirement_summary,
        address=FlowAddress(id=f'{request.id}-address', label='Installation site', line_1=address or 'Address not provided', district=customer.district, state=customer.state, postal_code=customer.postal_code),
        consumer_number=customer.consumer_number, proposed_capacity_kw=_money(request.proposed_capacity_kw), status=status,
    )


def _line_summaries(quotation: CustomerQuotation) -> list[FlowQuotationLine]:
    try:
        raw_lines = json.loads(quotation.line_items_json or '[]')
    except (TypeError, ValueError, json.JSONDecodeError):
        raw_lines = []
    result = []
    for index, line in enumerate(raw_lines if isinstance(raw_lines, list) else []):
        if not isinstance(line, dict):
            continue
        result.append(FlowQuotationLine(
            id=f'{quotation.id}-line-{index + 1}', description=str(line.get('description') or 'Item'),
            quantity=_money(line.get('quantity')), unit=str(line.get('unit') or 'Unit'),
            unit_price=_money(line.get('unit_price')), tax_rate=_money(line.get('tax_rate')),
            line_total=_money(line.get('line_total')),
        ))
    return result


def _revision_status(status: str) -> str:
    return {'pending_approval': 'submitted', 'condition': 'changes_requested'}.get(status, status)


def _quotation_summary(request: QuotationRequest, quotation: CustomerQuotation) -> FlowQuotation:
    approval = None
    if quotation.decided_at and quotation.decided_by_membership_id:
        approval = FlowQuotationApproval(id=f'{quotation.id}-approval', decision=_revision_status(quotation.status), decided_by=quotation.decided_by_membership_id, decided_at=quotation.decided_at, comment=quotation.decision_comment)
    revision = FlowQuotationRevision(
        id=quotation.id, record_number=f'{quotation.quotation_number}-R1', version=1,
        created_at=quotation.created_at, updated_at=quotation.updated_at, quotation_id=quotation.id,
        status=_revision_status(quotation.status), valid_until=quotation.valid_until, subtotal=_money(quotation.subtotal),
        tax_total=_money(quotation.tax_total), grand_total=_money(quotation.grand_total), notes=request.notes,
        approval=approval, lines=_line_summaries(quotation),
    )
    return FlowQuotation(
        id=quotation.id, record_number=quotation.quotation_number, version=1, created_at=quotation.created_at,
        updated_at=quotation.updated_at, customer_id=quotation.customer_id, site_id=request.id, title=quotation.title,
        current_revision_id=revision.id, revisions=[revision],
    )


def _project_summary(request: QuotationRequest, project: CustomerProject) -> FlowProject:
    return FlowProject(
        id=project.id, record_number=project.project_number, version=1, created_at=project.created_at,
        updated_at=project.updated_at,
        customer_id=project.customer_id, site_id=request.id, quotation_id=project.quotation_id, name=project.name,
        status=project.status, capacity_kw=_money(project.capacity_kw), approved_value=_money(project.approved_value),
        site_address=project.site_address or request.site_address, payment_mode=project.payment_mode,
        loan_status=project.loan_status, documentation_status=project.documentation_status,
        registration_status=project.registration_status, material_status=project.material_status,
        installation_status=project.installation_status, dcr_status=project.dcr_status,
        subsidy_status=project.subsidy_status, subsidiary_payment_status=project.subsidiary_payment_status,
    )


def _material_lines(raw_value: str) -> list[FlowMaterialLine]:
    try:
        raw_lines = json.loads(raw_value or '[]')
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    return [FlowMaterialLine.model_validate(line) for line in raw_lines if isinstance(line, dict)] if isinstance(raw_lines, list) else []


def _material_summary(material: MaterialRequest) -> FlowMaterialRequest:
    return FlowMaterialRequest(id=material.id, record_number=material.record_number, version=material.version, created_at=material.created_at, updated_at=material.updated_at, project_id=material.project_id, status=material.status, requested_by=material.requested_by_membership_id, needed_at_site_by=material.needed_at_site_by, purpose=material.purpose, lines=_material_lines(material.lines_json))


def _timeline(db: Session, project: CustomerProject | None) -> list[FlowTimelineStep]:
    if not project:
        return []
    row = db.scalar(select(ProjectTimeline).where(ProjectTimeline.project_id == project.id))
    if not row:
        return []
    try:
        steps = json.loads(row.steps_json or '[]')
    except json.JSONDecodeError:
        steps = []
    result = []
    for step in steps if isinstance(steps, list) else []:
        if not isinstance(step, dict):
            continue
        event_date = step.get('event_date')
        result.append(FlowTimelineStep(
            key=str(step.get('key') or ''), name=str(step.get('name') or ''), status=str(step.get('status') or 'pending'),
            event_date=event_date[:10] if isinstance(event_date, str) and event_date else None,
            completed_at=step.get('completed_at'), note=str(step.get('note') or ''),
            updated_by=str(step.get('completed_by') or ''),
        ))
    return result


def _documents(db: Session, customer_id: str) -> list[FlowDocument]:
    rows = db.scalars(select(StoredFile).where(StoredFile.customer_id == customer_id).order_by(StoredFile.created_at.desc()).limit(100)).all()
    return [FlowDocument(id=row.id, name=row.name, owner_type=row.owner_type, project_id=row.project_id, created_at=row.created_at) for row in rows]


def _payments(db: Session, customer_id: str) -> list[FlowPayment]:
    rows = list(db.scalars(select(FinanceTransaction).where(FinanceTransaction.customer_id == customer_id).order_by(FinanceTransaction.transaction_date.desc(), FinanceTransaction.created_at.desc()).limit(100)).all())
    account_ids = {row.account_id for row in rows}
    accounts = {row.id: row for row in db.scalars(select(FinancialAccount).where(FinancialAccount.id.in_(account_ids))).all()} if account_ids else {}
    return [FlowPayment(id=row.id, transaction_number=row.transaction_number, transaction_date=row.transaction_date, direction=row.direction, amount=_money(row.amount), account_id=row.account_id, category_id=row.category_id, source_type=row.source_type, description=row.description, payment_method=row.payment_method, account_name=accounts[row.account_id].name if row.account_id in accounts else '', reference_number=row.reference_number, status=row.status) for row in rows]


def _loan(db: Session, project: CustomerProject | None) -> FlowLoan | None:
    if not project:
        return None
    row = db.scalar(select(CustomerLoan).where(CustomerLoan.project_id == project.id))
    if not row:
        return None
    return FlowLoan(id=row.id, project_id=row.project_id, bank_name=row.bank_name, application_number=row.application_number, requested_amount=_money(row.requested_amount), approved_amount=_money(row.approved_amount), customer_contribution=_money(row.customer_contribution), application_status=row.application_status, documentation_status=row.documentation_status, first_disbursement_amount=_money(row.first_disbursement_amount), second_disbursement_amount=_money(row.second_disbursement_amount), emi_amount=_money(row.emi_amount), loan_status=row.loan_status, note=row.note)


def _activity(db: Session, customer_id: str) -> list[FlowActivity]:
    rows = db.scalars(select(AuditEvent).where(AuditEvent.customer_id == customer_id).order_by(AuditEvent.created_at.desc()).limit(100)).all()
    result=[]
    for row in rows:
        try: changes=json.loads(row.changes_json or '{}')
        except json.JSONDecodeError: changes={}
        result.append(FlowActivity(id=row.id,event=row.event,entity=row.entity,project_id=row.project_id,changes=changes if isinstance(changes,dict) else {},user_role=row.user_role,created_at=row.created_at))
    return result


def list_customers(
    db: Session,
    actor: CurrentSession,
    *,
    page: int = 1,
    page_size: int = 50,
) -> CustomerFlowList:
    offset = (page - 1) * page_size
    customer_rows = list(db.scalars(
        _customer_query(actor)
        .order_by(AgentCustomer.updated_at.desc(), AgentCustomer.id.desc())
        .offset(offset)
        .limit(page_size + 1)
    ).all())
    has_more = len(customer_rows) > page_size
    customers = customer_rows[:page_size]
    customer_ids = [customer.id for customer in customers]
    project_rows = db.execute(
        select(CustomerProject.customer_id, CustomerProject.payment_mode)
        .where(
            CustomerProject.customer_id.in_(customer_ids),
        )
        .order_by(CustomerProject.created_at.desc())
    ).all() if customer_ids else []
    payment_modes: dict[str, str] = {}
    for customer_id, payment_mode in project_rows:
        payment_modes.setdefault(customer_id, payment_mode or "")
    profile_ids = {customer.agent_profile_id for customer in customers}
    profiles = {
        profile.id: profile
        for profile in db.scalars(select(AgentProfile).where(AgentProfile.id.in_(profile_ids))).all()
    } if profile_ids else {}
    sync_cursor = max((customer.updated_at for customer in customers), default=datetime.now(UTC)).isoformat()
    return CustomerFlowList(
        items=[
            _customer_summary(
                customer,
                payment_modes.get(customer.id, ""),
                profiles.get(customer.agent_profile_id),
            )
            for customer in customers
        ],
        next_cursor=str(page + 1) if has_more else None,
        sync_cursor=sync_cursor,
    )


def get_snapshot(db: Session, actor: CurrentSession, customer_id: str) -> CustomerFlowSnapshot:
    customer = _load_customer(db, actor, customer_id)
    requests = _requests(db, customer.id)
    quotation_by_request = _quotation_map(db, requests)
    quotations = [quotation_by_request[row.id] for row in requests if row.id in quotation_by_request]
    project_by_quotation = _project_map(db, quotations)
    projects: list[FlowProject] = []
    sites: list[FlowSite] = []
    quotation_summaries: list[FlowQuotation] = []
    latest_project_row: CustomerProject | None = None
    for request in requests:
        quotation = quotation_by_request.get(request.id)
        project = project_by_quotation.get(quotation.id) if quotation else None
        sites.append(_site_summary(customer, request, quotation, project))
        if quotation:
            quotation_summaries.append(_quotation_summary(request, quotation))
        if project:
            projects.append(_project_summary(request, project))
            if latest_project_row is None:
                latest_project_row = project
    material = db.scalar(select(MaterialRequest).where(MaterialRequest.project_id == latest_project_row.id)) if latest_project_row else None
    return CustomerFlowSnapshot(
        customer=_customer_summary(
            customer,
            latest_project_row.payment_mode if latest_project_row else "",
            _profile(db, customer),
        ), sites=sites, quotations=quotation_summaries, projects=projects,
        project=projects[0] if projects else None, material_request=_material_summary(material) if material else None,
        timeline=_timeline(db, latest_project_row), documents=_documents(db, customer.id), payments=_payments(db, customer.id),
        loan=_loan(db, latest_project_row), activity=_activity(db, customer.id),
    )


def update_customer(db: Session, actor: CurrentSession, customer_id: str, payload: UpdateCustomerRequest) -> CustomerFlowSnapshot:
    customer = _load_customer(db, actor, customer_id)
    if not _is_admin(actor) and 'customers.edit' not in actor.permissions and 'agents.manage' not in actor.permissions:
        raise CustomerFlowForbiddenError('You cannot edit customer details')
    before = {'customer_name': customer.customer_name, 'phone': customer.phone, 'site_address': customer.site_address, 'status': customer.status}
    customer.customer_name = payload.full_name
    customer.company_name = ''
    customer.phone = payload.phone
    customer.alternate_phone = payload.alternate_phone
    customer.email = payload.email.lower()
    customer.billing_address = payload.billing_address
    customer.site_address = payload.site_address
    customer.address = payload.site_address
    customer.district = payload.district
    customer.state = payload.state
    customer.postal_code = payload.postal_code
    customer.consumer_number = payload.consumer_number
    customer.electricity_provider = payload.electricity_provider
    customer.customer_type = payload.customer_type
    customer.lead_source = payload.lead_source
    customer.status = payload.status
    write_event(db, company_id=customer.company_id, event='customer.updated', entity='customer', entity_id=customer.id, actor=actor, customer_id=customer.id, changes={'before': before, 'after': payload.model_dump()})
    db.commit()
    return get_snapshot(db, actor, customer.id)


def save_material_draft(db: Session, actor: CurrentSession, customer_id: str, payload: SaveMaterialDraftRequest) -> CustomerFlowSnapshot:
    customer = _load_customer(db, actor, customer_id)
    requests = _requests(db, customer.id)
    quotation_by_request = _quotation_map(db, requests)
    project_by_quotation = _project_map(db, list(quotation_by_request.values()))
    project = next((project_by_quotation[q.id] for request in requests if (q := quotation_by_request.get(request.id)) and q.id in project_by_quotation), None)
    if not project:
        raise CustomerFlowConflictError('Approve the quotation before drafting a material request')
    material = db.scalar(select(MaterialRequest).where(MaterialRequest.project_id == project.id))
    if material and material.status != 'draft':
        raise CustomerFlowConflictError('Only draft material requests can be edited')
    if not material:
        material = MaterialRequest(company_id=actor.membership.company_id, project_id=project.id, record_number=_record_number('MR', datetime.now(UTC), project.id), requested_by_membership_id=actor.membership.id, purpose=payload.purpose)
        db.add(material)
    else:
        material.version += 1
    material.purpose = payload.purpose
    material.needed_at_site_by = payload.needed_at_site_by
    material.lines_json = json.dumps([line.model_dump(mode='json') for line in payload.lines], separators=(',', ':'))
    material.status = 'draft'
    db.flush()
    write_event(db, company_id=material.company_id, event='material_request.draft_saved', entity='material_request', entity_id=material.id, actor=actor, project_id=project.id, customer_id=customer.id, changes={'record_number': material.record_number, 'version': material.version, 'line_count': len(payload.lines)})
    db.commit()
    return get_snapshot(db, actor, customer.id)
