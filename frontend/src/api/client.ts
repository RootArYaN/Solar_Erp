import type { ApiErrorBody, FieldErrors, IdempotentRequestOptions } from '../contracts/api-contracts'
import type { AuthSessionResponse, Session } from '../types'
import { AUTH_SESSION_EVENT, clearSession, getAccessToken, replaceSession, type SessionEndReason } from '../lib/auth-storage'
import { apiErrorMessage } from '../lib/error-messages'

const DEFAULT_TIMEOUT_MS = 30_000
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/g
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '')
  if (!trimmed) return '/api/v1'
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed

  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(trimmed, base)
  if (import.meta.env.PROD && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use HTTPS in production.')
  }
  return url.toString().replace(/\/$/, '')
}

export const API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? '/api/v1')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: FieldErrors
  readonly requestId: string | null
  readonly technicalMessage: string

  constructor(input: { status: number; body: ApiErrorBody }) {
    super(apiErrorMessage({
      status: input.status,
      code: input.body.code,
      message: input.body.message,
      hasFieldErrors: Object.keys(input.body.field_errors).length > 0,
    }))
    this.name = 'ApiError'
    this.status = input.status
    this.code = input.body.code
    this.fieldErrors = input.body.field_errors
    this.requestId = input.body.request_id
    this.technicalMessage = input.body.message
  }
}

type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & IdempotentRequestOptions & {
  auth?: boolean
  body?: BodyInit | Record<string, unknown> | null
  headers?: HeadersInit
  retryOnUnauthorized?: boolean
  timeoutMs?: number
}

let refreshPromise: Promise<Session> | null = null
let lastRequestId: string | null = null
let inMemoryCsrfToken: string | null = null

export function clearApiSecurityState(): void {
  inMemoryCsrfToken = null
  lastRequestId = null
}

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_SESSION_EVENT, (event) => {
    const detail = (event as CustomEvent<{ session?: Session | null }>).detail
    if (!detail?.session) inMemoryCsrfToken = null
  })
}

export function getLastRequestId(): string | null { return lastRequestId }

export function apiSegment(value: string | number): string {
  return encodeURIComponent(String(value))
}

function apiPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Invalid API path: ${path}`)
  return `${API_URL}${path}`
}

function isBodyInit(value: unknown): value is BodyInit {
  return typeof value === 'string'
    || value instanceof Blob
    || value instanceof FormData
    || value instanceof URLSearchParams
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
}

function isSameOriginApi(): boolean {
  if (typeof window === 'undefined') return false
  try { return new URL(API_URL, window.location.origin).origin === window.location.origin }
  catch { return false }
}

function csrfToken(): string | null {
  if (inMemoryCsrfToken) return inMemoryCsrfToken
  if (typeof document === 'undefined') return null
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content.trim()
  if (meta) return meta

  // A SPA cannot read an API-domain cookie. Cookie fallback is valid only for
  // same-origin deployments; cross-origin deployments use X-CSRF-Token returned
  // by login/refresh and retained in memory.
  if (!isSameOriginApi()) return null
  const cookieName = import.meta.env.VITE_CSRF_COOKIE_NAME ?? 'solar_erp_csrf'
  const prefix = `${encodeURIComponent(cookieName)}=`
  const cookie = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(prefix))
  if (!cookie) return null
  try { return decodeURIComponent(cookie.slice(prefix.length)) }
  catch { return null }
}

function captureResponseSecurity(response: Response): void {
  const token = response.headers.get('x-csrf-token')?.trim()
  if (token) inMemoryCsrfToken = token
}

function requestHeaders(options: ApiRequestOptions, token: string | null): Headers {
  const headers = new Headers(options.headers)
  const method = (options.method ?? 'GET').toUpperCase()
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey)
  if (options.body && !isBodyInit(options.body) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (UNSAFE_METHODS.has(method)) {
    const tokenValue = csrfToken()
    if (tokenValue) headers.set('X-CSRF-Token', tokenValue)
  }
  return headers
}

function formDataUsesMultipart(body: FormData): boolean {
  try {
    const probe = new Request('http://localhost', { method: 'POST', body })
    return probe.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data') === true
  } catch {
    return false
  }
}

function readBlobForRequest(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read upload body'))
    reader.onload = () => {
      if (reader.result && typeof reader.result !== 'string') resolve(reader.result)
      else reject(new Error('Could not read upload body'))
    }
    reader.readAsArrayBuffer(blob)
  })
}

type PreparedRequestBody = {
  body: BodyInit | null | undefined
  contentType?: string
}

function multipartToken(value: string): string {
  return value.replace(/[\r\n"]/g, '_')
}

async function encodeMultipart(body: FormData): Promise<PreparedRequestBody> {
  const boundary = `----solar-erp-${crypto.randomUUID().replaceAll('-', '')}`
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []

  for (const [name, value] of body.entries()) {
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${multipartToken(name)}"`))
    if (typeof value === 'string') {
      chunks.push(encoder.encode(`\r\n\r\n${value}\r\n`))
      continue
    }
    const contentType = (value.type || 'application/octet-stream').replace(/[\r\n]/g, '')
    chunks.push(encoder.encode(`; filename="${multipartToken(value.name)}"\r\nContent-Type: ${contentType}\r\n\r\n`))
    chunks.push(new Uint8Array(await readBlobForRequest(value)))
    chunks.push(encoder.encode('\r\n'))
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`))

  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { body: output, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function prepareRequestBody(body: ApiRequestOptions['body']): Promise<PreparedRequestBody> {
  if (body instanceof FormData) {
    return formDataUsesMultipart(body) ? { body } : encodeMultipart(body)
  }
  if (body == null || isBodyInit(body)) return { body: body as BodyInit | null | undefined }
  return { body: JSON.stringify(body) }
}

function requestSignal(signal: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), Math.max(1_000, timeoutMs))
  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function requestAcceptsSignal(signal: AbortSignal): boolean {
  try {
    new Request('http://localhost', { signal })
    return true
  } catch {
    // Test runners can expose DOM and fetch constructors from different realms.
    // Browsers use one realm, so a production signal remains fully supported.
    return false
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json')) return response.json().catch(() => undefined)
  const text = await response.text()
  return text ? text.slice(0, 500) : undefined
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
  const fallback = response.status >= 500 ? 'The server could not complete the request.' : response.statusText || 'Request failed'
  return { code: `http_${response.status}`, message: typeof payload === 'string' && payload.length < 200 ? payload : fallback, field_errors: {}, request_id: requestId }
}

async function rawFetch(path: string, options: ApiRequestOptions, token: string | null): Promise<Response> {
  const { auth: _auth, idempotencyKey: _key, retryOnUnauthorized: _retry, timeoutMs = DEFAULT_TIMEOUT_MS, body, headers: _headers, signal, ...requestInit } = options
  const managedSignal = requestSignal(signal, timeoutMs)
  const compatibleSignal = requestAcceptsSignal(managedSignal.signal) ? managedSignal.signal : undefined
  const method = (requestInit.method ?? 'GET').toUpperCase()
  try {
    const preparedBody = await prepareRequestBody(body)
    const headers = requestHeaders(options, token)
    if (preparedBody.contentType && !headers.has('Content-Type')) headers.set('Content-Type', preparedBody.contentType)
    const response = await fetch(apiPath(path), {
      ...requestInit,
      method,
      body: preparedBody.body,
      headers,
      credentials: 'include',
      cache: options.cache ?? (method === 'GET' ? 'no-store' : 'default'),
      referrerPolicy: 'same-origin',
      signal: compatibleSignal,
    })
    captureResponseSecurity(response)
    return response
  } finally {
    managedSignal.dispose()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function nonEmptyString(value: unknown, maxLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function validAuthResponse(payload: unknown): payload is AuthSessionResponse {
  if (!isRecord(payload) || !isRecord(payload.user) || !isRecord(payload.company)) return false
  const expiresAt = Date.parse(String(payload.expires_at ?? ''))
  return Boolean(
    nonEmptyString(payload.access_token, 8_192)
    && payload.token_type === 'bearer'
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now() - 60_000
    && nonEmptyString(payload.membership_id, 100)
    && nonEmptyString(payload.user.id, 100)
    && nonEmptyString(payload.user.username, 100)
    && nonEmptyString(payload.user.email, 320)
    && nonEmptyString(payload.user.full_name, 240)
    && typeof payload.user.is_super_admin === 'boolean'
    && nonEmptyString(payload.company.id, 100)
    && nonEmptyString(payload.company.name, 240)
    && nonEmptyString(payload.company.code, 100)
    && nonEmptyString(payload.role, 100)
    && Array.isArray(payload.permissions)
    && payload.permissions.every((permission) => nonEmptyString(permission, 160)),
  )
}

async function performSessionRefresh(): Promise<Session> {
  const response = await rawFetch('/auth/refresh', { method: 'POST', auth: false, retryOnUnauthorized: false }, null)
  lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')
  const payload = await responsePayload(response)
  if (!response.ok) throw new ApiError({ status: response.status, body: normalizeError(response, payload) })
  if (!validAuthResponse(payload)) {
    throw new ApiError({ status: 502, body: { code: 'invalid_refresh_response', message: 'The server returned an invalid session response.', field_errors: {}, request_id: response.headers.get('x-request-id') } })
  }
  return replaceSession(payload)
}

export async function refreshCurrentSession(): Promise<Session> {
  if (refreshPromise) return refreshPromise
  const refresh = () => performSessionRefresh()
  const lockManager = typeof navigator !== 'undefined' ? navigator.locks : undefined
  refreshPromise = (lockManager
    ? lockManager.request('solar-erp-session-refresh', { mode: 'exclusive' }, refresh)
    : refresh()
  ).finally(() => { refreshPromise = null })
  return refreshPromise
}

function sessionEndReason(reason: unknown): SessionEndReason {
  if (reason instanceof ApiError) {
    const code = reason.code.toLowerCase()
    if (code.includes('revoked')) return 'revoked'
    if (code.includes('invalid_session') || code.includes('disabled') || code.includes('inactive')) return 'invalid'
  }
  return 'expired'
}

export function isConfirmedSessionEnd(reason: unknown): boolean {
  if (!(reason instanceof ApiError)) return false
  const code = reason.code.toLowerCase()
  return reason.status === 401
    || code.includes('session_revoked')
    || code.includes('session_expired')
    || code.includes('session_inactive')
    || code.includes('invalid_session')
}

function clearConfirmedSession(reason: unknown): void {
  if (isConfirmedSessionEnd(reason)) {
    inMemoryCsrfToken = null
    clearSession(sessionEndReason(reason))
  }
}

async function authenticatedToken(authRequired: boolean): Promise<string | null> {
  if (!authRequired) return null
  const token = getAccessToken()
  if (token) return token
  await refreshCurrentSession()
  const refreshedToken = getAccessToken()
  if (!refreshedToken) throw new ApiError({ status: 401, body: { code: 'session_missing', message: 'Your session is no longer available.', field_errors: {}, request_id: null } })
  return refreshedToken
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const authRequired = options.auth !== false
  let token: string | null
  try {
    token = await authenticatedToken(authRequired)
  } catch (reason) {
    if (authRequired) clearConfirmedSession(reason)
    throw reason
  }

  let response = await rawFetch(path, options, token)
  lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')

  if (response.status === 401 && authRequired && options.retryOnUnauthorized !== false) {
    try {
      await refreshCurrentSession()
      response = await rawFetch(path, { ...options, retryOnUnauthorized: false }, getAccessToken())
      lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')
    } catch (reason) {
      clearConfirmedSession(reason)
      throw reason
    }
  }

  const payload = await responsePayload(response)
  if (!response.ok) {
    const error = new ApiError({ status: response.status, body: normalizeError(response, payload) })
    if (authRequired) clearConfirmedSession(error)
    throw error
  }
  return payload as T
}

function safeDownloadName(value: string): string {
  let name = value
    .replace(BIDI_CONTROLS, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
  if (WINDOWS_RESERVED_NAME.test(name)) name = `_${name}`
  return name.slice(0, 180) || 'download'
}

export async function downloadRequest(path: string, fallbackName: string): Promise<void> {
  const { blob, fileName: responseName } = await binaryRequest(path)
  const fileName = responseName || fallbackName
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeDownloadName(fileName)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function binaryRequest(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  let token: string | null
  try {
    token = await authenticatedToken(true)
  } catch (reason) {
    clearConfirmedSession(reason)
    throw reason
  }

  let response = await rawFetch(path, { headers: { Accept: 'application/octet-stream' } }, token)
  lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')
  if (response.status === 401) {
    try {
      await refreshCurrentSession()
      token = getAccessToken()
      response = await rawFetch(path, { headers: { Accept: 'application/octet-stream' }, retryOnUnauthorized: false }, token)
      lastRequestId = response.headers.get('x-request-id') || response.headers.get('request-id')
    } catch (reason) {
      clearConfirmedSession(reason)
      throw reason
    }
  }
  if (!response.ok) {
    const payload = await responsePayload(response)
    const error = new ApiError({ status: response.status, body: normalizeError(response, payload) })
    clearConfirmedSession(error)
    throw error
  }

  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  let fileName: string | null = null
  if (match) {
    try { fileName = decodeURIComponent(match[1]) } catch { fileName = match[1] }
  }
  return { blob, fileName }
}

export async function blobRequest(path: string): Promise<Blob> {
  return (await binaryRequest(path)).blob
}
