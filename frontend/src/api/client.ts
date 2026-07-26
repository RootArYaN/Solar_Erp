import type { ApiErrorBody, FieldErrors, IdempotentRequestOptions } from '../contracts/api-contracts'
import type { Session } from '../types'
import { clearSession, loadSession, replaceSession } from '../lib/auth-storage'

export const API_URL = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? '/api/v1'

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

export function getLastRequestId(): string | null { return lastRequestId }

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

export async function refreshCurrentSession(): Promise<Session> {
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
      throw new ApiError({ status: 500, body: { code: 'invalid_refresh_response', message: 'The session response is invalid.', field_errors: {}, request_id: response.headers.get('x-request-id') } })
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
  const { auth: _auth, token: _token, idempotencyKey: _key, retryOnUnauthorized: _retry, body, headers: _headers, ...requestInit } = options
  const response = await fetch(`${API_URL}${path}`, {
    ...requestInit,
    body: requestBody(body),
    headers: requestHeaders(options, token),
    credentials: 'include',
  })
  lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')

  if (response.status === 401 && authRequired && options.retryOnUnauthorized !== false) {
    try {
      const refreshed = await refreshCurrentSession()
      return apiRequest<T>(path, { ...options, token: refreshed.access_token, retryOnUnauthorized: false })
    } catch (reason) {
      clearSession('refresh_failed')
      throw reason
    }
  }
  const payload = await responsePayload(response)
  if (!response.ok) throw new ApiError({ status: response.status, body: normalizeError(response, payload) })
  return payload as T
}

export async function downloadRequest(path: string, fallbackName: string): Promise<void> {
  const token = loadSession()?.access_token
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) {
    const payload = await responsePayload(response)
    throw new ApiError({ status: response.status, body: normalizeError(response, payload) })
  }
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  const fileName = match ? decodeURIComponent(match[1]) : fallbackName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
