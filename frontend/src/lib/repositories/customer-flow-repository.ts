import type { PaginatedList, UUID } from '../../contracts/api-contracts'
import type {
  Customer,
  CustomerFlowSnapshot,
  MaterialRequest,
  Project,
  Quotation,
  QuotationApproval,
} from '../../contracts/domain-contracts'

export type CustomerFlowRepository = {
  listCustomers(cursor?: string | null): Promise<PaginatedList<Customer>>
  getSnapshot(customerId: UUID): Promise<CustomerFlowSnapshot>
  approveQuotation(customerId: UUID, quotationId: UUID, comment: string): Promise<CustomerFlowSnapshot>
  createProject(customerId: UUID, quotationId: UUID): Promise<CustomerFlowSnapshot>
  saveMaterialRequest(customerId: UUID, input: Pick<MaterialRequest, 'purpose' | 'needed_at_site_by' | 'lines'>): Promise<CustomerFlowSnapshot>
  archiveCustomer(customerId: UUID, reason: string): Promise<CustomerFlowSnapshot>
  restoreCustomer(customerId: UUID): Promise<CustomerFlowSnapshot>
}

const CURRENT_USER_ID: UUID = '00000000-0000-4000-8000-000000000001'
const now = new Date().toISOString()
const baseVersion = { version: 1, created_at: now, updated_at: now, archived_at: null, archived_by: null, archive_reason: null }

const customers: Customer[] = [
  {
    ...baseVersion,
    id: '1c0d94a4-5dc4-41aa-9c24-c468d20a0001',
    record_number: 'CUS-2026-0001',
    display_name: 'Rakesh Patel',
    legal_name: 'Rakesh Patel',
    customer_type: 'individual',
    status: 'qualified',
    primary_contact_id: '4e026de9-b277-42c0-a820-602525440001',
    assigned_agent_id: null,
    contacts: [{
      id: '4e026de9-b277-42c0-a820-602525440001',
      full_name: 'Rakesh Patel',
      designation: 'Owner',
      email: 'rakesh@example.com',
      phone: '+91 98765 43210',
      alternate_phone: '',
      is_primary: true,
    }],
    addresses: [{
      id: '7ee13f57-812f-49e1-87a4-7bdabf820001',
      label: 'Home', line_1: '18 Shantivan Society', line_2: 'Vesu', city: 'Surat', district: 'Surat', state: 'Gujarat', postal_code: '395007', country_code: 'IN', is_primary: true,
    }],
  },
  {
    ...baseVersion,
    id: '1c0d94a4-5dc4-41aa-9c24-c468d20a0002',
    record_number: 'CUS-2026-0002',
    display_name: 'Meridian Textiles',
    legal_name: 'Meridian Textiles Private Limited',
    customer_type: 'business',
    status: 'lead',
    primary_contact_id: '4e026de9-b277-42c0-a820-602525440002',
    assigned_agent_id: null,
    contacts: [{
      id: '4e026de9-b277-42c0-a820-602525440002',
      full_name: 'Nirav Shah', designation: 'Operations Head', email: 'nirav@meridian.example', phone: '+91 98250 12345', alternate_phone: '', is_primary: true,
    }],
    addresses: [{
      id: '7ee13f57-812f-49e1-87a4-7bdabf820002', label: 'Registered office', line_1: 'Plot 42, GIDC', line_2: 'Sachin', city: 'Surat', district: 'Surat', state: 'Gujarat', postal_code: '394230', country_code: 'IN', is_primary: true,
    }],
  },
]

const snapshots = new Map<UUID, CustomerFlowSnapshot>()

function seedSnapshot(customer: Customer): CustomerFlowSnapshot {
  const siteId = `${customer.id.slice(0, 32)}1001`
  const quotationId = `${customer.id.slice(0, 32)}2001`
  const revisionId = `${customer.id.slice(0, 32)}3001`
  const site = {
    ...baseVersion,
    id: siteId,
    record_number: `SITE-${customer.record_number.slice(-4)}`,
    customer_id: customer.id,
    name: customer.customer_type === 'business' ? 'Factory rooftop' : 'Residence rooftop',
    address: customer.addresses[0],
    consumer_number: customer.customer_type === 'business' ? 'HT-228194' : 'LT-491284',
    meter_type: customer.customer_type === 'business' ? 'three_phase' as const : 'single_phase' as const,
    sanctioned_load_kw: customer.customer_type === 'business' ? '75.00' : '8.00',
    proposed_capacity_kw: customer.customer_type === 'business' ? '50.00' : '6.00',
    status: customer.customer_type === 'business' ? 'survey_pending' as const : 'quotation_ready' as const,
    survey_scheduled_at: null,
  }
  const quotation: Quotation = {
    ...baseVersion,
    id: quotationId,
    record_number: `QUO-2026-${customer.record_number.slice(-4)}`,
    customer_id: customer.id,
    site_id: site.id,
    title: `${site.proposed_capacity_kw} kW rooftop solar EPC`,
    current_revision_id: revisionId,
    revisions: [{
      ...baseVersion,
      id: revisionId,
      record_number: `QR-${customer.record_number.slice(-4)}-R1`,
      quotation_id: quotationId,
      revision_number: 1,
      status: customer.customer_type === 'business' ? 'draft' : 'submitted',
      valid_until: '2026-08-31T18:29:59Z',
      subtotal: customer.customer_type === 'business' ? '2280000.00' : '318095.24',
      tax_total: customer.customer_type === 'business' ? '112000.00' : '15904.76',
      grand_total: customer.customer_type === 'business' ? '2392000.00' : '334000.00',
      notes: 'Includes supply, installation, testing and commissioning.',
      approval: null,
      lines: [
        { id: crypto.randomUUID(), description: 'Solar modules and inverter package', quantity: '1.00', unit: 'Lot', unit_price: customer.customer_type === 'business' ? '2010000.00' : '280000.00', tax_rate: '5.00', line_total: customer.customer_type === 'business' ? '2110500.00' : '294000.00' },
        { id: crypto.randomUUID(), description: 'Installation and commissioning', quantity: '1.00', unit: 'Lot', unit_price: customer.customer_type === 'business' ? '270000.00' : '38095.24', tax_rate: '18.00', line_total: customer.customer_type === 'business' ? '318600.00' : '44952.38' },
      ],
    }],
  }
  return { customer, sites: [site], quotations: [quotation], project: null, material_request: null }
}

