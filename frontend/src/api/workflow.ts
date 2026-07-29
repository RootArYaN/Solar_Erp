import type { ApprovalCenter, ApprovalDecisionInput, CreateQuotationRequestInput, GenerateQuotationInput, ProjectTimeline, ProjectTimelineListItem, ProjectTimelineStepInput } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment } from './client'

export const createQuotationRequest = (customerId: string, input: CreateQuotationRequestInput) => apiRequest(`/workflow/customers/${apiSegment(customerId)}/quotation-requests`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const getApprovalCenter = (): Promise<ApprovalCenter> => apiRequest('/workflow/approvals')
export const generateQuotation = (id: string, input: GenerateQuotationInput) => apiRequest(`/workflow/quotation-requests/${apiSegment(id)}/quotation`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const decideQuotation = (id: string, input: ApprovalDecisionInput) => apiRequest(`/workflow/quotations/${apiSegment(id)}/decision`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const decideTransaction = (id: string, input: ApprovalDecisionInput) => apiRequest(`/workflow/transactions/${apiSegment(id)}/decision`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const getProjectTimelines = (): Promise<ProjectTimelineListItem[]> => apiRequest('/workflow/projects/timelines', { cache: 'no-store' })
export const getProjectTimeline = (id: string): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${apiSegment(id)}/timeline`, { cache: 'no-store' })
export const setProjectPaymentMode = (id: string, mode: 'cash' | 'loan'): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${apiSegment(id)}/payment-mode`, { method: 'PATCH', body: { payment_mode: mode } })
export const updateProjectTimelineStep = (id: string, step: string, input: ProjectTimelineStepInput): Promise<ProjectTimeline> => apiRequest(`/workflow/projects/${apiSegment(id)}/timeline/${apiSegment(step)}`, { method: 'PATCH', body: input })
