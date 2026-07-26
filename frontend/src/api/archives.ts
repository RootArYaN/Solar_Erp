import type { AgentTransactionArchiveInput, ArchiveDetail, ArchiveJob, ArchiveKpis, ArchiveList, AuditEventList } from '../types'
import { apiRequest, downloadRequest } from './client'

function query(params: Record<string, string | number | undefined>): string {
  const value = new URLSearchParams()
  Object.entries(params).forEach(([key, item]) => { if (item !== undefined && item !== '') value.set(key, String(item)) })
  const result = value.toString()
  return result ? `?${result}` : ''
}

export const getArchives = (params: { page?: number; page_size?: number; type?: string; status?: string; search?: string } = {}): Promise<ArchiveList> => apiRequest(`/archives${query(params)}`)
export const getArchiveKpis = (): Promise<ArchiveKpis> => apiRequest('/archives/kpis')
export const getArchive = (id: string): Promise<ArchiveDetail> => apiRequest(`/archives/${id}`)
export const createProjectArchive = (id: string): Promise<ArchiveJob> => apiRequest(`/archives/projects/${id}`, { method: 'POST', idempotencyKey: crypto.randomUUID() })
export const createCustomerArchive = (id: string): Promise<ArchiveJob> => apiRequest(`/archives/customers/${id}`, { method: 'POST', idempotencyKey: crypto.randomUUID() })
export const createAgentTransactionArchive = (input: AgentTransactionArchiveInput): Promise<ArchiveJob> => apiRequest('/archives/agent-transactions', { method: 'POST', body: input, idempotencyKey: crypto.randomUUID() })
export const verifyArchive = (id: string): Promise<ArchiveJob> => apiRequest(`/archives/${id}/verify`, { method: 'POST', idempotencyKey: crypto.randomUUID() })
export const cleanArchive = (id: string, force = false): Promise<ArchiveJob> => apiRequest(`/archives/${id}/cleanup`, { method: 'POST', body: { force }, idempotencyKey: crypto.randomUUID() })
export const restoreArchive = (id: string): Promise<ArchiveJob> => apiRequest(`/archives/${id}/restore`, { method: 'POST', idempotencyKey: crypto.randomUUID() })
export const purgeArchive = (id: string, confirmation: string, reason: string): Promise<ArchiveJob> => apiRequest(`/archives/${id}/purge`, { method: 'POST', body: { confirmation, reason }, idempotencyKey: crypto.randomUUID() })
export const getArchiveJob = (id: string): Promise<ArchiveJob> => apiRequest(`/archive-jobs/${id}`)
export const downloadArchive = (id: string, name: string) => downloadRequest(`/archives/${id}/download`, name)
export const getAuditEvents = (params: { page?: number; page_size?: number; project_id?: string; customer_id?: string; entity?: string; event?: string } = {}): Promise<AuditEventList> => apiRequest(`/events${query(params)}`)
