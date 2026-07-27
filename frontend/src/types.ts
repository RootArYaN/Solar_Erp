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
    is_super_admin: boolean
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
  alternate_phone: string
  email: string
  phone: string
  address: string
  billing_address: string
  site_address: string
  district: string
  state: string
  postal_code: string
  consumer_number: string
  electricity_provider: string
  customer_type: 'residential' | 'commercial' | 'society' | 'institutional'
  lead_source: string
  project_name: string
  status: string
  outstanding_balance: number
  quotation_request_status: string | null
  quotation_status: string | null
  project_id: string | null
  project_number: string | null
  project_status: string | null
  approved_quotation: WorkflowQuotation | null
  can_edit: boolean
}

export type AgentTransaction = {
  id: string
  project_id: string | null
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
  commission_total: number
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
  project_id?: string
  reference: string
  transaction_type: string
  description: string
  debit: number
  credit: number
}

export type CreateAgentCustomerInput = {
  customer_name: string
  company_name?: string
  email: string
  phone: string
  alternate_phone: string
  address: string
  billing_address: string
  site_address: string
  district: string
  state: string
  postal_code: string
  consumer_number: string
  electricity_provider: string
  customer_type: 'residential' | 'commercial' | 'society' | 'institutional'
  lead_source: string
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
  decision: 'approved' | 'condition' | 'rejected'
  comment: string
}

export type WorkflowQuotationLine = {
  description: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: number
  line_total: number
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
  approved_at: string | null
  lines: WorkflowQuotationLine[]
}

export type QuotationRequestSummary = {
  id: string
  customer_id: string
  customer_name: string
  company_name: string
  customer_phone: string
  customer_email: string
  customer_address: string
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


export type ProjectTimelineStep = {
  key: string
  name: string
  status: 'pending' | 'current' | 'completed'
  completed_at: string | null
  completed_by: string
  note: string
  event_date: string | null
  locked: boolean
}

export type ProjectTimelineListItem = {
  project_id: string
  customer_id: string
  project_number: string
  project_name: string
  customer_name: string
  customer_phone: string
  project_status: string
  payment_mode: '' | 'cash' | 'loan'
  current_step: string
  current_step_name: string
  progress: number
  updated_at: string
}

export type ProjectTimeline = ProjectTimelineListItem & {
  capacity_kw: number
  approved_value: number
  can_manage: boolean
  steps: ProjectTimelineStep[]
}

export type ProjectTimelineStepInput = {
  action: 'complete' | 'reopen'
  note?: string
  event_date?: string | null
}

export type ArchiveStatus = 'queued' | 'collecting' | 'packing' | 'verifying' | 'ready' | 'cleaned' | 'failed' | 'restored' | 'purged'

export type ArchiveSummary = {
  id: string
  type: 'project' | 'customer' | 'agent_transactions'
  ref_id: string
  project_id: string | null
  customer_id: string | null
  customer_name: string
  agent_name: string
  project_name: string
  status: ArchiveStatus
  file_name: string
  size_bytes: number
  checksum: string
  created_at: string
  verified_at: string | null
  keep_until: string | null
  cleaned_at: string | null
  restored_at: string | null
  error: string
}

export type ArchiveList = { data: ArchiveSummary[]; page: number; page_size: number; total: number }
export type ArchiveKpis = { archived_projects: number; storage_used: number; ready_for_cleanup: number; failed_jobs: number; last_cleanup: string | null }
export type ArchiveFile = { relative_path: string; name: string; size_bytes: number; checksum: string; mime_type: string; source_file_id: string | null }
export type ArchiveDetail = ArchiveSummary & { version: number; meta: Record<string, unknown>; files: ArchiveFile[] }
export type ArchiveJob = { id: string; archive_id: string; action: string; status: string; progress: number; started_at: string | null; finished_at: string | null; error: string; created_at: string }
export type AgentTransactionArchiveInput = { agent_membership_id: string; from_date: string; to_date: string; transaction_type?: string; project_id?: string }

export type AuditEvent = {
  id: string
  event: string
  entity: string
  entity_id: string
  project_id: string | null
  customer_id: string | null
  user_id: string | null
  user_role: string
  changes: Record<string, unknown>
  request_id: string
  created_at: string
}
export type AuditEventList = { data: AuditEvent[]; page: number; page_size: number; total: number }


export type DocumentCustomerOption = {
  id: string
  customer_name: string
  project_id: string | null
  project_number: string | null
  project_status: string | null
}

export type StoredFile = {
  id: string
  owner_type: string
  owner_id: string
  project_id: string | null
  customer_id: string | null
  name: string
  mime_type: string
  size_bytes: number
  checksum: string
  status: 'active' | 'archived' | 'deleted'
  created_at: string
  archived_at: string | null
}
export type StoredFileList = { data: StoredFile[]; page: number; page_size: number; total: number }
