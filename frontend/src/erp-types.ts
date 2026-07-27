export type DashboardSummary = {
  total_customers: number
  new_customers_month: number
  active_projects: number
  pending_quotations: number
  pending_documents: number
  loan_approvals_pending: number
  material_arrivals_pending: number
  installations_in_progress: number
  dcr_pending: number
  subsidy_pending: number
  completed_projects: number
  low_stock_items: number
  money_received_month: number
  money_paid_month: number
  expenses_month: number
  customer_receivables: number
  supplier_payables: number
}

export type FinancialAccount = {
  id: string
  name: string
  account_type: 'bank' | 'cash' | 'upi' | 'petty_cash'
  bank_name: string
  masked_account_number: string
  opening_balance: number
  current_balance: number
  is_active: boolean
  updated_at: string
}

export type FinanceCategory = { id: string; code: string; name: string; category_type: string }

export type FinanceTransaction = {
  id: string
  transaction_number: string
  transaction_date: string
  direction: 'credit' | 'debit'
  category_id: string | null
  category_name: string
  amount: number
  account_id: string
  account_name: string
  payment_method: string
  party_type: string
  party_name: string
  customer_id: string | null
  customer_name: string
  project_id: string | null
  project_number: string
  source_type: string
  source_id: string | null
  reference_number: string
  description: string
  status: string
  created_by_name: string
  created_at: string
}

export type FinanceTransactionList = { data: FinanceTransaction[]; page: number; page_size: number; total: number; money_in: number; money_out: number }

export type Bill = {
  id: string
  bill_type: 'sales' | 'purchase'
  bill_number: string
  bill_date: string
  customer_id: string | null
  customer_name: string
  project_id: string | null
  project_number: string
  supplier_name: string
  subtotal: number
  tax_amount: number
  total_amount: number
  due_date: string | null
  paid_amount: number
  balance_amount: number
  payment_status: string
  status: string
  file_id: string | null
  note: string
  created_at: string
}
export type BillList = { data: Bill[]; page: number; page_size: number; total: number }
export type BillCustomerOption = { id: string; customer_name: string }

export type CompanyLoan = {
  id: string
  lender_name: string
  loan_account_number: string
  principal_amount: number
  interest_rate: number
  emi_amount: number
  start_date: string
  end_date: string | null
  outstanding_amount: number
  next_due_date: string | null
  status: string
  note: string
  created_at: string
  updated_at: string
}

export type FinanceOverview = {
  money_in_month: number
  money_out_month: number
  bank_balance: number
  cash_balance: number
  customer_receivables: number
  supplier_payables: number
  expenses_month: number
  net_cash_flow: number
  accounts: FinancialAccount[]
  recent_transactions: FinanceTransaction[]
  pending_bills: Bill[]
  expense_by_category: Array<{ category: string; amount: number }>
  monthly_flow: Array<{ month: string; money_in: number; money_out: number }>
}

export type Profitability = {
  sales_value: number
  money_received: number
  subsidy_received: number
  material_cost: number
  project_expenses: number
  operating_expenses: number
  net_cash_flow: number
  estimated_gross_profit: number
  projects: Array<{ project_id: string; project_number: string; project_name: string; sales_value: number; money_received: number; cost: number; gross_profit: number }>
}

export type InventoryLocation = { id: string; version: number; name: string; location_type: string; address: string; is_active: boolean }
export type InventoryItem = {
  id: string
  version: number
  sku: string
  name: string
  category: string
  unit: string
  supplier_name: string
  unit_cost: number
  reorder_level: number
  quantity_on_hand: number
  reserved_quantity: number
  available_quantity: number
  location_id: string | null
  location_name: string
  low_stock: boolean
  is_active: boolean
  updated_at: string
}
export type InventoryMovement = {
  id: string
  item_id: string
  item_name: string
  movement_type: string
  quantity: number
  source_location_id: string | null
  source_location_name: string
  destination_location_id: string | null
  destination_location_name: string
  project_id: string | null
  project_number: string
  customer_id: string | null
  customer_name: string
  reference_number: string
  partner_name: string
  note: string
  status: string
  created_at: string
}
export type InventorySummary = { items: InventoryItem[]; locations: InventoryLocation[]; movements: InventoryMovement[]; total_items: number; low_stock_items: number; stock_value: number; total_quantity: number }

export type PricingItem = {
  id?: string | null
  inventory_item_id?: string | null
  name: string
  category: string
  unit: string
  price: number
  quantity: number
  tax_rate: number
  calculation_type: string
  calculation_value: number
  display_order: number
  is_active: boolean
}
export type PricingBook = { id: string; name: string; version: number; is_default: boolean; is_active: boolean; updated_at: string; items: PricingItem[] }

export type Poster = { id: string; version: number; title: string; description: string; file_id: string; file_name: string; mime_type: string; category: string; status: 'draft' | 'active' | 'archived'; created_at: string; updated_at: string }

export type DocumentTemplate = { id: string; template_type: string; name: string; settings: Record<string, unknown>; is_active: boolean; updated_at: string }
