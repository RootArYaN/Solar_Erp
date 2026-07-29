import type { PaginatedList, UUID } from '../../contracts/api-contracts'
import type {
  Customer,
  CustomerFlowSnapshot,
  MaterialRequest,
} from '../../contracts/domain-contracts'
import { apiRequest, apiSegment } from '../../api/client'
import { createClientId } from '../client-id'

export type CustomerFlowRepository = {
  listCustomers(cursor?: string | null): Promise<PaginatedList<Customer>>
  getSnapshot(customerId: UUID): Promise<CustomerFlowSnapshot>
  updateCustomer(customerId: UUID, input: Record<string, unknown>): Promise<CustomerFlowSnapshot>
  approveQuotation(customerId: UUID, quotationId: UUID, comment: string): Promise<CustomerFlowSnapshot>
  saveMaterialRequest(customerId: UUID, input: Pick<MaterialRequest, 'purpose' | 'needed_at_site_by' | 'lines'>): Promise<CustomerFlowSnapshot>
}

export function createCustomerFlowRepository(): CustomerFlowRepository {
  return {
    listCustomers(cursor) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      return apiRequest<PaginatedList<Customer>>(`/customer-flow/customers${query}`)
    },
    getSnapshot(customerId) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${apiSegment(customerId)}`)
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
  }
}
