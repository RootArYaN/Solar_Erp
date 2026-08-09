import type { PaginatedList, UUID } from '../../contracts/api-contracts'
import type {
  Customer,
  CustomerFlowSnapshot,
  MaterialRequest,
} from '../../contracts/domain-contracts'
import { apiRequest, apiSegment } from '../../api/client'
import { createClientId } from '../client-id'

export type CustomerListOptions = { page?: number; pageSize?: number; status?: string; query?: string; paymentMode?: string }

export type CustomerDependencyPreview = {
  customer_id: UUID
  customer_name: string
  status: string
  outstanding_balance: string
  projects: number
  open_projects: number
  quotation_requests: number
  quotations: number
  finance_transactions: number
  posted_finance_transactions: number
  bills: number
  open_bills: number
  inventory_movements: number
  documents: number
  audit_events: number
  can_complete: boolean
  completion_blockers: string[]
  can_purge: boolean
  purge_blockers: string[]
}

export type CustomerFlowRepository = {
  listCustomers(options?: CustomerListOptions): Promise<PaginatedList<Customer>>
  getSnapshot(customerId: UUID, sections?: string[]): Promise<CustomerFlowSnapshot>
  updateCustomer(customerId: UUID, input: Record<string, unknown>): Promise<CustomerFlowSnapshot>
  approveQuotation(customerId: UUID, quotationId: UUID, comment: string): Promise<CustomerFlowSnapshot>
  saveMaterialRequest(customerId: UUID, input: Pick<MaterialRequest, 'purpose' | 'needed_at_site_by' | 'lines'>): Promise<CustomerFlowSnapshot>
  getDependencyPreview(customerId: UUID): Promise<CustomerDependencyPreview>
  completeCustomer(customerId: UUID, reason?: string, force?: boolean): Promise<CustomerFlowSnapshot>
  reactivateCustomer(customerId: UUID, reason?: string): Promise<CustomerFlowSnapshot>
  archiveCustomer(customerId: UUID, reason: string): Promise<CustomerDependencyPreview>
  deleteCustomer(customerId: UUID, reason: string): Promise<CustomerDependencyPreview>
  restoreCustomer(customerId: UUID, reason?: string): Promise<CustomerFlowSnapshot>
  purgeCustomer(customerId: UUID, reason: string): Promise<void>
}

export function createCustomerFlowRepository(): CustomerFlowRepository {
  return {
    listCustomers(options = {}) {
      const params = new URLSearchParams()
      params.set('page', String(options.page ?? 1))
      params.set('page_size', String(options.pageSize ?? 50))
      if (options.status) params.set('status', options.status)
      if (options.query?.trim()) params.set('query', options.query.trim())
      if (options.paymentMode && options.paymentMode !== 'all') params.set('payment_mode', options.paymentMode)
      return apiRequest<PaginatedList<Customer>>(`/customer-flow/customers?${params.toString()}`)
    },
    getSnapshot(customerId, sections = ['overview']) {
      const params = new URLSearchParams({ sections: sections.join(',') })
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}?${params.toString()}`)
    },
    updateCustomer(customerId, input) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}`, { method: 'PATCH', body: input })
    },
    async approveQuotation(customerId, quotationId, comment) {
      await apiRequest(`/workflow/quotations/${apiSegment(quotationId)}/decision`, {
        method: 'POST',
        body: { decision: 'approved', comment },
        idempotencyKey: createClientId(),
      })
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}`)
    },
    saveMaterialRequest(customerId, input) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}/material-request`, {
        method: 'PUT',
        body: input,
      })
    },
    getDependencyPreview(customerId) {
      return apiRequest<CustomerDependencyPreview>(`/customer-flow/customers/${apiSegment(customerId)}/dependency-preview`)
    },
    completeCustomer(customerId, reason = '', force = false) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}/complete`, { method: 'POST', body: { reason, force } })
    },
    reactivateCustomer(customerId, reason = '') {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}/reactivate`, { method: 'POST', body: { reason } })
    },
    archiveCustomer(customerId, reason) {
      return apiRequest<CustomerDependencyPreview>(`/customer-flow/customers/${apiSegment(customerId)}/archive`, { method: 'POST', body: { reason } })
    },
    deleteCustomer(customerId, reason) {
      return apiRequest<CustomerDependencyPreview>(`/customer-flow/customers/${apiSegment(customerId)}`, { method: 'DELETE', body: { reason } })
    },
    restoreCustomer(customerId, reason = '') {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}/restore`, { method: 'POST', body: { reason } })
    },
    purgeCustomer(customerId, reason) {
      return apiRequest<void>(`/customer-flow/customers/${apiSegment(customerId)}/purge`, { method: 'DELETE', body: { reason } })
    },
  }
}
