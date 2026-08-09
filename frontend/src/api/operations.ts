import type { DocumentTemplate, GeneratedDocumentPack, InventoryItem, InventoryLocation, InventoryMovement, InventorySummary, Poster, PricingBook } from '../erp-types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment, downloadRequest } from './client'

export const getInventorySummary = (options: { page?: number; pageSize?: number; query?: string; category?: string } = {}): Promise<InventorySummary> => {
  const params = new URLSearchParams({
    movement_limit: '0',
    item_page: String(options.page ?? 1),
    item_page_size: String(options.pageSize ?? 50),
  })
  if (options.query?.trim()) params.set('item_q', options.query.trim())
  if (options.category?.trim()) params.set('item_category', options.category.trim())
  return apiRequest(`/inventory/summary?${params.toString()}`)
}
export const createInventoryLocation = (body: Record<string, unknown>): Promise<InventoryLocation> => apiRequest('/inventory/locations', { method: 'POST', body, idempotencyKey: createClientId() })
export const createInventoryItem = (body: Record<string, unknown>): Promise<InventoryItem> => apiRequest('/inventory/items', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateInventoryItem = (id: string, body: Record<string, unknown>): Promise<InventoryItem> => apiRequest(`/inventory/items/${apiSegment(id)}`, { method: 'PATCH', body })
export const updateInventoryLocation = (id: string, body: Record<string, unknown>): Promise<InventoryLocation> => apiRequest(`/inventory/locations/${apiSegment(id)}`, { method: 'PATCH', body })
export const createInventoryMovementBatch = (body: Record<string, unknown>): Promise<InventoryMovement[]> => apiRequest('/inventory/movement-batches', { method: 'POST', body, idempotencyKey: createClientId() })

export type InventoryMovementList = { data: InventoryMovement[]; page: number; page_size: number; total: number }
export const getInventoryMovements = (options: { movementType?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<InventoryMovementList> => {
  const params = new URLSearchParams({ page: String(options.page ?? 1), page_size: String(options.pageSize ?? 50) })
  if (options.movementType) params.set('movement_type', options.movementType)
  if (options.status) params.set('status', options.status)
  return apiRequest(`/inventory/movements?${params.toString()}`)
}
export const reverseInventoryMovement = (id: string, reason: string): Promise<InventoryMovement> => apiRequest(`/inventory/movements/${apiSegment(id)}/reverse`, { method: 'POST', body: { reason } })
export const correctInventoryMovement = (id: string, quantity: number, reason: string): Promise<InventoryMovement> => apiRequest(`/inventory/movements/${apiSegment(id)}/correct`, { method: 'POST', body: { quantity, reason } })
export const getPricingBook = (): Promise<PricingBook> => apiRequest('/pricing')
export const savePricingBook = (body: Record<string, unknown>): Promise<PricingBook> => apiRequest('/pricing', { method: 'PUT', body })
export const getPosters = (status?: string): Promise<Poster[]> => apiRequest(`/posters${status ? `?status=${encodeURIComponent(status)}` : ''}`)
export const createPoster = (body: Record<string, unknown>): Promise<Poster> => apiRequest('/posters', { method: 'POST', body, idempotencyKey: createClientId() })
export const updatePoster = (id: string, body: Record<string, unknown>): Promise<Poster> => apiRequest(`/posters/${apiSegment(id)}`, { method: 'PATCH', body })
export const setPosterStatus = (id: string, status: Poster['status']): Promise<Poster> => apiRequest(`/posters/${apiSegment(id)}/status`, { method: 'PATCH', body: { status } })
export const getDocumentTemplate = (type = 'customer_pack'): Promise<DocumentTemplate> => apiRequest(`/document-templates/${apiSegment(type)}`)
export const saveDocumentTemplate = (type: string, body: Record<string, unknown>): Promise<DocumentTemplate> => apiRequest(`/document-templates/${apiSegment(type)}`, { method: 'PUT', body })

export const getGeneratedDocumentPacks = (customerId: string): Promise<GeneratedDocumentPack[]> => apiRequest(`/document-packs/customer/${apiSegment(customerId)}`)
export const saveGeneratedDocumentPack = (customerId: string, body: { input_snapshot: Record<string, unknown>; status: 'draft' | 'generated' }): Promise<GeneratedDocumentPack> => apiRequest(`/document-packs/customer/${apiSegment(customerId)}`, { method: 'PUT', body })
export const finalizeGeneratedDocumentPack = (packId: string): Promise<GeneratedDocumentPack> => apiRequest(`/document-packs/${apiSegment(packId)}/finalize`, { method: 'POST', idempotencyKey: createClientId() })
export const downloadMergedDocumentPack = (packId: string, fallbackName: string): Promise<void> => downloadRequest(`/document-packs/${apiSegment(packId)}/merged-download`, fallbackName)
