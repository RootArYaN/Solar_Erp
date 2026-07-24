import type { Session } from '../types'

const STORAGE_KEY = 'solar-erp-session'
const STORAGE_MODE_KEY = 'solar-erp-session-mode'
export const AUTH_SESSION_EVENT = 'solar-erp-session-changed'

export type SessionEndReason = 'signed_out' | 'expired' | 'revoked' | 'refresh_failed' | 'invalid'
export type StoredSession = { session: Session | null; remember: boolean }

const userScopedKeys = [
  'solarErpInventoryV1',
  'shreeSolarPricingV1',
  'solar-erp-document-template-v1',
  'solar-erp-customer-flow-draft',
]
const userScopedPrefixes = ['solar-erp-draft:', 'solar-erp-cache:', 'solar-erp-upload:']

function emitSessionChange(session: Session | null, reason?: SessionEndReason): void {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EVENT, { detail: { session, reason } }))
}

function storageFor(remember: boolean): Storage {
  return remember ? localStorage : sessionStorage
}

export function saveSession(session: Session, remember: boolean): void {
  localStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  storageFor(remember).setItem(STORAGE_KEY, JSON.stringify(session))
  localStorage.setItem(STORAGE_MODE_KEY, remember ? 'local' : 'session')
  emitSessionChange(session)
}

export function replaceSession(session: Session): void {
  const current = loadStoredSession()
  saveSession(session, current.remember)
}

export function loadStoredSession(): StoredSession {
  const local = localStorage.getItem(STORAGE_KEY)
  const sessionValue = sessionStorage.getItem(STORAGE_KEY)
  const raw = local ?? sessionValue
  if (!raw) return { session: null, remember: localStorage.getItem(STORAGE_MODE_KEY) !== 'session' }

  try {
    const parsed = JSON.parse(raw) as Partial<Session>
    if (
      typeof parsed.access_token !== 'string'
      || typeof parsed.role !== 'string'
      || !parsed.user
      || typeof parsed.user.username !== 'string'
    ) {
      clearSession('invalid', false)
      return { session: null, remember: true }
    }
    return { session: parsed as Session, remember: Boolean(local) }
  } catch {
    clearSession('invalid', false)
    return { session: null, remember: true }
  }
}

export function loadSession(): Session | null {
  return loadStoredSession().session
}

export function clearUserScopedData(): void {
  userScopedKeys.forEach((key) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  })

  for (const storage of [localStorage, sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key))
    keys.filter((key) => userScopedPrefixes.some((prefix) => key.startsWith(prefix))).forEach((key) => storage.removeItem(key))
  }
}

export function clearSession(reason: SessionEndReason = 'signed_out', clearUserData = true): void {
  localStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(STORAGE_MODE_KEY)
  if (clearUserData) clearUserScopedData()
  emitSessionChange(null, reason)
}
