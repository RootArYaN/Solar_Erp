import type { DocumentCustomerOption, StoredFile, StoredFileList } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, downloadRequest } from './client'

export async function uploadStoredFile(input: { file: File; ownerType: string; ownerId: string; projectId?: string; customerId?: string }): Promise<StoredFile> {
  const body = new FormData()
  body.set('upload', input.file)
  body.set('owner_type', input.ownerType)
  body.set('owner_id', input.ownerId)
  if (input.projectId) body.set('project_id', input.projectId)
  if (input.customerId) body.set('customer_id', input.customerId)
  return apiRequest('/files', { method: 'POST', body, idempotencyKey: createClientId() })
}
export const getStoredFiles = (ownerType: string, ownerId: string): Promise<StoredFileList> => apiRequest(`/files?owner_type=${encodeURIComponent(ownerType)}&owner_id=${encodeURIComponent(ownerId)}&page_size=100`)
export const setStoredFileStatus = (id: string, status: 'active' | 'archived' | 'deleted'): Promise<StoredFile> => apiRequest(`/files/${id}/status`, { method: 'PATCH', body: { status } })
export const removeStoredFile = (id: string): Promise<StoredFile> => setStoredFileStatus(id, 'deleted')
export const downloadStoredFile = (id: string, name: string) => downloadRequest(`/files/${id}/download`, name)

export const getDocumentCustomerOptions = (): Promise<DocumentCustomerOption[]> => apiRequest('/files/customer-options')
