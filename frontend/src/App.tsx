import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { LoginPage } from './components/LoginPage'
import { ProtectedRoute } from './components/routing/ProtectedRoute'
import { useToast } from './components/ui/ToastProvider'
import { ApiError, getCurrentSession, logout, refreshCurrentSession } from './lib/api'
import { AUTH_SESSION_EVENT, loadSession, replaceSession, type SessionEndReason } from './lib/auth-storage'
import { PERMISSIONS } from './lib/permissions'
import type { Session } from './types'

const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })))
const AdminPage = lazy(() => import('./components/admin/AdminPage').then((module) => ({ default: module.AdminPage })))
const DataArchivePage = lazy(() => import('./components/archive/DataArchivePage').then((module) => ({ default: module.DataArchivePage })))
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

const sessionMessages: Partial<Record<SessionEndReason, string>> = {
  expired: 'Your session expired. Sign in again to continue.',
  revoked: 'This session was revoked from another device.',
  refresh_failed: 'Your secure session could not be renewed. Please sign in again.',
  invalid: 'The saved session was invalid and has been cleared.',
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [initializing, setInitializing] = useState(true)
  const [authNotice, setAuthNotice] = useState('')
  const navigate = useNavigate()
  const { toast } = useToast()

  const syncCurrentSession = useCallback(async (): Promise<Session | null> => {
    const current = loadSession()
    if (!current) return null
    const profile = await getCurrentSession(current.access_token)
    const latest = loadSession() ?? current
    const nextSession = { ...latest, ...profile } as Session
    replaceSession(nextSession)
    return nextSession
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

  useEffect(() => {
    let active = true
    const stored = loadSession()
    const task = stored ? syncCurrentSession() : refreshCurrentSession()

    void task
      .then((next) => { if (active && next) setSession(next) })
      .catch((reason) => {
        if (!active) return
        if (stored && !(reason instanceof ApiError && reason.status === 401)) {
          toast({ message: reason instanceof Error ? `${reason.message}. Using the saved session until connectivity returns.` : 'Could not validate the saved session.', variant: 'warning' })
          setSession(stored)
        }
      })
      .finally(() => { if (active) setInitializing(false) })
    return () => { active = false }
  }, [syncCurrentSession, toast])

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
    navigate('/app', { replace: true })
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

  return (
    <Suspense fallback={<main className="app-boot-screen"><div className="app-boot-spinner" /><strong>Loading page…</strong></main>}>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/app" replace /> : <LoginPage notice={authNotice} onAuthenticated={handleAuthenticated} />} />
        <Route path="/app" element={session ? <AppShell session={session} onLogout={handleLogout} /> : <Navigate to="/login" replace />}>
          <Route index element={session ? <ProtectedRoute session={session} permissions={[PERMISSIONS.dashboard.view]}><Dashboard session={session} /></ProtectedRoute> : null} />
          <Route path="customers" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.customers.view]}><CustomerWorkspacePage session={session} /></ProtectedRoute>} />
          <Route path="administration" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.users.view, PERMISSIONS.roles.view]} mode="any"><AdminPage session={session} onSessionRefresh={syncCurrentSession} /></ProtectedRoute>} />
          <Route path="agents" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.agents.view]}><AgentOverviewPage session={session} /></ProtectedRoute>} />
          <Route path="projects" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.projects.view]}><ProjectTimelinePage session={session} /></ProtectedRoute>} />
          <Route path="approvals" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.quotations.approve]}><ApprovalCenterPage session={session} /></ProtectedRoute>} />
          <Route path="customer-documents" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.documents.view]}><CustomerDataUploadPage session={session} /></ProtectedRoute>} />
          <Route path="posters" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.posters.view]}><PosterUploadPage session={session} /></ProtectedRoute>} />
          <Route path="solar-pricing" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.pricing.view]}><SolarPricingPage session={session} /></ProtectedRoute>} />
          <Route path="finance" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.finance.view]}><FinancePage session={session} /></ProtectedRoute>} />
          <Route path="inventory" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.inventory.view]}><InventoryPage session={session} /></ProtectedRoute>} />
          <Route path="security/devices" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.security.view]}><ActiveDevicesPage session={session} /></ProtectedRoute>} />
          <Route path="archives" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.archive.view]}><DataArchivePage session={session} /></ProtectedRoute>} />
        </Route>
        <Route path="*" element={<Navigate to={session ? '/app' : '/login'} replace />} />
      </Routes>
    </Suspense>
  )
}
