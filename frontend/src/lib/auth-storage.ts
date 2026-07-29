import type { AuthSessionResponse, Session } from '../types'

const STORAGE_KEY = 'solar-erp-session-profile'
const LEGACY_STORAGE_KEY = 'solar-erp-session'
const STORAGE_MODE_KEY = 'solar-erp-session-mode'
export const AUTH_SESSION_EVENT = 'solar-erp-session-changed'

export type SessionEndReason = 'signed_out' | 'expired' | 'revoked' | 'invalid'
export type StoredSession = { session: Session | null; remember: boolean }

type AuthBroadcast = { source: string; session: Session | null; remember: boolean; reason?: SessionEndReason }
const AUTH_CHANNEL_NAME = 'solar-erp-auth'
const tabId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
let authChannel: BroadcastChannel | null = null

const userScopedKeys = [
  'solarErpInventoryV1',
  'shreeSolarPricingV1',
  'solar-erp-document-template-v1',
  'solar-erp-customer-flow-draft',
]
const userScopedPrefixes = ['solar-erp-draft:', 'solar-erp-cache:', 'solar-erp-upload:']

let accessToken: string | null = null
let accessTokenExpiresAt = 0

function broadcastAuth(message: Omit<AuthBroadcast, 'source'>): void {
  authChannel?.postMessage({ ...message, source: tabId } satisfies AuthBroadcast)
}

function emitSessionChange(session: Session | null, reason?: SessionEndReason): void {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EVENT, { detail: { session, reason } }))
}

function toSession(value: Session | AuthSessionResponse): Session {
  const { membership_id, user, company, role, permissions } = value
  return { membership_id, user, company, role, permissions }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<Session>
  return Boolean(
    typeof session.membership_id === 'string'
    && session.membership_id.length > 0
    && session.user
    && typeof session.user.id === 'string'
    && typeof session.user.username === 'string'
    && typeof session.user.email === 'string'
    && typeof session.user.full_name === 'string'
    && typeof session.user.is_super_admin === 'boolean'
    && session.company
    && typeof session.company.id === 'string'
    && typeof session.company.name === 'string'
    && typeof session.company.code === 'string'
    && typeof session.role === 'string'
    && Array.isArray(session.permissions)
    && session.permissions.every((permission) => typeof permission === 'string'),
  )
}

function writeSessionProfile(session: Session, remember: boolean): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  localStorage.setItem(STORAGE_MODE_KEY, remember ? 'persistent-cookie' : 'session-cookie')
}

function setAccessToken(response: AuthSessionResponse): void {
  accessToken = response.access_token
  const expiresAt = Date.parse(response.expires_at)
  accessTokenExpiresAt = Number.isFinite(expiresAt) ? expiresAt : 0
}

export function saveSession(response: AuthSessionResponse, remember: boolean): Session {
  setAccessToken(response)
  const session = toSession(response)
  writeSessionProfile(session, remember)
  emitSessionChange(session)
  broadcastAuth({ session, remember })
  return session
}

export function replaceSession(value: Session | AuthSessionResponse): Session {
  const current = loadStoredSession()
  if ('access_token' in value) setAccessToken(value)
  const session = toSession(value)
  writeSessionProfile(session, current.remember)
  emitSessionChange(session)
  broadcastAuth({ session, remember: current.remember })
  return session
}

export function loadStoredSession(): StoredSession {
  sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  const raw = sessionStorage.getItem(STORAGE_KEY)
  const remember = localStorage.getItem(STORAGE_MODE_KEY) !== 'session-cookie'
  if (!raw) return { session: null, remember }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isSession(parsed)) {
      clearSession('invalid', false)
      return { session: null, remember: true }
    }
    return { session: parsed, remember }
  } catch {
    clearSession('invalid', false)
    return { session: null, remember: true }
  }
}

export function loadSession(): Session | null {
  return loadStoredSession().session
}

export function getAccessToken(): string | null {
  if (!accessToken) return null
  if (accessTokenExpiresAt && accessTokenExpiresAt <= Date.now() + 5_000) {
    accessToken = null
    accessTokenExpiresAt = 0
    return null
  }
  return accessToken
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

export function clearSession(reason: SessionEndReason = 'signed_out', clearUserData = true, notifyOtherTabs = true): void {
  accessToken = null
  accessTokenExpiresAt = 0
  localStorage.removeItem(LEGACY_STORAGE_KEY)
  sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(STORAGE_MODE_KEY)
  if (clearUserData) clearUserScopedData()
  emitSessionChange(null, reason)
  if (notifyOtherTabs) broadcastAuth({ session: null, remember: true, reason })
}

if (typeof BroadcastChannel !== 'undefined') {
  authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME)
  authChannel.addEventListener('message', (event: MessageEvent<AuthBroadcast>) => {
    const message = event.data
    if (!message || message.source === tabId) return
    accessToken = null
    accessTokenExpiresAt = 0
    if (message.session && isSession(message.session)) {
      writeSessionProfile(message.session, message.remember)
      emitSessionChange(message.session)
      return
    }
    clearSession(message.reason ?? 'signed_out', true, false)
  })
}
