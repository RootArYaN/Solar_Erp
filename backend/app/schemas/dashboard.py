from pydantic import BaseModel


class DashboardSummary(BaseModel):
    total_customers: int
    new_customers_month: int
    active_projects: int
    pending_quotations: int
    pending_documents: int
    loan_approvals_pending: int
    material_arrivals_pending: int
    installations_in_progress: int
    dcr_pending: int
    subsidy_pending: int
    completed_projects: int
    low_stock_items: int
    money_received_month: float
    money_paid_month: float
    expenses_month: float
    customer_receivables: float
    supplier_payables: float
