import { BadgeIndianRupee, Boxes, Building2, ContactRound, FileUp, ImageUp, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Users, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import type { Session } from '../types'
import { BrandMark } from './BrandMark'

export function AppShell({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const canViewAdministration = session.permissions.includes('users.view') && session.permissions.includes('roles.view')
  const canViewAgents = session.permissions.includes('agents.view')

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}>
      <aside className={`app-sidebar ${mobileOpen ? 'app-sidebar--open' : ''}`}>
        <div className="app-sidebar__brand">
          <BrandMark compact />
          <button
            className="sidebar-collapse-button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button className="icon-button app-sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="app-nav" aria-label="Main navigation">
          <NavLink to="/app" end onClick={() => setMobileOpen(false)} title="Overview">
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </NavLink>
          {canViewAgents && (
            <NavLink to="/app/agents" onClick={() => setMobileOpen(false)} title="Agents">
              <ContactRound size={19} />
              <span>Agents</span>
            </NavLink>
          )}
          <NavLink to="/app/inventory" onClick={() => setMobileOpen(false)} title="Solar inventory">
            <Boxes size={19} />
            <span>Inventory</span>
          </NavLink>
          <NavLink to="/app/customer-documents" onClick={() => setMobileOpen(false)} title="Customer data upload">
            <FileUp size={19} />
            <span>Customer data</span>
          </NavLink>
          <NavLink to="/app/posters" onClick={() => setMobileOpen(false)} title="Poster upload">
            <ImageUp size={19} />
            <span>Posters</span>
          </NavLink>
          <NavLink to="/app/solar-pricing" onClick={() => setMobileOpen(false)} title="Today's solar pricing">
            <BadgeIndianRupee size={19} />
            <span>Solar pricing</span>
          </NavLink>
          {canViewAdministration && (
            <NavLink to="/app/administration" onClick={() => setMobileOpen(false)} title="Users & roles">
              <Users size={19} />
              <span>Users & roles</span>
            </NavLink>
          )}
        </nav>

        <section className="sidebar-company">
          <Building2 size={18} />
          <div>
            <strong>{session.company.name}</strong>
            <span>{session.company.code}</span>
          </div>
        </section>

        <section className="sidebar-profile">
          <div className="avatar">{session.user.full_name.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-profile__copy">
            <strong>{session.user.full_name}</strong>
            <span>{session.roles[0]?.replaceAll('_', ' ') ?? 'User'}</span>
          </div>
          <button className="sidebar-logout" onClick={onLogout} aria-label="Sign out"><LogOut size={18} /></button>
        </section>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <section className="app-main">
        <header className="app-topbar">
          <button className="icon-button app-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
        </header>
        <Outlet />
      </section>
    </main>
  )
}
