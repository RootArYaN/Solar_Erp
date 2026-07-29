import { describe, expect, it, vi } from 'vitest'
import { AUTH_SESSION_EVENT, clearSession, saveSession } from './auth-storage'
import type { AuthSessionResponse } from '../types'

const session: AuthSessionResponse = {
  access_token: 'token', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z', membership_id: 'm1',
  user: { id: 'u1', username: 'test.user', email: 'user@example.com', full_name: 'Test User', is_super_admin: false },
  company: { id: 'c1', name: 'Solar EPC', code: 'SOLAR' }, role: 'company_admin', permissions: [],
}

describe('auth storage', () => {
  it('clears the session and user-scoped caches on logout', () => {
    const listener = vi.fn()
    window.addEventListener(AUTH_SESSION_EVENT, listener)
    saveSession(session, true)
    const storedProfile = sessionStorage.getItem('solar-erp-session-profile')
    expect(storedProfile).not.toContain('access_token')
    expect(storedProfile).not.toContain('\"token\"')
    localStorage.setItem('solar-erp-draft:quotation', 'draft')
    localStorage.setItem('solarErpInventoryV1', '{}')
    clearSession('expired')
    expect(localStorage.getItem('solar-erp-session')).toBeNull()
    expect(localStorage.getItem('solar-erp-draft:quotation')).toBeNull()
    expect(localStorage.getItem('solarErpInventoryV1')).toBeNull()
    expect(listener).toHaveBeenCalled()
    window.removeEventListener(AUTH_SESSION_EVENT, listener)
  })
})
