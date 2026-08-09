import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LoginPage } from './components/LoginPage'
import { ProtectedRoute } from './components/routing/ProtectedRoute'
import { useToast } from './components/ui/ToastProvider'
import { getCurrentSession, isConfirmedSessionEnd, logout, refreshCurrentSession } from './lib/api'
import { AUTH_SESSION_EVENT, clearSession, loadSession, replaceSession, type SessionEndReason } from './lib/auth-storage'
import { getFirstAccessibleWorkspacePath, WORKSPACE_ROUTE_ACCESS } from './lib/workspace-routes'
import type { Session } from './types'

const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((module) => ({ default: module.AdminPage })))
const AgentOverviewPage = lazy(() => import('./components/agents/AgentOverviewPage').then((module) => ({ default: module.AgentOverviewPage })))
const CustomerWorkspacePage = lazy(() => import('./components/customers/CustomerWorkspacePage').then((module) => ({ default: module.CustomerWorkspacePage })))
const FinancePage = lazy(() => import('./components/finance/FinancePage').then((module) => ({ default: module.FinancePage })))
const CustomerDataUploadPage = lazy(() => import('./components/documents/CustomerDataUploadPage').then((module) => ({ default: module.CustomerDataUploadPage })))
const InventoryPage = lazy(() => import('./components/inventory/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const PosterUploadPage = lazy(() => import('./components/posters/PosterUploadPage').then((module) => ({ default: module.PosterUploadPage })))
const SolarPricingPage = lazy(() => import('./components/pricing/SolarPricingPage').then((module) => ({ default: module.SolarPricingPage })))
const ActiveDevicesPage = lazy(() => import('./components/security/ActiveDevicesPage').then((module) => ({ default: module.ActiveDevicesPage })))
const ApprovalCenterPage = lazy(() => import('./components/workflow/ApprovalCenterPage').then((module) => ({ default: module.ApprovalCenterPage })))
const ProjectTimelinePage = lazy(() => import('./components/workflow/ProjectTimelinePage').then((module) => ({ default: module.ProjectTimelinePage })))
const TaskPage = lazy(() => import('./components/tasks/TaskPage').then((module) => ({ default: module.TaskPage })))

const sessionMessages: Partial<Record<SessionEndReason, string>> = {
  expired: 'Your session expired. Sign in again to continue.',
  revoked: 'You were signed out from another device.',
  invalid: 'The saved session was invalid and has been cleared.',
}

function WorkspaceLanding({ session }: { session: Session }) {
  const destination = getFirstAccessibleWorkspacePath(session)

  if (destination === WORKSPACE_ROUTE_ACCESS.overview.path) return <Dashboard session={session} />
  if (destination) return <Navigate to={destination} replace />

  return (
    <section className="workspace-page erp-page">
      <div className="erp-state">
        <strong>No page access</strong>
        <span>Ask an administrator to give you access to at least one section.</span>
      </div>
    </section>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [authNotice, setAuthNotice] = useState('')
  const [initializationError, setInitializationError] = useState('')
  const navigate = useNavigate()
  const { toast } = useToast()

  const syncCurrentSession = useCallback(async (): Promise<Session | null> => {
    const profile = await getCurrentSession()
    return replaceSession(profile)
  }, [])

  useEffect(() => {
    function onSessionChanged(event: Event) {
      const detail = (event as CustomEvent<{ session: Session | null; reason?: SessionEndReason }>).detail
      setSession(detail.session)
      if (!detail.session && detail.reason) setAuthNotice(sessionMessages[detail.reason] ?? '')
    }
    window.addEventListener(AUTH_SESSION_EVENT, onSessionChanged)
    return () => window.removeEventListener(AUTH_SESSION_EVENT, onSessionChanged)
  }, [])

  const initializeSession = useCallback(async () => {
    setInitializing(true)
    setInitializationError('')
    const storedProfile = loadSession()
    try {
      const next = await refreshCurrentSession()
      setSession(next)
    } catch (reason) {
      if (isConfirmedSessionEnd(reason)) {
        clearSession(storedProfile ? 'expired' : 'signed_out', false)
        setSession(null)
        return
      }
      // A network outage or timeout is not proof that the refresh session is
      // invalid. Keep the token-free profile and user-scoped drafts intact.
      setSession(storedProfile)
      setInitializationError(reason instanceof Error ? reason.message : 'Could not reach the secure session service.')
    } finally {
      setInitializing(false)
    }
  }, [])

  useEffect(() => {
    void initializeSession()
    const retryWhenOnline = () => { void initializeSession() }
    window.addEventListener('online', retryWhenOnline)
    return () => window.removeEventListener('online', retryWhenOnline)
  }, [initializeSession])

  useEffect(() => {
    if (!session) return
    function refreshWhenVisible() {
      if (document.visibilityState !== 'visible') return
      void syncCurrentSession().catch(() => {
        // Network failures are handled by the next authenticated request.
      })
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible)
  }, [session, syncCurrentSession])

  function handleAuthenticated(nextSession: Session) {
    setAuthNotice('')
    setSession(nextSession)
    navigate(getFirstAccessibleWorkspacePath(nextSession) ?? '/app', { replace: true })
  }

  async function handleLogout() {
    try {
      await logout()
    } catch {
      // logout() clears local session in finally
    }
    setSession(null)
    navigate('/login', { replace: true })
    toast({ message: 'Signed out and cleared user-scoped drafts', variant: 'success' })
  }

  if (initializing) return <main className="app-boot-screen"><div className="app-boot-spinner" /><strong>Validating session…</strong></main>

  if (initializationError) return <main className="app-boot-screen app-boot-screen--error"><strong>Secure session service is unavailable</strong><p>{initializationError}</p><button type="button" className="primary-button" onClick={() => void initializeSession()}>Retry connection</button></main>

  return (
    <Suspense fallback={<main className="app-boot-screen"><div className="app-boot-spinner" /><strong>Loading page…</strong></main>}>
      <Routes>
        <Route path="/login" element={session ? <Navigate to={getFirstAccessibleWorkspacePath(session) ?? '/app'} replace /> : <LoginPage notice={authNotice} onAuthenticated={handleAuthenticated} />} />
        <Route path="/app" element={session ? <AppShell session={session} onLogout={handleLogout} /> : <Navigate to="/login" replace />}>
          <Route index element={session ? <WorkspaceLanding session={session} /> : null} />
          <Route path="customers" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.customers.permissions}><CustomerWorkspacePage session={session} /></ProtectedRoute>} />
          <Route path="administration" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.administration.permissions} mode={WORKSPACE_ROUTE_ACCESS.administration.mode}><AdminPage session={session} onSessionRefresh={syncCurrentSession} /></ProtectedRoute>} />
          <Route path="agents" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.agents.permissions}><AgentOverviewPage session={session} /></ProtectedRoute>} />
          <Route path="projects" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.projects.permissions}><ProjectTimelinePage /></ProtectedRoute>} />
          <Route path="tasks" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.tasks.permissions}><TaskPage session={session} /></ProtectedRoute>} />
          <Route path="approvals" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.approvals.permissions}><ApprovalCenterPage /></ProtectedRoute>} />
          <Route path="customer-documents" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.documents.permissions}><CustomerDataUploadPage session={session} /></ProtectedRoute>} />
          <Route path="posters" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.posters.permissions}><PosterUploadPage session={session} /></ProtectedRoute>} />
          <Route path="solar-pricing" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.pricing.permissions}><SolarPricingPage session={session} /></ProtectedRoute>} />
          <Route path="finance" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.finance.permissions}><FinancePage session={session} /></ProtectedRoute>} />
          <Route path="inventory" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.inventory.permissions}><InventoryPage session={session} /></ProtectedRoute>} />
          <Route path="security/devices" element={session && <ProtectedRoute session={session} permissions={WORKSPACE_ROUTE_ACCESS.devices.permissions}><ActiveDevicesPage session={session} /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to={session ? (getFirstAccessibleWorkspacePath(session) ?? '/app') : '/login'} replace />} />
      </Routes>
    </Suspense>
  )
}
