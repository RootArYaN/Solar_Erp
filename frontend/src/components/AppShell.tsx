import { BadgeIndianRupee, Boxes, Building2, ContactRound, FileUp, ImageUp, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck, Users, UsersRound, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { hasEveryPermission, hasPermission, PERMISSIONS } from '../lib/permissions'
import type { Session } from '../types'
import { BrandMark } from './BrandMark'

export function AppShell({ session, onLogout }: { session: Session; onLogout: () => void | Promise<void> }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const canViewAdministration = hasEveryPermission(session, [PERMISSIONS.users.view, PERMISSIONS.roles.view])

  const links = [
    { to: '/app', end: true, label: 'Overview', title: 'Overview', icon: LayoutDashboard, permission: PERMISSIONS.dashboard.view },
    { to: '/app/customers', label: 'Customers', title: 'Customer workflow', icon: UsersRound, permission: PERMISSIONS.customers.view },
    { to: '/app/agents', label: 'Agents', title: 'Agents', icon: ContactRound, permission: PERMISSIONS.agents.view },
    { to: '/app/inventory', label: 'Inventory', title: 'Solar inventory', icon: Boxes, permission: PERMISSIONS.inventory.view },
    { to: '/app/customer-documents', label: 'Customer data', title: 'Customer data upload', icon: FileUp, permission: PERMISSIONS.documents.view },
    { to: '/app/posters', label: 'Posters', title: 'Poster upload', icon: ImageUp, permission: PERMISSIONS.posters.view },
    { to: '/app/solar-pricing', label: 'Solar pricing', title: 'Solar pricing', icon: BadgeIndianRupee, permission: PERMISSIONS.pricing.view },
    { to: '/app/security/devices', label: 'Devices', title: 'Active devices', icon: ShieldCheck, permission: PERMISSIONS.security.view },
  ]

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}>
      <aside className={`app-sidebar ${mobileOpen ? 'app-sidebar--open' : ''}`}>
        <div className="app-sidebar__brand">
          <BrandMark compact />
          <button className="sidebar-collapse-button" onClick={() => setSidebarCollapsed((current) => !current)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button className="icon-button app-sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <nav className="app-nav" aria-label="Main navigation">
          {links.filter((link) => hasPermission(session, link.permission)).map(({ icon: Icon, ...link }) => (
            <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setMobileOpen(false)} title={link.title}><Icon size={19} /><span>{link.label}</span></NavLink>
          ))}
          {canViewAdministration && <NavLink to="/app/administration" onClick={() => setMobileOpen(false)} title="Users & roles"><Users size={19} /><span>Users & roles</span></NavLink>}
        </nav>

        <section className="sidebar-company"><Building2 size={18} /><div><strong>{session.company.name}</strong><span>{session.company.code}</span></div></section>
        <section className="sidebar-profile"><div className="avatar">{session.user.full_name.slice(0, 1).toUpperCase()}</div><div className="sidebar-profile__copy"><strong>{session.user.full_name}</strong><span>{session.role.replaceAll('_', ' ')}</span></div><button className="sidebar-logout" onClick={() => void onLogout()} aria-label="Sign out"><LogOut size={18} /></button></section>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <section className="app-main"><header className="app-topbar"><button className="icon-button app-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button></header><Outlet /></section>
    </main>
  )
}
