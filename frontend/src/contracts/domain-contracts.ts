import type {
  ArchiveMetadata,
  DecimalString,
  RecordNumber,
  UUID,
  UTCTimestamp,
  VersionedRecord,
} from './api-contracts'

export type EntityBase = ArchiveMetadata & VersionedRecord & {
  id: UUID
  record_number: RecordNumber
}

export type Address = {
  id: UUID
  label: string
  line_1: string
  line_2: string
  city: string
  district: string
  state: string
  postal_code: string
  country_code: string
  is_primary: boolean
}

export type CustomerContact = {
  id: UUID
  full_name: string
  designation: string
  email: string
  phone: string
  alternate_phone: string
  is_primary: boolean
}

export type CustomerStatus = 'lead' | 'qualified' | 'active' | 'on_hold' | 'completed'

export type Customer = EntityBase & {
  display_name: string
  legal_name: string
  customer_type: 'individual' | 'business'
  status: CustomerStatus
  primary_contact_id: UUID | null
  contacts: CustomerContact[]
  addresses: Address[]
  assigned_agent_id: UUID | null
}

export type SiteStatus = 'survey_pending' | 'surveyed' | 'quotation_ready' | 'approved' | 'converted'

export type CustomerSite = EntityBase & {
  customer_id: UUID
  name: string
  address: Address
  consumer_number: string
  meter_type: 'single_phase' | 'three_phase' | 'unknown'
  sanctioned_load_kw: DecimalString
  proposed_capacity_kw: DecimalString
  status: SiteStatus
  survey_scheduled_at: UTCTimestamp | null
}

export type QuotationStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'rejected' | 'expired'

export type QuotationLine = {
  id: UUID
  description: string
  quantity: DecimalString
  unit: string
  unit_price: DecimalString
  tax_rate: DecimalString
  line_total: DecimalString
}

export type ApprovalDecision = 'approved' | 'rejected' | 'changes_requested'

export type QuotationApproval = {
  id: UUID
  decision: ApprovalDecision
  decided_by: UUID
  decided_at: UTCTimestamp
  comment: string
}

export type QuotationRevision = EntityBase & {
  quotation_id: UUID
  revision_number: number
  status: QuotationStatus
  valid_until: UTCTimestamp | null
  subtotal: DecimalString
  tax_total: DecimalString
  grand_total: DecimalString
  notes: string
  lines: QuotationLine[]
  approval: QuotationApproval | null
}

export type Quotation = EntityBase & {
  customer_id: UUID
  site_id: UUID
  title: string
  current_revision_id: UUID
  revisions: QuotationRevision[]
}

export type ProjectStatus = 'planning' | 'procurement' | 'installation' | 'commissioning' | 'completed' | 'on_hold'

export type Project = EntityBase & {
  customer_id: UUID
  site_id: UUID
  quotation_id: UUID
  name: string
  status: ProjectStatus
  capacity_kw: DecimalString
  approved_value: DecimalString
  planned_start_date: string | null
  target_completion_date: string | null
  project_manager_id: UUID | null
}

export type MaterialRequestStatus = 'draft' | 'submitted' | 'approved' | 'issued' | 'cancelled'

export type MaterialRequestLine = {
  id: UUID
  item_id: UUID | null
  description: string
  requested_quantity: DecimalString
  unit: string
  required_by: string | null
  note: string
}

export type MaterialRequest = EntityBase & {
  project_id: UUID
  status: MaterialRequestStatus
  requested_by: UUID
  needed_at_site_by: string | null
  purpose: string
  lines: MaterialRequestLine[]
}

export type CustomerFlowSnapshot = {
  customer: Customer
  sites: CustomerSite[]
  quotations: Quotation[]
  project: Project | null
  material_request: MaterialRequest | null
}
