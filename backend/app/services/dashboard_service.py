from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer
from app.models.workflow import CustomerProject, CustomerQuotation, ProjectTimeline, QuotationRequest
from app.schemas.dashboard import DashboardSummary
from app.services.finance_service import finance_kpis
from app.services.operations_service import low_stock_item_count


OPEN_PROJECT_STATUSES = ('planning', 'in_progress', 'on_hold')
PENDING_LOAN_STATUSES = (
    'draft',
    'applied',
    'documents_pending',
    'submitted_to_bank',
    'under_review',
    'conditionally_approved',
)
PENDING_QUOTATION_STATUSES = ('pending_approval', 'condition', 'rejected')


def _count(db: Session, statement) -> int:
    return int(db.scalar(statement) or 0)


def get_summary(db: Session, actor: CurrentSession) -> DashboardSummary:
    company_id = actor.membership.company_id
    month_start = date.today().replace(day=1)
    active_project_filters = (
        CustomerProject.company_id == company_id,
        CustomerProject.archived_at.is_(None),
        CustomerProject.status.in_(OPEN_PROJECT_STATUSES),
    )

    total_customers = _count(db, select(func.count()).select_from(AgentCustomer).where(
        AgentCustomer.company_id == company_id,
        AgentCustomer.archived_at.is_(None),
    ))
    new_customers = _count(db, select(func.count()).select_from(AgentCustomer).where(
        AgentCustomer.company_id == company_id,
        AgentCustomer.created_at >= month_start,
        AgentCustomer.archived_at.is_(None),
    ))
    active_projects = _count(db, select(func.count()).select_from(CustomerProject).where(
        *active_project_filters,
    ))

    # This mirrors the Approval Center: requests without a generated quote and
    # quotes that still require approval/revision are actionable.
    pending_quotations = _count(
        db,
        select(func.count())
        .select_from(QuotationRequest)
        .outerjoin(CustomerQuotation, CustomerQuotation.request_id == QuotationRequest.id)
        .where(
            QuotationRequest.company_id == company_id,
            or_(
                CustomerQuotation.id.is_(None),
                CustomerQuotation.status.in_(PENDING_QUOTATION_STATUSES),
            ),
        ),
    )

    # Document completion is project workflow state. Uploaded files use the
    # owner type "customer_document", so counting synthetic pending file types
    # would never reflect the Documents page.
    pending_documents = _count(db, select(func.count()).select_from(CustomerProject).where(
        *active_project_filters,
        CustomerProject.documentation_status.in_(('pending', 'in_progress')),
    ))
    loan_pending = _count(db, select(func.count()).select_from(CustomerProject).where(
        *active_project_filters,
        CustomerProject.payment_mode == 'loan',
        CustomerProject.loan_status.in_(PENDING_LOAN_STATUSES),
    ))

    project_timeline = (
        select(CustomerProject.id, ProjectTimeline.current_step)
        .outerjoin(ProjectTimeline, ProjectTimeline.project_id == CustomerProject.id)
        .where(*active_project_filters)
        .subquery()
    )
    material_pending = _count(
        db,
        select(func.count()).select_from(CustomerProject)
        .join(project_timeline, project_timeline.c.id == CustomerProject.id)
        .where(or_(
            CustomerProject.material_status.in_(('scheduled', 'in_transit')),
            project_timeline.c.current_step == 'material_arrival',
        )),
    )
    installations_in_progress = _count(
        db,
        select(func.count()).select_from(CustomerProject)
        .join(project_timeline, project_timeline.c.id == CustomerProject.id)
        .where(or_(
            CustomerProject.installation_status == 'in_progress',
            project_timeline.c.current_step == 'installation',
        )),
    )
    dcr_pending = _count(db, select(func.count()).select_from(CustomerProject).where(
        *active_project_filters,
        CustomerProject.dcr_status.in_(('pending', 'in_progress')),
    ))
    subsidy_pending = _count(db, select(func.count()).select_from(CustomerProject).where(
        *active_project_filters,
        CustomerProject.subsidy_status.in_(('pending', 'applied', 'in_progress')),
    ))
    completed_projects = _count(db, select(func.count()).select_from(CustomerProject).where(
        CustomerProject.company_id == company_id,
        CustomerProject.archived_at.is_(None),
        CustomerProject.status == 'completed',
    ))

    finance = finance_kpis(db, company_id)
    return DashboardSummary(
        total_customers=total_customers,
        new_customers_month=new_customers,
        active_projects=active_projects,
        pending_quotations=pending_quotations,
        pending_documents=pending_documents,
        loan_approvals_pending=loan_pending,
        material_arrivals_pending=material_pending,
        installations_in_progress=installations_in_progress,
        dcr_pending=dcr_pending,
        subsidy_pending=subsidy_pending,
        completed_projects=completed_projects,
        low_stock_items=low_stock_item_count(db, company_id),
        money_received_month=finance.money_in_month,
        money_paid_month=finance.money_out_month,
        expenses_month=finance.expenses_month,
        customer_receivables=finance.customer_receivables,
        supplier_payables=finance.supplier_payables,
    )
