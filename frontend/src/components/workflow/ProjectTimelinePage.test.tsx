import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { API_URL } from '../../api/client'
import { server } from '../../test/server'
import type { AuthSessionResponse, ProjectTimeline, ProjectTimelineListItem, Session } from '../../types'
import { saveSession } from '../../lib/auth-storage'
import { ToastProvider } from '../ui/ToastProvider'
import { ProjectTimelinePage } from './ProjectTimelinePage'

const session: Session = {
  membership_id: 'membership-1',
  user: { id: 'user-1', username: 'viewer', email: 'viewer@example.com', full_name: 'Project Viewer', is_super_admin: false },
  company: { id: 'company-1', name: 'Solar ERP', code: 'SOLAR' },
  role: 'viewer',
  permissions: ['projects.view'],
}

function listItem(currentStepName: string): ProjectTimelineListItem {
  return {
    project_id: 'project-1',
    customer_id: 'customer-1',
    project_number: 'PRJ-001',
    project_name: '3.4 kW rooftop solar',
    customer_name: 'Asha Patel',
    customer_phone: '9876543210',
    project_status: 'in_progress',
    payment_mode: 'cash',
    current_step: 'documents_uploaded',
    current_step_name: currentStepName,
    progress: currentStepName === 'Documents uploaded' ? 25 : 35,
    updated_at: '2026-07-28T10:00:00Z',
  }
}

function timeline(currentStepName: string): ProjectTimeline {
  return {
    ...listItem(currentStepName),
    capacity_kw: 3.4,
    approved_value: 318000,
    can_manage: false,
    steps: [{
      key: 'documents_uploaded',
      name: currentStepName,
      status: 'current',
      completed_at: null,
      completed_by: '',
      note: '',
      event_date: null,
      locked: false,
    }],
  }
}

describe('ProjectTimelinePage refresh', () => {
  it('reloads both the project list and selected timeline without cache', async () => {
    let listRequests = 0
    let detailRequests = 0

    server.use(
      http.get(`${API_URL}/workflow/projects/timelines`, ({ request }) => {
        listRequests += 1
        expect(request.cache).toBe('no-store')
        return HttpResponse.json([listItem(listRequests === 1 ? 'Documents uploaded' : 'Documents approved')])
      }),
      http.get(`${API_URL}/workflow/projects/project-1/timeline`, ({ request }) => {
        detailRequests += 1
        expect(request.cache).toBe('no-store')
        return HttpResponse.json(timeline(detailRequests === 1 ? 'Documents uploaded' : 'Documents approved'))
      }),
    )

    saveSession({ ...session, access_token: 'access-token', token_type: 'bearer', expires_at: '2099-08-01T00:00:00Z' } satisfies AuthSessionResponse, false)
    render(<ToastProvider><ProjectTimelinePage session={session} /></ToastProvider>)

    expect(await screen.findByRole('heading', { name: 'Asha Patel' })).toBeInTheDocument()
    expect(screen.getAllByText('Documents uploaded').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh projects and selected timeline' }))

    await waitFor(() => {
      expect(listRequests).toBe(2)
      expect(detailRequests).toBe(2)
      expect(screen.getAllByText('Documents approved').length).toBeGreaterThan(0)
    })
  })
})
