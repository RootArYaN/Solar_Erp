import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import {
  canAccessWorkspaceRoute,
  getFirstAccessibleWorkspacePath,
  getNextAccessibleWorkspacePath,
  WORKSPACE_ROUTE_ACCESS,
  WORKSPACE_ROUTES,
} from './workspace-routes'

const baseSession: Session = {
  membership_id: 'm1',
  user: {
    id: 'u1',
    username: 'user',
    email: 'user@example.com',
    full_name: 'User',
    is_super_admin: false,
  },
  company: { id: 'c1', name: 'Company', code: 'CO' },
  role: 'viewer',
  permissions: [],
}

function sessionWith(...permissions: string[]): Session {
  return { ...baseSession, permissions }
}

describe('workspace route access', () => {
  it('uses the same order as the sidebar', () => {
    expect(WORKSPACE_ROUTES.map((route) => route.path)).toEqual([
      '/app',
      '/app/customers',
      '/app/agents',
      '/app/projects',
      '/app/approvals',
      '/app/finance',
      '/app/inventory',
      '/app/customer-documents',
      '/app/posters',
      '/app/solar-pricing',
      '/app/security/devices',
      '/app/administration',
    ])
  })

  it('lands on the first visible workspace when overview is hidden', () => {
    expect(getFirstAccessibleWorkspacePath(sessionWith('agents.view', 'projects.view'))).toBe('/app/agents')
  })

  it('advances from a hidden route to the next visible workspace', () => {
    expect(getNextAccessibleWorkspacePath(sessionWith('projects.view'), '/app/customers')).toBe('/app/projects')
  })

  it('wraps to an earlier visible workspace when no later route is available', () => {
    expect(getNextAccessibleWorkspacePath(sessionWith('dashboard.view'), '/app/security/devices')).toBe('/app')
  })

  it('allows administration with either users or roles access', () => {
    expect(canAccessWorkspaceRoute(sessionWith('roles.view'), WORKSPACE_ROUTE_ACCESS.administration)).toBe(true)
    expect(canAccessWorkspaceRoute(sessionWith('users.view'), WORKSPACE_ROUTE_ACCESS.administration)).toBe(true)
  })

  it('returns no destination when every workspace is hidden', () => {
    expect(getFirstAccessibleWorkspacePath(baseSession)).toBeNull()
    expect(getNextAccessibleWorkspacePath(baseSession, '/app/customers')).toBeNull()
  })

  it('gives super admins access to the overview without explicit permissions', () => {
    const superAdmin = { ...baseSession, user: { ...baseSession.user, is_super_admin: true } }
    expect(getFirstAccessibleWorkspacePath(superAdmin)).toBe('/app')
  })
})
