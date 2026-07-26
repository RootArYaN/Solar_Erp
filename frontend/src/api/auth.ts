import type { Session } from '../types'
import { clearSession } from '../lib/auth-storage'
import { apiRequest } from './client'

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

export function login(input: { username: string; password: string; remember: boolean }): Promise<Session> {
  return apiRequest('/auth/login', { method: 'POST', auth: false, body: input })
}
export async function logout(): Promise<void> {
  try { await apiRequest('/auth/logout', { method: 'POST', retryOnUnauthorized: false }) }
  finally { clearSession('signed_out') }
}
export function getCurrentSession(token?: string): Promise<Omit<Session, 'access_token' | 'token_type' | 'expires_at'>> { return apiRequest('/auth/me', { token }) }
export function getActiveDevices(): Promise<ActiveDevice[]> { return apiRequest('/auth/devices') }
export function logoutOtherDevices(): Promise<void> { return apiRequest('/auth/devices/others', { method: 'DELETE', idempotencyKey: crypto.randomUUID() }) }
