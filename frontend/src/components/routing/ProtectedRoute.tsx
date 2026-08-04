import { Navigate, useLocation } from 'react-router-dom'
import type { Session } from '../../types'
import { hasAnyPermission, hasEveryPermission } from '../../lib/permissions'
import { getNextAccessibleWorkspacePath } from '../../lib/workspace-routes'

type PermissionMode = 'all' | 'any'

export function ProtectedRoute({
  session,
  permissions,
  mode = 'all',
  children,
}: {
  session: Session
  permissions: readonly string[]
  mode?: PermissionMode
  children: React.ReactNode
}) {
  const location = useLocation()
  const allowed = mode === 'any'
    ? hasAnyPermission(session, permissions)
    : hasEveryPermission(session, permissions)

  if (allowed) return <>{children}</>

  return <Navigate to={getNextAccessibleWorkspacePath(session, location.pathname) ?? '/app'} replace />
}
