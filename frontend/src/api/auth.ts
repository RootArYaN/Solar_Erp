import type { AuthSessionResponse, Session } from '../types'
import { clearSession } from '../lib/auth-storage'
import { createClientId } from '../lib/client-id'
import { apiRequest, clearApiSecurityState } from './client'

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

export function login(input: { username: string; password: string; remember: boolean }): Promise<AuthSessionResponse> {
  return apiRequest('/auth/login', { method: 'POST', auth: false, retryOnUnauthorized: false, body: input })
}
export async function logout(): Promise<void> {
  try { await apiRequest('/auth/logout', { method: 'POST', retryOnUnauthorized: false }) }
  finally { clearApiSecurityState(); clearSession('signed_out') }
}
export function getCurrentSession(): Promise<Session> { return apiRequest('/auth/me') }
export function getActiveDevices(): Promise<ActiveDevice[]> { return apiRequest('/auth/devices') }
export function logoutOtherDevices(): Promise<void> { return apiRequest('/auth/devices/others', { method: 'DELETE', idempotencyKey: createClientId() }) }
