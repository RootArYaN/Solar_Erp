export type Session = {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  membership_id?: string
  user: {
    id: string
    username: string
    email: string
    full_name: string
  }
  company: {
    id: string
    name: string
    code: string
  }
  role: string
  permissions: string[]
}

export type ManagedUser = {
  id: string
  membership_id: string
  username: string
  email: string
  full_name: string
  is_active: boolean
  is_super_admin: boolean
  role: string
  created_at: string
}

export type Permission = {
  id: string
  code: string
  name: string
  description: string
}

export type Role = {
  id: string
  name: string
  code: string
  description: string
  is_system: boolean
  permissions: string[]
  member_count: number
}

export type CreateUserInput = {
  full_name: string
  username: string
  email: string
  password: string
  role_code: string
  is_active: boolean
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password'>>

export type CreateRoleInput = {
  name: string
  code: string
  description: string
  permission_codes: string[]
}

export type UpdateRoleInput = Omit<CreateRoleInput, 'code'>

export type AgentListItem = {
  membership_id: string
  full_name: string
  email: string
  phone: string
  city: string
  is_active: boolean
  customer_count: number
  current_balance: number
}

export type AgentProfile = {
  id: string
  membership_id: string
  full_name: string
  email: string
  phone: string
  alternate_phone: string
  address_line_1: string
  address_line_2: string
  city: string
  state: string
  postal_code: string
  is_active: boolean
  opening_balance: number
  current_balance: number
}

export type AgentCustomer = {
  id: string
  customer_name: string
  company_name: string
  email: string
  phone: string
  address: string
  project_name: string
  status: string
  outstanding_balance: number
  quotation_request_status: string | null
  quotation_status: string | null
  project_number: string | null
  project_status: string | null
  can_edit: boolean
}

export type AgentTransaction = {
  id: string
  transaction_date: string
  reference: string
  transaction_type: string
  description: string
  debit: number
  credit: number
  running_balance: number
  approval_status: string
  approval_comment: string
}

export type AgentOverview = {
  profile: AgentProfile
  customer_count: number
  active_customer_count: number
  customer_outstanding: number
  customers: AgentCustomer[]
  transactions: AgentTransaction[]
}

export type UpdateAgentProfileInput = Pick<
  AgentProfile,
  'phone' | 'alternate_phone' | 'address_line_1' | 'address_line_2' | 'city' | 'state' | 'postal_code'
>

export type CreateAgentTransactionInput = {
  transaction_date?: string
  reference: string
  transaction_type: string
  description: string
  debit: number
  credit: number
}

export type CreateAgentCustomerInput = {
  customer_name: string
  company_name: string
  email: string
  phone: string
  address: string
  project_name: string
}

export type CreateQuotationRequestInput = {
  requirement_summary: string
  proposed_capacity_kw: number
  site_address: string
  notes: string
}

export type QuotationLineInput = {
  description: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: number
}

export type GenerateQuotationInput = {
  title: string
  valid_until?: string | null
  lines: QuotationLineInput[]
}

export type ApprovalDecisionInput = {
  decision: 'approved' | 'rejected'
  comment: string
}

export type WorkflowQuotation = {
  id: string
  quotation_number: string
  title: string
  subtotal: number
  tax_total: number
  grand_total: number
  valid_until: string | null
  status: string
  decision_comment: string
  created_at: string
}

export type QuotationRequestSummary = {
  id: string
  customer_id: string
  customer_name: string
  company_name: string
  agent_membership_id: string
  agent_name: string
  requirement_summary: string
  proposed_capacity_kw: number
  site_address: string
  notes: string
  status: string
  review_comment: string
  created_at: string
  quotation: WorkflowQuotation | null
  project_number: string | null
  project_status: string | null
}

export type TransactionApprovalSummary = {
  approval_id: string
  transaction_id: string
  agent_membership_id: string
  agent_name: string
  transaction_date: string
  reference: string
  transaction_type: string
  description: string
  debit: number
  credit: number
  status: string
  decision_comment: string
  created_at: string
}

export type ApprovalCenter = {
  quotation_requests: QuotationRequestSummary[]
  transactions: TransactionApprovalSummary[]
}
