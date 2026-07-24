import type { ApiErrorBody, FieldErrors, IdempotentRequestOptions } from '../contracts/api-contracts'
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
import { clearSession, loadSession, replaceSession } from './auth-storage'

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: FieldErrors
  readonly requestId: string | null

  constructor(input: { status: number; body: ApiErrorBody }) {
    super(input.body.message)
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.body.code
    this.fieldErrors = input.body.field_errors
    this.requestId = input.body.request_id
  }
}

type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & IdempotentRequestOptions & {
  token?: string | null
  auth?: boolean
  body?: BodyInit | Record<string, unknown> | null
  headers?: HeadersInit
  retryOnUnauthorized?: boolean
}

let refreshPromise: Promise<Session> | null = null
let lastRequestId: string | null = null

export function getLastRequestId(): string | null {
  return lastRequestId
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string' || value instanceof Blob || value instanceof FormData || value instanceof URLSearchParams || value instanceof ArrayBuffer
}

function requestHeaders(options: ApiRequestOptions, token: string | null): Headers {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body && !isBodyInit(options.body) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return headers
}

function requestBody(body: ApiRequestOptions['body']): BodyInit | null | undefined {
  if (body == null || isBodyInit(body)) return body as BodyInit | null | undefined
  return JSON.stringify(body)
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) return response.json().catch(() => undefined)
  const text = await response.text()
  return text || undefined
}

function normalizeError(response: Response, payload: unknown): ApiErrorBody {
  const requestId = response.headers.get('x-request-id') || response.headers.get('request-id')
  if (payload && typeof payload === 'object' && 'code' in payload && 'message' in payload) {
    const body = payload as Partial<ApiErrorBody>
    return {
      code: String(body.code || `http_${response.status}`),
      message: String(body.message || response.statusText || 'Request failed'),
      field_errors: body.field_errors && typeof body.field_errors === 'object' ? body.field_errors : {},
      request_id: body.request_id ? String(body.request_id) : requestId,
    }
  }

  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail
    const message = Array.isArray(detail)
      ? detail.map((item) => typeof item === 'object' && item && 'msg' in item ? String(item.msg) : 'Invalid value').join(', ')
      : typeof detail === 'string' ? detail : response.statusText || 'Request failed'
    return { code: `http_${response.status}`, message, field_errors: {}, request_id: requestId }
  }

  return { code: `http_${response.status}`, message: typeof payload === 'string' ? payload : response.statusText || 'Request failed', field_errors: {}, request_id: requestId }
}

async function refreshSession(): Promise<Session> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
    const payload = await responsePayload(response)
    if (!response.ok) throw new ApiError({ status: response.status, body: normalizeError(response, payload) })
    const session = payload as Session
    if (!session?.access_token || !session?.expires_at || !session?.user || !session?.company) {
      throw new ApiError({
        status: 500,
        body: { code: 'invalid_refresh_response', message: 'The refresh response did not match the frozen session contract.', field_errors: {}, request_id: response.headers.get('x-request-id') },
      })
    }
    replaceSession(session)
    return session
  })().finally(() => { refreshPromise = null })
  return refreshPromise
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const authRequired = options.auth !== false
  const storedToken = loadSession()?.access_token ?? null
  const token = authRequired ? options.token ?? storedToken : null
  const { auth: _auth, token: _token, idempotencyKey: _idempotencyKey, retryOnUnauthorized: _retry, body, headers: _headers, ...requestInit } = options
  const response = await fetch(`${API_URL}${path}`, {
    ...requestInit,
    body: requestBody(body),
    headers: requestHeaders(options, token),
    credentials: 'include',
  })

  lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')

  if (response.status === 401 && authRequired && options.retryOnUnauthorized !== false) {
    try {
      const refreshed = await refreshSession()
      return apiRequest<T>(path, { ...options, token: refreshed.access_token, retryOnUnauthorized: false })
    } catch (reason) {
      const revoked = reason instanceof ApiError && ['session_revoked', 'refresh_revoked'].includes(reason.code)
      const expired = reason instanceof ApiError && ['session_expired', 'refresh_expired', 'token_expired'].includes(reason.code)
      clearSession(revoked ? 'revoked' : expired ? 'expired' : 'refresh_failed')
      throw reason
    }
  }

  const payload = await responsePayload(response)
  if (!response.ok) throw new ApiError({ status: response.status, body: normalizeError(response, payload) })
  return payload as T
}

export async function login(input: { username: string; password: string }): Promise<Session> {
  return apiRequest<Session>('/auth/login', { method: 'POST', auth: false, body: input })
}

export async function logout(): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST', retryOnUnauthorized: false })
  } finally {
    clearSession('signed_out')
  }
}

export function getCurrentSession(token?: string): Promise<Omit<Session, 'access_token' | 'token_type' | 'expires_at'>> {
  return apiRequest('/auth/me', { token })
}

export type ActiveDevice = {
  id: string
  device_name: string
  browser: string
  operating_system: string
  approximate_location: string
  ip_hint: string
  created_at: string
  last_seen_at: string
  is_current: boolean
}

export function getActiveDevices(): Promise<ActiveDevice[]> {
  return apiRequest('/auth/devices')
}

export function logoutOtherDevices(): Promise<void> {
  return apiRequest('/auth/devices/others', { method: 'DELETE', idempotencyKey: crypto.randomUUID() })
}

export function getUsers(token: string): Promise<ManagedUser[]> { return apiRequest('/admin/users', { token }) }
export function createUser(token: string, input: CreateUserInput): Promise<ManagedUser> { return apiRequest('/admin/users', { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() }) }
export function updateUser(token: string, membershipId: string, input: UpdateUserInput): Promise<ManagedUser> { return apiRequest(`/admin/users/${membershipId}`, { method: 'PATCH', token, body: input }) }
export function resetUserPassword(token: string, membershipId: string, newPassword: string): Promise<void> { return apiRequest(`/admin/users/${membershipId}/reset-password`, { method: 'POST', token, body: { new_password: newPassword }, idempotencyKey: crypto.randomUUID() }) }
export function getRoles(token: string): Promise<Role[]> { return apiRequest('/admin/roles', { token }) }
export function getPermissions(token: string): Promise<Permission[]> { return apiRequest('/admin/permissions', { token }) }
export function createRole(token: string, input: CreateRoleInput): Promise<Role> { return apiRequest('/admin/roles', { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() }) }
export function updateRole(token: string, roleId: string, input: UpdateRoleInput): Promise<Role> { return apiRequest(`/admin/roles/${roleId}`, { method: 'PATCH', token, body: input }) }
export function deleteRole(token: string, roleId: string): Promise<void> { return apiRequest(`/admin/roles/${roleId}`, { method: 'DELETE', token, idempotencyKey: crypto.randomUUID() }) }
export function getAgents(token: string): Promise<AgentListItem[]> { return apiRequest('/agents', { token }) }
export function getAgentOverview(token: string, membershipId: string): Promise<AgentOverview> { return apiRequest(`/agents/${membershipId}/overview`, { token }) }
export function updateAgentProfile(token: string, membershipId: string, input: UpdateAgentProfileInput): Promise<AgentOverview> { return apiRequest(`/agents/${membershipId}/profile`, { method: 'PATCH', token, body: input }) }
export function createAgentTransaction(token: string, membershipId: string, input: CreateAgentTransactionInput): Promise<AgentTransaction> { return apiRequest(`/agents/${membershipId}/transactions`, { method: 'POST', token, body: input, idempotencyKey: crypto.randomUUID() }) }
