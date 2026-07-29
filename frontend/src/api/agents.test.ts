import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { saveSession } from '../lib/auth-storage'
import { server } from '../test/server'
import { API_URL } from './client'
import { getAgentOverview, getAgents } from './agents'

describe('agent refresh requests', () => {
  it('reloads the agent list and overview without using cached responses', async () => {
    const requests: Request[] = []

    server.use(
      http.get(`${API_URL}/agents`, ({ request }) => {
        requests.push(request)
        return HttpResponse.json([])
      }),
      http.get(`${API_URL}/agents/membership-1/overview`, ({ request }) => {
        requests.push(request)
        return HttpResponse.json({})
      }),
    )

    saveSession({
      access_token: 'access-token', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z',
      membership_id: 'membership-1',
      user: { id: 'user-1', username: 'agent', email: 'agent@example.com', full_name: 'Agent', is_super_admin: false },
      company: { id: 'company-1', name: 'Solar ERP', code: 'SOLAR' },
      role: 'agent', permissions: ['agents.view'],
    }, false)
    await getAgents()
    await getAgentOverview('membership-1')

    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.cache === 'no-store')).toBe(true)
    expect(requests.every((request) => request.headers.get('authorization') === 'Bearer access-token')).toBe(true)
  })
})
