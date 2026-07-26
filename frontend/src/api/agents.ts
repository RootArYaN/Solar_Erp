import type { AgentListItem, AgentOverview, AgentTransaction, CreateAgentCustomerInput, CreateAgentTransactionInput, UpdateAgentProfileInput } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest } from './client'

export const getAgents = (token: string): Promise<AgentListItem[]> => apiRequest('/agents', { token })
export const getAgentOverview = (token: string, id: string): Promise<AgentOverview> => apiRequest(`/agents/${id}/overview`, { token })
export const updateAgentProfile = (token: string, id: string, input: UpdateAgentProfileInput): Promise<AgentOverview> => apiRequest(`/agents/${id}/profile`, { method: 'PATCH', token, body: input })
export const createAgentTransaction = (token: string, id: string, input: CreateAgentTransactionInput): Promise<AgentTransaction> => apiRequest(`/agents/${id}/transactions`, { method: 'POST', token, body: input, idempotencyKey: createClientId() })
export const createAgentCustomer = (token: string, id: string, input: CreateAgentCustomerInput): Promise<AgentOverview> => apiRequest(`/agents/${id}/customers`, { method: 'POST', token, body: input, idempotencyKey: createClientId() })
export const updateAgentCustomer = (token: string, id: string, customerId: string, input: CreateAgentCustomerInput): Promise<AgentOverview> => apiRequest(`/agents/${id}/customers/${customerId}`, { method: 'PATCH', token, body: input })
