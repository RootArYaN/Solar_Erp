import type { Session } from '../types'
import { hasAnyPermission, hasEveryPermission, PERMISSIONS } from './permissions'

export type WorkspaceRouteAccess = {
  path: string
  permissions: readonly string[]
  mode?: 'all' | 'any'
}

export const WORKSPACE_ROUTE_ACCESS = {
  overview: { path: '/app', permissions: [PERMISSIONS.dashboard.view] },
  customers: { path: '/app/customers', permissions: [PERMISSIONS.customers.view] },
  agents: { path: '/app/agents', permissions: [PERMISSIONS.agents.view] },
  projects: { path: '/app/projects', permissions: [PERMISSIONS.projects.view] },
  tasks: { path: '/app/tasks', permissions: [PERMISSIONS.tasks.view] },
  approvals: { path: '/app/approvals', permissions: [PERMISSIONS.quotations.approve] },
  finance: { path: '/app/finance', permissions: [PERMISSIONS.finance.view] },
  inventory: { path: '/app/inventory', permissions: [PERMISSIONS.inventory.view] },
  documents: { path: '/app/customer-documents', permissions: [PERMISSIONS.documents.view] },
  posters: { path: '/app/posters', permissions: [PERMISSIONS.posters.view] },
  pricing: { path: '/app/solar-pricing', permissions: [PERMISSIONS.pricing.view] },
  devices: { path: '/app/security/devices', permissions: [PERMISSIONS.security.view] },
  administration: {
    path: '/app/administration',
    permissions: [PERMISSIONS.users.view, PERMISSIONS.roles.view],
    mode: 'any',
  },
} as const satisfies Record<string, WorkspaceRouteAccess>

// This order mirrors the sidebar. A user whose current page becomes hidden is
// moved forward through this list, wrapping to the beginning when necessary.
export const WORKSPACE_ROUTES: readonly WorkspaceRouteAccess[] = [
  WORKSPACE_ROUTE_ACCESS.overview,
  WORKSPACE_ROUTE_ACCESS.customers,
  WORKSPACE_ROUTE_ACCESS.agents,
  WORKSPACE_ROUTE_ACCESS.projects,
  WORKSPACE_ROUTE_ACCESS.tasks,
  WORKSPACE_ROUTE_ACCESS.approvals,
  WORKSPACE_ROUTE_ACCESS.finance,
  WORKSPACE_ROUTE_ACCESS.inventory,
  WORKSPACE_ROUTE_ACCESS.documents,
  WORKSPACE_ROUTE_ACCESS.posters,
  WORKSPACE_ROUTE_ACCESS.pricing,
  WORKSPACE_ROUTE_ACCESS.devices,
  WORKSPACE_ROUTE_ACCESS.administration,
]

export function canAccessWorkspaceRoute(session: Session, route: WorkspaceRouteAccess): boolean {
  return route.mode === 'any'
    ? hasAnyPermission(session, route.permissions)
    : hasEveryPermission(session, route.permissions)
}

export function getFirstAccessibleWorkspacePath(session: Session): string | null {
  return WORKSPACE_ROUTES.find((route) => canAccessWorkspaceRoute(session, route))?.path ?? null
}

export function getNextAccessibleWorkspacePath(session: Session, currentPath: string): string | null {
  const normalizedPath = currentPath.replace(/\/$/, '') || '/'
  const currentIndex = WORKSPACE_ROUTES.findIndex((route) => route.path === normalizedPath)

  if (currentIndex < 0) return getFirstAccessibleWorkspacePath(session)

  for (let offset = 1; offset <= WORKSPACE_ROUTES.length; offset += 1) {
    const route = WORKSPACE_ROUTES[(currentIndex + offset) % WORKSPACE_ROUTES.length]
    if (canAccessWorkspaceRoute(session, route)) return route.path
  }

  return null
}
