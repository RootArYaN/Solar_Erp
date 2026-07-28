import type { DocumentTemplate, GeneratedDocumentPack, InventoryItem, InventoryLocation, InventoryMovement, InventorySummary, Poster, PricingBook } from '../erp-types'
import { createClientId } from '../lib/client-id'
import { apiRequest } from './client'

export const getInventorySummary = (): Promise<InventorySummary> => apiRequest('/inventory/summary')
export const createInventoryLocation = (body: Record<string, unknown>): Promise<InventoryLocation> => apiRequest('/inventory/locations', { method: 'POST', body })
export const createInventoryItem = (body: Record<string, unknown>): Promise<InventoryItem> => apiRequest('/inventory/items', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateInventoryItem = (id: string, body: Record<string, unknown>): Promise<InventoryItem> => apiRequest(`/inventory/items/${id}`, { method: 'PATCH', body })
export const updateInventoryLocation = (id: string, body: Record<string, unknown>): Promise<InventoryLocation> => apiRequest(`/inventory/locations/${id}`, { method: 'PATCH', body })
export const createInventoryMovement = (body: Record<string, unknown>): Promise<InventoryMovement> => apiRequest('/inventory/movements', { method: 'POST', body, idempotencyKey: createClientId() })
export const getPricingBook = (): Promise<PricingBook> => apiRequest('/pricing')
export const savePricingBook = (body: Record<string, unknown>): Promise<PricingBook> => apiRequest('/pricing', { method: 'PUT', body })
export const getPosters = (status?: string): Promise<Poster[]> => apiRequest(`/posters${status ? `?status=${encodeURIComponent(status)}` : ''}`)
export const createPoster = (body: Record<string, unknown>): Promise<Poster> => apiRequest('/posters', { method: 'POST', body, idempotencyKey: createClientId() })
export const updatePoster = (id: string, body: Record<string, unknown>): Promise<Poster> => apiRequest(`/posters/${id}`, { method: 'PATCH', body })
export const setPosterStatus = (id: string, status: Poster['status']): Promise<Poster> => apiRequest(`/posters/${id}/status`, { method: 'PATCH', body: { status } })
export const getDocumentTemplate = (type = 'customer_pack'): Promise<DocumentTemplate> => apiRequest(`/document-templates/${type}`)
export const saveDocumentTemplate = (type: string, body: Record<string, unknown>): Promise<DocumentTemplate> => apiRequest(`/document-templates/${type}`, { method: 'PUT', body })

export const getGeneratedDocumentPacks = (customerId: string): Promise<GeneratedDocumentPack[]> => apiRequest(`/document-packs/customer/${customerId}`)
export const saveGeneratedDocumentPack = (customerId: string, body: { input_snapshot: Record<string, unknown>; status: 'draft' | 'generated' }): Promise<GeneratedDocumentPack> => apiRequest(`/document-packs/customer/${customerId}`, { method: 'PUT', body })
export const finalizeGeneratedDocumentPack = (packId: string): Promise<GeneratedDocumentPack> => apiRequest(`/document-packs/${packId}/finalize`, { method: 'POST' })
