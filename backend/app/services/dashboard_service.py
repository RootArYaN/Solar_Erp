from datetime import date

from sqlalchemy import and_, case, func, or_, select
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


def get_summary(db: Session, actor: CurrentSession) -> DashboardSummary:
    company_id = actor.membership.company_id
    month_start = date.today().replace(day=1)

    customer_stats = db.execute(
        select(
            func.count(AgentCustomer.id),
            func.coalesce(
                func.sum(case((AgentCustomer.created_at >= month_start, 1), else_=0)),
                0,
            ),
        ).where(AgentCustomer.company_id == company_id)
    ).one()

    open_project = CustomerProject.status.in_(OPEN_PROJECT_STATUSES)
    project_stats = db.execute(
        select(
            func.coalesce(func.sum(case((open_project, 1), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    CustomerProject.documentation_status.in_(('pending', 'in_progress')),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    CustomerProject.payment_mode == 'loan',
                    CustomerProject.loan_status.in_(PENDING_LOAN_STATUSES),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    or_(
                        CustomerProject.material_status.in_(('scheduled', 'in_transit')),
                        ProjectTimeline.current_step == 'material_arrival',
                    ),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    or_(
                        CustomerProject.installation_status == 'in_progress',
                        ProjectTimeline.current_step == 'installation',
                    ),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    CustomerProject.dcr_status.in_(('pending', 'in_progress')),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((
                and_(
                    open_project,
                    CustomerProject.subsidy_status.in_(('pending', 'applied', 'in_progress')),
                ),
                1,
            ), else_=0)), 0),
            func.coalesce(func.sum(case((CustomerProject.status == 'completed', 1), else_=0)), 0),
        )
        .select_from(CustomerProject)
        .outerjoin(ProjectTimeline, ProjectTimeline.project_id == CustomerProject.id)
        .where(CustomerProject.company_id == company_id)
    ).one()

    pending_quotations = int(db.scalar(
        select(func.count())
        .select_from(QuotationRequest)
        .outerjoin(CustomerQuotation, CustomerQuotation.request_id == QuotationRequest.id)
        .where(
            QuotationRequest.company_id == company_id,
            or_(
                CustomerQuotation.id.is_(None),
                CustomerQuotation.status.in_(PENDING_QUOTATION_STATUSES),
            ),
        )
    ) or 0)

    finance = finance_kpis(db, company_id)
    return DashboardSummary(
        total_customers=int(customer_stats[0] or 0),
        new_customers_month=int(customer_stats[1] or 0),
        active_projects=int(project_stats[0] or 0),
        pending_quotations=pending_quotations,
        pending_documents=int(project_stats[1] or 0),
        loan_approvals_pending=int(project_stats[2] or 0),
        material_arrivals_pending=int(project_stats[3] or 0),
        installations_in_progress=int(project_stats[4] or 0),
        dcr_pending=int(project_stats[5] or 0),
        subsidy_pending=int(project_stats[6] or 0),
        completed_projects=int(project_stats[7] or 0),
        low_stock_items=low_stock_item_count(db, company_id),
        money_received_month=finance.money_in_month,
        money_paid_month=finance.money_out_month,
        expenses_month=finance.expenses_month,
        customer_receivables=finance.customer_receivables,
        supplier_payables=finance.supplier_payables,
    )
