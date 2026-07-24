import { Navigate } from 'react-router-dom'
import type { Session } from '../../types'
import { hasEveryPermission } from '../../lib/permissions'

export function ProtectedRoute({ session, permissions, children }: { session: Session; permissions: string[]; children: React.ReactNode }) {
  return hasEveryPermission(session, permissions) ? <>{children}</> : <Navigate to="/app?access=denied" replace />
}
