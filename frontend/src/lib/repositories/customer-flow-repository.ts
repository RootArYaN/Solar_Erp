import type { PaginatedList, UUID } from '../../contracts/api-contracts'
import type {
  Customer,
  CustomerFlowSnapshot,
  MaterialRequest,
} from '../../contracts/domain-contracts'
import { apiRequest } from '../../api/client'
import { createClientId } from '../client-id'

export type CustomerFlowRepository = {
  listCustomers(cursor?: string | null): Promise<PaginatedList<Customer>>
  getSnapshot(customerId: UUID): Promise<CustomerFlowSnapshot>
  updateCustomer(customerId: UUID, input: Record<string, unknown>): Promise<CustomerFlowSnapshot>
  approveQuotation(customerId: UUID, quotationId: UUID, comment: string): Promise<CustomerFlowSnapshot>
  saveMaterialRequest(customerId: UUID, input: Pick<MaterialRequest, 'purpose' | 'needed_at_site_by' | 'lines'>): Promise<CustomerFlowSnapshot>
}

export function createCustomerFlowRepository(token?: string): CustomerFlowRepository {
  const options = token ? { token } : {}

  return {
    listCustomers() {
      return apiRequest<PaginatedList<Customer>>('/customer-flow/customers', options)
    },
    getSnapshot(customerId) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${customerId}`, options)
    },
    updateCustomer(customerId, input) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${customerId}`, { ...options, method: 'PATCH', body: input })
    },
    async approveQuotation(customerId, quotationId, comment) {
      await apiRequest(`/workflow/quotations/${quotationId}/decision`, {
        ...options,
        method: 'POST',
        body: { decision: 'approved', comment },
        idempotencyKey: createClientId(),
      })
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${customerId}`, options)
    },
    saveMaterialRequest(customerId, input) {
      return apiRequest<CustomerFlowSnapshot>(`/customer-flow/customers/${customerId}/material-request`, {
        ...options,
        method: 'PUT',
        body: input,
      })
    },
  }
}
