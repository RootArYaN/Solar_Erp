import { useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { LoginPage } from './components/LoginPage'
import { AdminPage } from './components/admin/AdminPage'
import { AgentOverviewPage } from './components/agents/AgentOverviewPage'
import { clearSession, loadSession } from './lib/auth-storage'
import type { Session } from './types'

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const navigate = useNavigate()

  function handleAuthenticated(nextSession: Session) {
    setSession(nextSession)
    navigate('/app', { replace: true })
  }

  function handleLogout() {
    clearSession()
    setSession(null)
    navigate('/login', { replace: true })
  }

  const canViewAdministration = Boolean(session?.permissions.includes('users.view') && session?.permissions.includes('roles.view'))

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/app" replace /> : <LoginPage onAuthenticated={handleAuthenticated} />} />
      <Route path="/app" element={session ? <AppShell session={session} onLogout={handleLogout} /> : <Navigate to="/login" replace />}>
        <Route index element={session ? <Dashboard session={session} /> : null} />
        <Route path="administration" element={session && canViewAdministration ? <AdminPage session={session} /> : <Navigate to="/app" replace />} />
        <Route path="agents" element={session?.permissions.includes('agents.view') ? <AgentOverviewPage session={session} /> : <Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={session ? '/app' : '/login'} replace />} />
    </Routes>
  )
}
