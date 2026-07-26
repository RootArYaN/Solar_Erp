import type { ApprovalCenter, ApprovalDecisionInput, CreateQuotationRequestInput, GenerateQuotationInput, ProjectTimeline, ProjectTimelineListItem, ProjectTimelineStepInput } from '../types'
import { apiRequest } from './client'

export const createQuotationRequest = (token: string, customerId: string, input: CreateQuotationRequestInput) => apiRequest(`/workflow/customers/${customerId}/quotation-requests`, { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() })
export const getApprovalCenter = (token: string): Promise<ApprovalCenter> => apiRequest('/workflow/approvals', { token })
export const generateQuotation = (token: string, id: string, input: GenerateQuotationInput) => apiRequest(`/workflow/quotation-requests/${id}/quotation`, { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() })
export const decideQuotation = (token: string, id: string, input: ApprovalDecisionInput) => apiRequest(`/workflow/quotations/${id}/decision`, { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() })
export const decideTransaction = (token: string, id: string, input: ApprovalDecisionInput) => apiRequest(`/workflow/transactions/${id}/decision`, { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() })
export const getProjectTimelines = (token: string): Promise<ProjectTimelineListItem[]> => apiRequest('/workflow/projects/timelines', { token })
export const getProjectTimeline = (token: string, id: string): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${id}/timeline`, { token })
export const setProjectPaymentMode = (token: string, id: string, mode: 'cash' | 'loan'): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${id}/payment-mode`, { method: 'PATCH', token, body: { payment_mode: mode } })
export const updateProjectTimelineStep = (token: string, id: string, step: string, input: ProjectTimelineStepInput): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${id}/timeline/${step}`, { method: 'PATCH', token, body: input })
