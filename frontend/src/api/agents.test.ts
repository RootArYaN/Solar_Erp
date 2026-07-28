import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
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

    await getAgents('access-token')
    await getAgentOverview('access-token', 'membership-1')

    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.cache === 'no-store')).toBe(true)
    expect(requests.every((request) => request.headers.get('authorization') === 'Bearer access-token')).toBe(true)
  })
})
