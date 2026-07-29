import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_URL,
  apiRequest,
  blobRequest,
  clearApiSecurityState,
  downloadRequest,
  getLastRequestId,
  refreshCurrentSession,
} from './api'
import { server } from '../test/server'
import { loadSession, saveSession } from './auth-storage'
import type { AuthSessionResponse } from '../types'

function authResponse(overrides: Partial<AuthSessionResponse> = {}): AuthSessionResponse {
  return {
    access_token: 'access-token-current',
    token_type: 'bearer',
    expires_at: '2099-01-01T00:00:00Z',
    membership_id: 'm1',
    user: { id: 'u1', username: 'user', email: 'user@example.com', full_name: 'User', is_super_admin: false },
    company: { id: 'c1', name: 'Solar EPC', code: 'SOLAR' },
    role: 'viewer',
    permissions: ['dashboard.view'],
    ...overrides,
  }
}

afterEach(() => {
  clearApiSecurityState()
  document.cookie = 'solar_erp_csrf=; Max-Age=0; path=/'
})

describe('api client', () => {
  it('handles 204 without parsing JSON', async () => {
    server.use(http.delete(`${API_URL}/test`, () => new HttpResponse(null, { status: 204 })))
    await expect(apiRequest<void>('/test', { method: 'DELETE', auth: false })).resolves.toBeUndefined()
  })

  it('surfaces structured errors and request IDs', async () => {
    server.use(http.get(`${API_URL}/test`, () => HttpResponse.json(
      { code: 'invalid_record', message: 'Invalid record', field_errors: { name: ['Required'] }, request_id: null },
      { status: 422, headers: { 'x-request-id': 'req-123' } },
    )))
    await expect(apiRequest('/test', { auth: false })).rejects.toMatchObject({ code: 'invalid_record', requestId: 'req-123', fieldErrors: { name: ['Required'] } })
    expect(getLastRequestId()).toBe('req-123')
  })

  it('does not force JSON headers for multipart bodies', async () => {
    server.use(http.post(`${API_URL}/upload`, async ({ request }) => {
      expect(request.headers.get('content-type')).toContain('multipart/form-data')
      return HttpResponse.json({ ok: true })
    }))
    const body = new FormData()
    body.append('file', new File(['x'], 'poster.png', { type: 'image/png' }))
    await expect(apiRequest('/upload', { method: 'POST', auth: false, body })).resolves.toEqual({ ok: true })
  })

  it('retains a CSRF token returned by refresh without requiring a readable API cookie', async () => {
    server.use(
      http.post(`${API_URL}/auth/refresh`, () => HttpResponse.json(authResponse(), { headers: { 'X-CSRF-Token': 'csrf-response-token' } })),
      http.post(`${API_URL}/csrf-check`, ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe('csrf-response-token')
        expect(request.headers.get('x-requested-with')).toBeNull()
        return HttpResponse.json({ ok: true })
      }),
    )

    await refreshCurrentSession()
    await expect(apiRequest('/csrf-check', { method: 'POST', auth: false, body: { ok: true } })).resolves.toEqual({ ok: true })
  })

  it('preserves caller-supplied Accept headers', async () => {
    server.use(http.get(`${API_URL}/binary`, ({ request }) => {
      expect(request.headers.get('accept')).toBe('application/octet-stream')
      return new HttpResponse('file', { headers: { 'content-type': 'application/octet-stream' } })
    }))
    await expect(apiRequest('/binary', { auth: false, headers: { Accept: 'application/octet-stream' } })).resolves.toBe('file')
  })

  it('refreshes once and retries concurrent unauthorized requests', async () => {
    saveSession(authResponse({ access_token: 'old-token' }), true)
    let refreshCount = 0
    const protectedHandler = ({ request }: { request: Request }) => request.headers.get('authorization') === 'Bearer new-token'
      ? HttpResponse.json({ ok: true })
      : HttpResponse.json({ code: 'token_expired', message: 'Expired', field_errors: {}, request_id: null }, { status: 401 })

    server.use(
      http.get(`${API_URL}/private-a`, protectedHandler),
      http.get(`${API_URL}/private-b`, protectedHandler),
      http.post(`${API_URL}/auth/refresh`, () => {
        refreshCount += 1
        return HttpResponse.json(authResponse({ access_token: 'new-token' }), { headers: { 'X-CSRF-Token': 'csrf-new' } })
      }),
    )

    await expect(Promise.all([apiRequest('/private-a'), apiRequest('/private-b')])).resolves.toEqual([{ ok: true }, { ok: true }])
    expect(refreshCount).toBe(1)
  })

  it('does not destroy a valid stored profile when refresh fails because the network is unavailable', async () => {
    saveSession(authResponse({ access_token: 'old-token' }), true)
    server.use(
      http.get(`${API_URL}/private`, () => HttpResponse.json({ code: 'token_expired', message: 'Expired', field_errors: {}, request_id: null }, { status: 401 })),
      http.post(`${API_URL}/auth/refresh`, () => HttpResponse.error()),
    )

    await expect(apiRequest('/private')).rejects.toBeTruthy()
    expect(loadSession()).toMatchObject({ membership_id: 'm1', user: { id: 'u1' } })
  })

  it('clears a session only after a confirmed refresh-session rejection', async () => {
    saveSession(authResponse({ access_token: 'expired-token', expires_at: '2020-01-01T00:00:00Z' }), true)
    server.use(http.post(`${API_URL}/auth/refresh`, () => HttpResponse.json(
      { code: 'session_expired', message: 'Refresh session expired', field_errors: {}, request_id: 'req-refresh' },
      { status: 401 },
    )))

    await expect(apiRequest('/private')).rejects.toMatchObject({ code: 'session_expired' })
    expect(loadSession()).toBeNull()
  })

  it('uses the binary Accept header for authenticated downloads', async () => {
    saveSession(authResponse(), true)
    const createObjectUrl = vi.fn(() => 'blob:test')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    server.use(http.get(`${API_URL}/files/file-1/download`, ({ request }) => {
      expect(request.headers.get('accept')).toBe('application/octet-stream')
      return new HttpResponse(new Blob(['pdf']), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="safe.pdf"',
        },
      })
    }))

    await downloadRequest('/files/file-1/download', 'fallback.pdf')
    expect(createObjectUrl).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('returns an authenticated binary blob for inline previews', async () => {
    saveSession(authResponse(), true)
    server.use(http.get(`${API_URL}/files/file-preview/download`, ({ request }) => {
      expect(request.headers.get('accept')).toBe('application/octet-stream')
      expect(request.headers.get('authorization')).toBe('Bearer access-token-current')
      return new HttpResponse(new Blob(['image']), { headers: { 'content-type': 'image/png' } })
    }))

    const blob = await blobRequest('/files/file-preview/download')
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
  })
})
