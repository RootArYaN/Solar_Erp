import type {
  AgentListItem,
  AgentOverview,
  AgentTransaction,
  CreateAgentTransactionInput,
  CreateRoleInput,
  CreateUserInput,
  ManagedUser,
  Permission,
  Role,
  Session,
  UpdateAgentProfileInput,
  UpdateRoleInput,
  UpdateUserInput,
} from '../types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = Array.isArray(data.detail)
      ? data.detail.map((item: { msg?: string }) => item.msg ?? 'Invalid value').join(', ')
      : data.detail ?? 'Request failed'
    throw new ApiError(message, response.status)
  }
  return data as T
}

async function authorizedRequest<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  })
  return parseResponse<T>(response)
}

export async function login(input: {
  email: string
  password: string
  company_code?: string
}): Promise<Session> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseResponse<Session>(response)
}

export function getCurrentSession(token: string): Promise<Omit<Session, 'access_token' | 'token_type' | 'expires_at'>> {
  return authorizedRequest(token, '/auth/me')
}

export function getUsers(token: string): Promise<ManagedUser[]> {
  return authorizedRequest(token, '/admin/users')
}

export function createUser(token: string, input: CreateUserInput): Promise<ManagedUser> {
  return authorizedRequest(token, '/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateUser(token: string, membershipId: string, input: UpdateUserInput): Promise<ManagedUser> {
  return authorizedRequest(token, `/admin/users/${membershipId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function resetUserPassword(token: string, membershipId: string, newPassword: string): Promise<void> {
  return authorizedRequest(token, `/admin/users/${membershipId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export function getRoles(token: string): Promise<Role[]> {
  return authorizedRequest(token, '/admin/roles')
}

export function getPermissions(token: string): Promise<Permission[]> {
  return authorizedRequest(token, '/admin/permissions')
}

export function createRole(token: string, input: CreateRoleInput): Promise<Role> {
  return authorizedRequest(token, '/admin/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateRole(token: string, roleId: string, input: UpdateRoleInput): Promise<Role> {
  return authorizedRequest(token, `/admin/roles/${roleId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteRole(token: string, roleId: string): Promise<void> {
  return authorizedRequest(token, `/admin/roles/${roleId}`, { method: 'DELETE' })
}


export function getAgents(token: string): Promise<AgentListItem[]> {
  return authorizedRequest(token, '/agents')
}

export function getAgentOverview(token: string, membershipId: string): Promise<AgentOverview> {
  return authorizedRequest(token, `/agents/${membershipId}/overview`)
}

export function updateAgentProfile(
  token: string,
  membershipId: string,
  input: UpdateAgentProfileInput,
): Promise<AgentOverview> {
  return authorizedRequest(token, `/agents/${membershipId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function createAgentTransaction(
  token: string,
  membershipId: string,
  input: CreateAgentTransactionInput,
): Promise<AgentTransaction> {
  return authorizedRequest(token, `/agents/${membershipId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
