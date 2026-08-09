import type { PaginatedList } from '../contracts/api-contracts'
import type { Customer } from '../contracts/domain-contracts'
import type { InventoryMovement } from '../erp-types'
import type { AuditEventList } from '../types'
import { apiRequest, apiSegment } from './client'

export type InventoryMovementList = { data: InventoryMovement[]; page: number; page_size: number; total: number }

export function getDeletedCustomers(query = '', page = 1, pageSize = 50): Promise<PaginatedList<Customer>> {
  const params = new URLSearchParams({ status: 'deleted', page: String(page), page_size: String(pageSize) })
  if (query.trim()) params.set('query', query.trim())
  return apiRequest(`/customer-flow/customers?${params.toString()}`)
}

export function restoreDeletedCustomer(customerId: string, reason = ''): Promise<unknown> {
  return apiRequest(`/customer-flow/customers/${apiSegment(customerId)}/restore`, { method: 'POST', body: { reason } })
}

export function purgeDeletedCustomer(customerId: string, reason: string): Promise<void> {
  return apiRequest(`/customer-flow/customers/${apiSegment(customerId)}/purge`, { method: 'DELETE', body: { reason } })
}

export function getInventoryMovementHistory(status: 'corrected' | 'reversed', page = 1, pageSize = 50): Promise<InventoryMovementList> {
  const params = new URLSearchParams({ status, page: String(page), page_size: String(pageSize) })
  return apiRequest(`/inventory/movements?${params.toString()}`)
}

export function getAuditHistory(query = '', page = 1, pageSize = 50): Promise<AuditEventList> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  if (query.trim()) params.set('query', query.trim())
  return apiRequest(`/events?${params.toString()}`)
}

export type DataHealthCheck = { key: string; label: string; severity: 'ok' | 'warning' | 'critical' | string; count: number; description: string; sample_ids: string[] }
export type DataHealthSummary = { generated_at: string; issue_count: number; checks: DataHealthCheck[] }
export function getDataHealth(): Promise<DataHealthSummary> {
  return apiRequest('/admin/data-health')
}
