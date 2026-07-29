import type { AgentListItem, AgentOverview, AgentTransaction, CreateAgentCustomerInput, CreateAgentTransactionInput, UpdateAgentProfileInput } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment } from './client'

export const getAgents = (): Promise<AgentListItem[]> => apiRequest('/agents', { cache: 'no-store' })
export const getAgentOverview = (id: string): Promise<AgentOverview> => apiRequest(`/agents/${apiSegment(id)}/overview`, { cache: 'no-store' })
export const updateAgentProfile = (id: string, input: UpdateAgentProfileInput): Promise<AgentOverview> => apiRequest(`/agents/${apiSegment(id)}/profile`, { method: 'PATCH', body: input })
export const createAgentTransaction = (id: string, input: CreateAgentTransactionInput): Promise<AgentTransaction> => apiRequest(`/agents/${apiSegment(id)}/transactions`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const updateAgentTransaction = (id: string, transactionId: string, input: CreateAgentTransactionInput): Promise<AgentTransaction> => apiRequest(`/agents/${apiSegment(id)}/transactions/${apiSegment(transactionId)}`, { method: 'PATCH', body: input })
export const deleteAgentTransaction = (id: string, transactionId: string): Promise<void> => apiRequest(`/agents/${apiSegment(id)}/transactions/${apiSegment(transactionId)}`, { method: 'DELETE' })
export const createAgentCustomer = (id: string, input: CreateAgentCustomerInput): Promise<AgentOverview> => apiRequest(`/agents/${apiSegment(id)}/customers`, { method: 'POST', body: input, idempotencyKey: createClientId() })
export const updateAgentCustomer = (id: string, customerId: string, input: CreateAgentCustomerInput): Promise<AgentOverview> => apiRequest(`/agents/${apiSegment(id)}/customers/${apiSegment(customerId)}`, { method: 'PATCH', body: input })
