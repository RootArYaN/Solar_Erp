import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { saveSession } from '../lib/auth-storage'
import { server } from '../test/server'
import { API_URL } from './client'
import { getBills, getFinanceOverview, getProfitability } from './finance'

describe('finance date filters', () => {
  it('sends the selected range to overview, bills, and profitability', async () => {
    const requests: URL[] = []
    const capture = ({ request }: { request: Request }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json({})
    }

    server.use(
      http.get(`${API_URL}/finance/overview`, capture),
      http.get(`${API_URL}/finance/bills`, capture),
      http.get(`${API_URL}/finance/profitability`, capture),
    )
    saveSession({
      access_token: 'access-token', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z',
      membership_id: 'membership-1',
      user: { id: 'user-1', username: 'accounts', email: 'accounts@example.com', full_name: 'Accounts', is_super_admin: false },
      company: { id: 'company-1', name: 'Solar ERP', code: 'SOLAR' },
      role: 'accounts_admin', permissions: ['finance.view'],
    }, false)

    const query = new URLSearchParams({ date_from: '2026-08-01', date_to: '2026-08-31' }).toString()
    await Promise.all([getFinanceOverview(query), getBills(query), getProfitability(query)])

    expect(requests).toHaveLength(3)
    expect(requests.every((url) => url.searchParams.get('date_from') === '2026-08-01')).toBe(true)
    expect(requests.every((url) => url.searchParams.get('date_to') === '2026-08-31')).toBe(true)
  })
})
