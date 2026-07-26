import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { LoginPage } from './components/LoginPage'
import { AdminPage } from './components/admin/AdminPage'
import { AgentOverviewPage } from './components/agents/AgentOverviewPage'
import { CustomerWorkspacePage } from './components/customers/CustomerWorkspacePage'
import { CustomerDataUploadPage } from './components/documents/CustomerDataUploadPage'
import { InventoryPage } from './components/inventory/InventoryPage'
import { PosterUploadPage } from './components/posters/PosterUploadPage'
import { SolarPricingPage } from './components/pricing/SolarPricingPage'
import { ProtectedRoute } from './components/routing/ProtectedRoute'
import { ActiveDevicesPage } from './components/security/ActiveDevicesPage'
import { ApprovalCenterPage } from './components/workflow/ApprovalCenterPage'
import { ProjectTimelinePage } from './components/workflow/ProjectTimelinePage'
import { useToast } from './components/ui/ToastProvider'
import { getCurrentSession, logout } from './lib/api'
import { AUTH_SESSION_EVENT, loadSession, type SessionEndReason } from './lib/auth-storage'
import { PERMISSIONS } from './lib/permissions'
import type { Session } from './types'

const sessionMessages: Partial<Record<SessionEndReason, string>> = {
  expired: 'Your session expired. Sign in again to continue.',
  revoked: 'This session was revoked from another device.',
  refresh_failed: 'Your secure session could not be renewed. Please sign in again.',
  invalid: 'The saved session was invalid and has been cleared.',
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [initializing, setInitializing] = useState(Boolean(loadSession()))
  const [authNotice, setAuthNotice] = useState('')
  const navigate = useNavigate()
  const { toast } = useToast()

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
    const stored = loadSession()
    if (!stored) {
      setInitializing(false)
      return
    }

    let active = true
    void getCurrentSession(stored.access_token)
      .then((profile) => {
        if (!active) return
        const refreshed = loadSession() ?? stored
        setSession({ ...refreshed, ...profile })
      })
      .catch((reason) => {
        if (!active || !loadSession()) return
        toast({ message: reason instanceof Error ? `${reason.message}. Using the saved session until connectivity returns.` : 'Could not validate the saved session.', variant: 'warning' })
      })
      .finally(() => { if (active) setInitializing(false) })

    return () => { active = false }
  }, [toast])

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
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <LoginPage notice={authNotice} onAuthenticated={handleAuthenticated} />} />
      <Route path="/app" element={session ? <AppShell session={session} onLogout={handleLogout} /> : <Navigate to="/login" replace />}>
        <Route index element={session ? <ProtectedRoute session={session} permissions={[PERMISSIONS.dashboard.view]}><Dashboard session={session} /></ProtectedRoute> : null} />
        <Route path="customers" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.customers.view]}><CustomerWorkspacePage session={session} /></ProtectedRoute>} />
        <Route path="administration" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.users.view, PERMISSIONS.roles.view]}><AdminPage session={session} /></ProtectedRoute>} />
        <Route path="agents" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.agents.view]}><AgentOverviewPage session={session} /></ProtectedRoute>} />
        <Route path="projects" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.projects.view]}><ProjectTimelinePage session={session} /></ProtectedRoute>} />
        <Route path="approvals" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.quotations.approve]}><ApprovalCenterPage session={session} /></ProtectedRoute>} />
        <Route path="customer-documents" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.documents.view]}><CustomerDataUploadPage session={session} /></ProtectedRoute>} />
        <Route path="posters" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.posters.view]}><PosterUploadPage session={session} /></ProtectedRoute>} />
        <Route path="solar-pricing" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.pricing.view]}><SolarPricingPage session={session} /></ProtectedRoute>} />
        <Route path="inventory" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.inventory.view]}><InventoryPage session={session} /></ProtectedRoute>} />
        <Route path="security/devices" element={session && <ProtectedRoute session={session} permissions={[PERMISSIONS.security.view]}><ActiveDevicesPage session={session} /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/app' : '/login'} replace />} />
    </Routes>
  )
}
