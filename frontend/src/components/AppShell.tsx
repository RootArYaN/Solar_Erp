import { BadgeIndianRupee, Boxes, Building2, ClipboardCheck, ContactRound, FileUp, ImageUp, LayoutDashboard, ListChecks, LogOut, Menu, Monitor, PanelLeftClose, PanelLeftOpen, ShieldCheck, Smartphone, Users, UsersRound, WalletCards, X } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { hasAnyPermission, hasPermission, PERMISSIONS } from '../lib/permissions'
import type { Session } from '../types'
import { BrandMark } from './BrandMark'

export function AppShell({ session, onLogout }: { session: Session; onLogout: () => void | Promise<void> }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [desktopBrowser, setDesktopBrowser] = useState(() => window.matchMedia('(min-width: 781px)').matches)
  const [layoutView, setLayoutView] = useState<'desktop' | 'mobile'>(() => window.matchMedia('(min-width: 781px)').matches ? 'desktop' : 'mobile')
  const isSuperAdmin = session.user.is_super_admin
  const canViewAdministration = hasAnyPermission(session, [PERMISSIONS.users.view, PERMISSIONS.roles.view])

  useEffect(() => {
    document.body.classList.add('app-authenticated')
    return () => document.body.classList.remove('app-authenticated')
  }, [])

  useEffect(() => {
    const query = window.matchMedia('(min-width: 781px)')
    const syncBrowserWidth = () => {
      setDesktopBrowser(query.matches)
      if (!query.matches) setLayoutView('mobile')
    }
    syncBrowserWidth()
    query.addEventListener('change', syncBrowserWidth)
    return () => query.removeEventListener('change', syncBrowserWidth)
  }, [])

  useEffect(() => {
    const previewingMobile = isSuperAdmin && layoutView === 'mobile'
    document.body.classList.toggle('app-preview-mobile', previewingMobile)
    return () => document.body.classList.remove('app-preview-mobile')
  }, [isSuperAdmin, layoutView])

  const links = [
    { to: '/app', end: true, label: 'Overview', title: 'Overview', icon: LayoutDashboard, permission: PERMISSIONS.dashboard.view },
    { to: '/app/customers', label: 'Customers', title: 'Customer workflow', icon: UsersRound, permission: PERMISSIONS.customers.view },
    { to: '/app/agents', label: 'Agents', title: 'Agents', icon: ContactRound, permission: PERMISSIONS.agents.view },
    { to: '/app/projects', label: 'Projects', title: 'Project timelines', icon: ListChecks, permission: PERMISSIONS.projects.view },
    { to: '/app/approvals', label: 'Approvals', title: 'Quotation and transaction approvals', icon: ClipboardCheck, permission: PERMISSIONS.quotations.approve },
    { to: '/app/finance', label: 'Finance', title: 'Company finance', icon: WalletCards, permission: PERMISSIONS.finance.view },
    { to: '/app/inventory', label: 'Inventory', title: 'Solar inventory', icon: Boxes, permission: PERMISSIONS.inventory.view },
    { to: '/app/customer-documents', label: 'Documents', title: 'Customer documents', icon: FileUp, permission: PERMISSIONS.documents.view },
    { to: '/app/posters', label: 'Posters', title: 'Poster upload', icon: ImageUp, permission: PERMISSIONS.posters.view },
    { to: '/app/solar-pricing', label: 'Solar pricing', title: 'Solar pricing', icon: BadgeIndianRupee, permission: PERMISSIONS.pricing.view },
    { to: '/app/security/devices', label: 'Devices', title: 'Active devices', icon: ShieldCheck, permission: PERMISSIONS.security.view },
  ]

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''} ${isSuperAdmin ? `app-shell--has-view-switch app-shell--view-${layoutView}` : ''}`}>
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
      <section className="app-main">
        <header className="app-topbar">
          <button className="icon-button app-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          {isSuperAdmin && desktopBrowser && (
            <div className="layout-view-switch" role="group" aria-label="Workspace preview size">
              <span>View</span>
              <button type="button" className={layoutView === 'desktop' ? 'is-active' : ''} aria-pressed={layoutView === 'desktop'} onClick={() => { setLayoutView('desktop'); setMobileOpen(false) }} title="Desktop view">
                <Monitor size={15} /><span>Desktop</span>
              </button>
              <button type="button" className={layoutView === 'mobile' ? 'is-active' : ''} aria-pressed={layoutView === 'mobile'} onClick={() => { setLayoutView('mobile'); setSidebarCollapsed(false) }} title="Mobile view">
                <Smartphone size={15} /><span>Mobile</span>
              </button>
            </div>
          )}
        </header>
        <div className="app-viewport">
          <Suspense fallback={<RouteLoadingState />}>
            <div key={location.pathname} className="route-transition">
              <Outlet />
            </div>
          </Suspense>
        </div>
      </section>
    </main>
  )
}


function RouteLoadingState() {
  return (
    <div className="route-loading" role="status" aria-live="polite" aria-label="Loading workspace page">
      <div className="route-loading__progress" aria-hidden="true" />
      <div className="route-loading__content">
        <span className="route-loading__spinner" aria-hidden="true"><i /><i /></span>
        <span>Preparing workspace…</span>
      </div>
    </div>
  )
}
