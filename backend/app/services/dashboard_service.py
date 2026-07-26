from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import CurrentSession
from app.models.agent import AgentCustomer
from app.models.finance import Bill, CustomerLoan, FinanceTransaction
from app.models.operations import InventoryBalance, InventoryItem
from app.models.system import StoredFile
from app.models.workflow import CustomerProject, CustomerQuotation
from app.schemas.dashboard import DashboardSummary


def get_summary(db: Session, actor: CurrentSession) -> DashboardSummary:
    company_id=actor.membership.company_id
    month_start=date.today().replace(day=1)
    total_customers=db.scalar(select(func.count()).select_from(AgentCustomer).where(AgentCustomer.company_id==company_id,AgentCustomer.archived_at.is_(None))) or 0
    new_customers=db.scalar(select(func.count()).select_from(AgentCustomer).where(AgentCustomer.company_id==company_id,AgentCustomer.created_at>=month_start,AgentCustomer.archived_at.is_(None))) or 0
    active_projects=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.status.not_in(['completed','cancelled']),CustomerProject.archived_at.is_(None))) or 0
    pending_quotations=db.scalar(select(func.count()).select_from(CustomerQuotation).where(CustomerQuotation.company_id==company_id,CustomerQuotation.status.in_(['pending_approval','condition','submitted']))) or 0
    pending_documents=db.scalar(select(func.count()).select_from(StoredFile).where(StoredFile.company_id==company_id,StoredFile.status=='active',StoredFile.owner_type.in_(['customer_document_pending','document_pending']))) or 0
    loan_pending=db.scalar(select(func.count()).select_from(CustomerLoan).where(CustomerLoan.company_id==company_id,CustomerLoan.loan_status.in_(['draft','applied','documents_pending','submitted_to_bank','under_review','conditionally_approved']))) or 0
    material_pending=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.material_status.in_(['pending','scheduled','in_transit']))) or 0
    installation=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.installation_status=='in_progress')) or 0
    dcr_pending=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.dcr_status.in_(['pending','in_progress']))) or 0
    subsidy_pending=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.subsidy_status.in_(['pending','applied','in_progress']))) or 0
    completed=db.scalar(select(func.count()).select_from(CustomerProject).where(CustomerProject.company_id==company_id,CustomerProject.status=='completed')) or 0
    low_stock=db.scalar(select(func.count()).select_from(InventoryItem).where(InventoryItem.company_id==company_id,InventoryItem.is_active.is_(True),InventoryItem.reorder_level >= select(func.coalesce(func.sum(InventoryBalance.quantity_on_hand-InventoryBalance.reserved_quantity),0)).where(InventoryBalance.item_id==InventoryItem.id).scalar_subquery())) or 0
    money_in=db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount),0)).where(FinanceTransaction.company_id==company_id,FinanceTransaction.direction=='credit',FinanceTransaction.status=='posted',FinanceTransaction.transaction_date>=month_start)) or 0
    money_out=db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount),0)).where(FinanceTransaction.company_id==company_id,FinanceTransaction.direction=='debit',FinanceTransaction.status=='posted',FinanceTransaction.transaction_date>=month_start)) or 0
    expenses=db.scalar(select(func.coalesce(func.sum(FinanceTransaction.amount),0)).where(FinanceTransaction.company_id==company_id,FinanceTransaction.direction=='debit',FinanceTransaction.source_type=='expense',FinanceTransaction.status=='posted',FinanceTransaction.transaction_date>=month_start)) or 0
    receivables=db.scalar(select(func.coalesce(func.sum(Bill.balance_amount),0)).where(Bill.company_id==company_id,Bill.bill_type=='sales',Bill.status!='cancelled')) or 0
    payables=db.scalar(select(func.coalesce(func.sum(Bill.balance_amount),0)).where(Bill.company_id==company_id,Bill.bill_type=='purchase',Bill.status!='cancelled')) or 0
    return DashboardSummary(total_customers=int(total_customers),new_customers_month=int(new_customers),active_projects=int(active_projects),pending_quotations=int(pending_quotations),pending_documents=int(pending_documents),loan_approvals_pending=int(loan_pending),material_arrivals_pending=int(material_pending),installations_in_progress=int(installation),dcr_pending=int(dcr_pending),subsidy_pending=int(subsidy_pending),completed_projects=int(completed),low_stock_items=int(low_stock),money_received_month=float(money_in),money_paid_month=float(money_out),expenses_month=float(expenses),customer_receivables=float(receivables),supplier_payables=float(payables))
