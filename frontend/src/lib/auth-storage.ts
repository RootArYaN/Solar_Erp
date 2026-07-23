import type { Session } from '../types'

const STORAGE_KEY = 'solar-erp-session'

export function saveSession(session: Session, remember: boolean): void {
  clearSession()
  const storage = remember ? localStorage : sessionStorage
  storage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const session = JSON.parse(raw) as Session
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      clearSession()
      return null
    }
    return session
  } catch {
    clearSession()
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
}
