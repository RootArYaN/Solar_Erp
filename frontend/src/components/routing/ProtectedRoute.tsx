import { Navigate } from 'react-router-dom'
import type { Session } from '../../types'
import { hasAnyPermission, hasEveryPermission } from '../../lib/permissions'

type PermissionMode = 'all' | 'any'

export function ProtectedRoute({
  session,
  permissions,
  mode = 'all',
  children,
}: {
  session: Session
  permissions: string[]
  mode?: PermissionMode
  children: React.ReactNode
}) {
  const allowed = mode === 'any'
    ? hasAnyPermission(session, permissions)
    : hasEveryPermission(session, permissions)

  return allowed ? <>{children}</> : <Navigate to="/app?access=denied" replace />
}
