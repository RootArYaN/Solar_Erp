import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API_URL, ApiError, apiRequest, getLastRequestId } from './api'
import { server } from '../test/server'
import { loadSession, saveSession } from './auth-storage'
import type { Session } from '../types'

describe('api client', () => {
  it('handles 204 without parsing JSON', async () => {
    server.use(http.delete(`${API_URL}/test`, () => new HttpResponse(null, { status: 204 })))
    await expect(apiRequest<void>('/test', { method: 'DELETE', auth: false })).resolves.toBeUndefined()
  })

  it('surfaces structured errors and request IDs', async () => {
    server.use(http.get(`${API_URL}/test`, () => HttpResponse.json({ code: 'invalid_record', message: 'Invalid record', field_errors: { name: ['Required'] }, request_id: null }, { status: 422, headers: { 'x-request-id': 'req-123' } })))
    await expect(apiRequest('/test', { auth: false })).rejects.toMatchObject({ code: 'invalid_record', requestId: 'req-123', fieldErrors: { name: ['Required'] } })
    expect(getLastRequestId()).toBe('req-123')
  })

  it('does not force JSON headers for multipart bodies', async () => {
    server.use(http.post(`${API_URL}/upload`, async ({ request }) => {
      expect(request.headers.get('content-type')).toContain('multipart/form-data')
      return HttpResponse.json({ ok: true })
    }))
    const body = new FormData(); body.append('file', new File(['x'], 'poster.png', { type: 'image/png' }))
    await expect(apiRequest('/upload', { method: 'POST', auth: false, body })).resolves.toEqual({ ok: true })
  })

  it('clears an expired session when secure-cookie refresh fails', async () => {
    const session: Session = {
      access_token: 'expired-token', token_type: 'bearer', expires_at: '2026-01-01T00:00:00Z',
      user: { id: 'u1', username: 'user', email: 'user@example.com', full_name: 'User' },
      company: { id: 'c1', name: 'Solar EPC', code: 'SOLAR' }, role: 'viewer', permissions: ['dashboard.view'],
    }
    saveSession(session, true)
    server.use(
      http.get(`${API_URL}/private`, () => HttpResponse.json({ code: 'token_expired', message: 'Access token expired', field_errors: {}, request_id: 'req-access' }, { status: 401 })),
      http.post(`${API_URL}/auth/refresh`, () => HttpResponse.json({ code: 'session_expired', message: 'Refresh session expired', field_errors: {}, request_id: 'req-refresh' }, { status: 401 })),
    )

    await expect(apiRequest('/private')).rejects.toMatchObject({ code: 'session_expired' })
    expect(loadSession()).toBeNull()
  })

})