customers.forEach((customer) => snapshots.set(customer.id, seedSnapshot(customer)))

function copy<T>(value: T): T {
  return structuredClone(value)
}

async function pause(): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 180))
}

export function createCustomerFlowRepository(): CustomerFlowRepository {
  return {
    async listCustomers() {
      await pause()
      return { items: copy(customers), next_cursor: null, sync_cursor: 'customer-flow-seed-v1' }
    },
    async getSnapshot(customerId) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot) throw new Error('Customer record was not found')
      return copy(snapshot)
    },
    async approveQuotation(customerId, quotationId, comment) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot) throw new Error('Customer record was not found')
      const quotation = snapshot.quotations.find((item) => item.id === quotationId)
      const revision = quotation?.revisions.find((item) => item.id === quotation.current_revision_id)
      if (!quotation || !revision) throw new Error('Quotation was not found')
      const approval: QuotationApproval = { id: crypto.randomUUID(), decision: 'approved', decided_by: CURRENT_USER_ID, decided_at: new Date().toISOString(), comment }
      revision.status = 'approved'
      revision.approval = approval
      revision.version += 1
      revision.updated_at = new Date().toISOString()
      snapshot.customer.status = 'active'
      return copy(snapshot)
    },
    async createProject(customerId, quotationId) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot) throw new Error('Customer record was not found')
      const quotation = snapshot.quotations.find((item) => item.id === quotationId)
      const revision = quotation?.revisions.find((item) => item.id === quotation.current_revision_id)
      const site = snapshot.sites.find((item) => item.id === quotation?.site_id)
      if (!quotation || !revision || !site) throw new Error('Approved quotation and site are required')
      if (revision.status !== 'approved') throw new Error('Approve the quotation before creating a project')
      const project: Project = {
        ...baseVersion,
        id: crypto.randomUUID(), record_number: `PRJ-2026-${snapshot.customer.record_number.slice(-4)}`,
        customer_id: customerId, site_id: site.id, quotation_id: quotationId,
        name: `${snapshot.customer.display_name} · ${site.proposed_capacity_kw} kW`, status: 'planning',
        capacity_kw: site.proposed_capacity_kw, approved_value: revision.grand_total,
        planned_start_date: null, target_completion_date: null, project_manager_id: null,
      }
      snapshot.project = project
      site.status = 'converted'
      return copy(snapshot)
    },
    async saveMaterialRequest(customerId, input) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot?.project) throw new Error('Create the project before drafting a material request')
      const existing = snapshot.material_request
      snapshot.material_request = {
        ...baseVersion,
        id: existing?.id ?? crypto.randomUUID(),
        record_number: existing?.record_number ?? `MR-2026-${snapshot.customer.record_number.slice(-4)}`,
        version: (existing?.version ?? 0) + 1,
        created_at: existing?.created_at ?? now,
        updated_at: new Date().toISOString(),
        project_id: snapshot.project.id,
        status: 'draft', requested_by: CURRENT_USER_ID,
        purpose: input.purpose, needed_at_site_by: input.needed_at_site_by, lines: input.lines,
      }
      return copy(snapshot)
    },
    async archiveCustomer(customerId, reason) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot) throw new Error('Customer record was not found')
      snapshot.customer.archived_at = new Date().toISOString()
      snapshot.customer.archived_by = CURRENT_USER_ID
      snapshot.customer.archive_reason = reason
      return copy(snapshot)
    },
    async restoreCustomer(customerId) {
      await pause()
      const snapshot = snapshots.get(customerId)
      if (!snapshot) throw new Error('Customer record was not found')
      snapshot.customer.archived_at = null
      snapshot.customer.archived_by = null
      snapshot.customer.archive_reason = null
      return copy(snapshot)
    },
  }
}
