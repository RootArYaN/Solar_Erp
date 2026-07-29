import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { clearApiSecurityState } from '../lib/api'
import { clearSession } from '../lib/auth-storage'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => { cleanup(); server.resetHandlers(); clearApiSecurityState(); clearSession('signed_out'); localStorage.clear(); sessionStorage.clear(); document.cookie = 'solar_erp_csrf=; Max-Age=0; path=/' })
afterAll(() => server.close())
