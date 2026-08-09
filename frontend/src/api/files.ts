import type { StoredFile, StoredFileList } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment, blobRequest, downloadRequest } from './client'

export async function uploadStoredFile(input: { file: File; ownerType: string; ownerId: string; projectId?: string; customerId?: string }): Promise<StoredFile> {
  const body = new FormData()
  body.set('upload', input.file)
  body.set('owner_type', input.ownerType)
  body.set('owner_id', input.ownerId)
  if (input.projectId) body.set('project_id', input.projectId)
  if (input.customerId) body.set('customer_id', input.customerId)
  return apiRequest('/files', { method: 'POST', body, idempotencyKey: createClientId() })
}

export const getStoredFiles = (ownerType: string, ownerId: string): Promise<StoredFileList> => {
  const query = new URLSearchParams({ owner_type: ownerType, owner_id: ownerId, page_size: '100' })
  return apiRequest(`/files?${query.toString()}`)
}

export const removeStoredFile = (id: string): Promise<void> => apiRequest(`/files/${apiSegment(id)}`, { method: 'DELETE', idempotencyKey: createClientId() })
export const downloadStoredFile = (id: string, name: string) => downloadRequest(`/files/${apiSegment(id)}/download`, name)
export const getStoredFileBlob = (id: string): Promise<Blob> => blobRequest(`/files/${apiSegment(id)}/download`)
