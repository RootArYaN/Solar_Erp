import { BadgeIndianRupee, Boxes, Building2, ClipboardCheck, ContactRound, FileUp, ImageUp, LayoutDashboard, ListChecks, LogOut, Menu, Monitor, PanelLeftClose, PanelLeftOpen, ShieldCheck, Smartphone, Users, UsersRound, WalletCards, X } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { canAccessWorkspaceRoute, WORKSPACE_ROUTE_ACCESS } from '../lib/workspace-routes'
import type { Session } from '../types'
import { BrandMark } from './BrandMark'

export function AppShell({ session, onLogout }: { session: Session; onLogout: () => void | Promise<void> }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [desktopBrowser, setDesktopBrowser] = useState(() => window.matchMedia('(min-width: 781px)').matches)
  const [layoutView, setLayoutView] = useState<'desktop' | 'mobile'>(() => window.matchMedia('(min-width: 781px)').matches ? 'desktop' : 'mobile')
  const isSuperAdmin = session.user.is_super_admin
  const canViewAdministration = canAccessWorkspaceRoute(session, WORKSPACE_ROUTE_ACCESS.administration)

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
    { access: WORKSPACE_ROUTE_ACCESS.overview, end: true, label: 'Overview', title: 'Overview', icon: LayoutDashboard },
    { access: WORKSPACE_ROUTE_ACCESS.customers, label: 'Customers', title: 'Customer workflow', icon: UsersRound },
    { access: WORKSPACE_ROUTE_ACCESS.agents, label: 'Agents', title: 'Agents', icon: ContactRound },
    { access: WORKSPACE_ROUTE_ACCESS.projects, label: 'Projects', title: 'Project timelines', icon: ListChecks },
    { access: WORKSPACE_ROUTE_ACCESS.approvals, label: 'Approvals', title: 'Quotation and transaction approvals', icon: ClipboardCheck },
    { access: WORKSPACE_ROUTE_ACCESS.finance, label: 'Finance', title: 'Company finance', icon: WalletCards },
    { access: WORKSPACE_ROUTE_ACCESS.inventory, label: 'Inventory', title: 'Solar inventory', icon: Boxes },
    { access: WORKSPACE_ROUTE_ACCESS.documents, label: 'Documents', title: 'Customer documents', icon: FileUp },
    { access: WORKSPACE_ROUTE_ACCESS.posters, label: 'Posters', title: 'Poster upload', icon: ImageUp },
    { access: WORKSPACE_ROUTE_ACCESS.pricing, label: 'Solar pricing', title: 'Solar pricing', icon: BadgeIndianRupee },
    { access: WORKSPACE_ROUTE_ACCESS.devices, label: 'Devices', title: 'Active devices', icon: ShieldCheck },
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
          {links.filter((link) => canAccessWorkspaceRoute(session, link.access)).map(({ icon: Icon, access, ...link }) => (
            <NavLink key={access.path} to={access.path} end={'end' in link ? link.end : undefined} onClick={() => setMobileOpen(false)} title={link.title}><Icon size={19} /><span>{link.label}</span></NavLink>
          ))}
          {canViewAdministration && <NavLink to={WORKSPACE_ROUTE_ACCESS.administration.path} onClick={() => setMobileOpen(false)} title="Users & roles"><Users size={19} /><span>Users & roles</span></NavLink>}
        </nav>

        <section className="sidebar-profile"><div className="avatar">{session.user.full_name.slice(0, 1).toUpperCase()}</div><div className="sidebar-profile__copy"><strong>{session.user.full_name}</strong><span>{session.role.replaceAll('_', ' ')}</span></div><button className="sidebar-logout" onClick={() => void onLogout()} aria-label="Sign out"><LogOut size={18} /></button></section>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <section className="app-main">
        <header className="app-topbar">
          <button className="icon-button app-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          {isSuperAdmin && desktopBrowser && (
            <div className="layout-view-switch" role="group" aria-label="Workspace preview size">
              <button type="button" className={layoutView === 'desktop' ? 'is-active' : ''} aria-pressed={layoutView === 'desktop'} onClick={() => { setLayoutView('desktop'); setMobileOpen(false) }} title="Desktop view">
                <Monitor size={15} />
              </button>
              <button type="button" className={layoutView === 'mobile' ? 'is-active' : ''} aria-pressed={layoutView === 'mobile'} onClick={() => { setLayoutView('mobile'); setSidebarCollapsed(false) }} title="Mobile view">
                <Smartphone size={15} />
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
