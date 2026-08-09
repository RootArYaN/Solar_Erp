import {
  BadgeIndianRupee,
  Bell,
  Boxes,
  ClipboardCheck,
  CheckCircle2,
  ContactRound,
  FileUp,
  ImageUp,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  LogOut,
  Menu,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Smartphone,
  Users,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { getWorkspaceNotifications } from '../api/notifications'
import { canAccessWorkspaceRoute, WORKSPACE_ROUTE_ACCESS } from '../lib/workspace-routes'
import type { Session, WorkspaceNotificationSummary } from '../types'
import { BrandMark } from './BrandMark'

type ShellPopover = 'notifications' | 'profile' | null

type NotificationRouteConfig = {
  access: (typeof WORKSPACE_ROUTE_ACCESS)[keyof typeof WORKSPACE_ROUTE_ACCESS]
  icon: typeof ClipboardCheck
}

const EMPTY_NOTIFICATIONS: WorkspaceNotificationSummary = { channels: [], total: 0 }

const notificationRouteConfig: Record<string, NotificationRouteConfig> = {
  tasks: { access: WORKSPACE_ROUTE_ACCESS.tasks, icon: ListTodo },
  approvals: { access: WORKSPACE_ROUTE_ACCESS.approvals, icon: ClipboardCheck },
  finance: { access: WORKSPACE_ROUTE_ACCESS.finance, icon: WalletCards },
  documents: { access: WORKSPACE_ROUTE_ACCESS.documents, icon: FileUp },
}

export function AppShell({ session, onLogout }: { session: Session; onLogout: () => void | Promise<void> }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [openPopover, setOpenPopover] = useState<ShellPopover>(null)
  const [notificationSummary, setNotificationSummary] = useState<WorkspaceNotificationSummary>(EMPTY_NOTIFICATIONS)
  const [notificationsUnavailable, setNotificationsUnavailable] = useState(false)
  const [desktopBrowser, setDesktopBrowser] = useState(() => window.matchMedia('(min-width: 781px)').matches)
  const [layoutView, setLayoutView] = useState<'desktop' | 'mobile'>(() => window.matchMedia('(min-width: 781px)').matches ? 'desktop' : 'mobile')
  const popoverAreaRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const isSuperAdmin = session.user.is_super_admin
  const canViewAdministration = canAccessWorkspaceRoute(session, WORKSPACE_ROUTE_ACCESS.administration)

  const links = useMemo(() => [
    { access: WORKSPACE_ROUTE_ACCESS.overview, end: true, label: 'Overview', title: 'Overview', icon: LayoutDashboard },
    { access: WORKSPACE_ROUTE_ACCESS.customers, label: 'Customers', title: 'Customer workflow', icon: UsersRound },
    { access: WORKSPACE_ROUTE_ACCESS.agents, label: 'Agents', title: 'Agents', icon: ContactRound },
    { access: WORKSPACE_ROUTE_ACCESS.projects, label: 'Projects', title: 'Project timelines', icon: ListChecks },
    { access: WORKSPACE_ROUTE_ACCESS.tasks, label: 'Tasks', title: 'Tasks and assignments', icon: ListTodo },
    { access: WORKSPACE_ROUTE_ACCESS.approvals, label: 'Approvals', title: 'Quotation and transaction approvals', icon: ClipboardCheck },
    { access: WORKSPACE_ROUTE_ACCESS.finance, label: 'Finance', title: 'Company finance', icon: WalletCards },
    { access: WORKSPACE_ROUTE_ACCESS.inventory, label: 'Inventory', title: 'Solar inventory', icon: Boxes },
    { access: WORKSPACE_ROUTE_ACCESS.documents, label: 'Documents', title: 'Customer documents', icon: FileUp },
    { access: WORKSPACE_ROUTE_ACCESS.posters, label: 'Posters', title: 'Poster upload', icon: ImageUp },
    { access: WORKSPACE_ROUTE_ACCESS.pricing, label: 'Solar pricing', title: 'Solar pricing', icon: BadgeIndianRupee },
    { access: WORKSPACE_ROUTE_ACCESS.devices, label: 'Devices', title: 'Active devices', icon: ShieldCheck },
  ], [])

  const visibleNotifications = useMemo(() => notificationSummary.channels.flatMap((channel) => {
    const config = notificationRouteConfig[channel.key]
    if (!config || !canAccessWorkspaceRoute(session, config.access) || channel.count <= 0) return []
    return [{ ...channel, ...config }]
  }), [notificationSummary.channels, session])

  const notificationCountByPath = useMemo(
    () => new Map(visibleNotifications.map((item) => [item.access.path, item.count])),
    [visibleNotifications],
  )

  const notificationTotal = useMemo(
    () => visibleNotifications.reduce((total, item) => total + item.count, 0),
    [visibleNotifications],
  )

  const refreshNotifications = useCallback((signal?: AbortSignal) => {
    void getWorkspaceNotifications(signal)
      .then((summary) => {
        setNotificationSummary(summary)
        setNotificationsUnavailable(false)
      })
      .catch(() => {
        if (!signal?.aborted) setNotificationsUnavailable(true)
      })
  }, [])

  const currentWorkspace = useMemo(() => {
    if (location.pathname === WORKSPACE_ROUTE_ACCESS.administration.path) {
      return { label: 'Users & roles', title: 'Administration' }
    }

    return links.find(({ access }) => (
      access.path === WORKSPACE_ROUTE_ACCESS.overview.path
        ? location.pathname === access.path
        : location.pathname.startsWith(access.path)
    )) ?? { label: 'Workspace', title: 'Solar ERP' }
  }, [links, location.pathname])

  useEffect(() => {
    document.body.classList.add('app-authenticated')
    return () => document.body.classList.remove('app-authenticated')
  }, [])

  useEffect(() => {
    const refresh = () => refreshNotifications()
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNotifications()
    }
    window.addEventListener('solar-erp:notifications-changed', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const interval = window.setInterval(refreshWhenVisible, 60_000)
    return () => {
      window.removeEventListener('solar-erp:notifications-changed', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.clearInterval(interval)
    }
  }, [refreshNotifications])

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

  useEffect(() => {
    const controller = new AbortController()
    setMobileOpen(false)
    setOpenPopover(null)
    refreshNotifications(controller.signal)
    return () => controller.abort()
  }, [location.pathname, refreshNotifications])

  useEffect(() => {
    function closePopover(event: MouseEvent) {
      if (!popoverAreaRef.current?.contains(event.target as Node)) setOpenPopover(null)
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenPopover(null)
        setMobileOpen(false)
      }
    }

    document.addEventListener('mousedown', closePopover)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closePopover)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

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
          {links.filter((link) => canAccessWorkspaceRoute(session, link.access)).map(({ icon: Icon, access, ...link }) => {
            const notificationCount = notificationCountByPath.get(access.path) ?? 0
            return (
              <NavLink key={access.path} to={access.path} end={'end' in link ? link.end : undefined} onClick={() => setMobileOpen(false)} title={link.title}>
                <span className="app-nav__icon"><Icon size={18} /></span>
                <span className="app-nav__label">{link.label}</span>
                {notificationCount > 0 && <span className="app-nav__notification" aria-label={`${notificationCount} ${link.label} items need attention`}>{notificationCount > 9 ? '9+' : notificationCount}</span>}
              </NavLink>
            )
          })}
          {canViewAdministration && (
            <NavLink to={WORKSPACE_ROUTE_ACCESS.administration.path} onClick={() => setMobileOpen(false)} title="Users & roles">
              <span className="app-nav__icon"><Users size={18} /></span>
              <span className="app-nav__label">Users & roles</span>
            </NavLink>
          )}
        </nav>

        <section className="sidebar-profile">
          <div className="sidebar-profile__avatar">{session.user.full_name.slice(0, 1).toUpperCase()}</div>
          <div className="sidebar-profile__copy"><strong>{session.user.full_name}</strong><span>{session.role.replaceAll('_', ' ')}</span></div>
          <button className="sidebar-logout" onClick={() => void onLogout()} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </section>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <section className="app-main">
        <header className="app-topbar">
          <div className="app-topbar__start">
            <button className="icon-button app-menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <div className="app-topbar__context">
              <strong>{currentWorkspace.label}</strong>
            </div>
          </div>

          <div className="app-topbar__actions" ref={popoverAreaRef}>
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

            <div className="shell-popover">
              <button
                type="button"
                className={`topbar-icon-button topbar-notification-button ${openPopover === 'notifications' ? 'is-active' : ''}`}
                onClick={() => setOpenPopover((current) => current === 'notifications' ? null : 'notifications')}
                aria-label={`Open notifications${notificationTotal ? `, ${notificationTotal} items need attention` : ''}`}
                aria-expanded={openPopover === 'notifications'}
                aria-haspopup="dialog"
                title="Notifications"
              >
                <Bell size={18} />
                {notificationTotal > 0 && <span className="notification-count" aria-hidden="true">{notificationTotal > 9 ? '9+' : notificationTotal}</span>}
              </button>

              {openPopover === 'notifications' && (
                <section className="shell-popover-panel notification-panel" role="dialog" aria-label="Notifications">
                  <header className="shell-popover-panel__header">
                    <div><strong>Notifications</strong></div>
                    <span className="notification-summary">{notificationTotal} active</span>
                  </header>
                  <div className="notification-panel__list">
                    {visibleNotifications.length > 0 ? visibleNotifications.map(({ access, title, detail, count, icon: Icon }) => (
                      <NavLink className="notification-channel" to={access.path} key={access.path} onClick={() => setOpenPopover(null)}>
                        <span className="notification-channel__icon"><Icon size={16} /></span>
                        <span><strong>{title}</strong><small>{detail}</small></span>
                        <i>{count > 99 ? '99+' : count}</i>
                      </NavLink>
                    )) : notificationsUnavailable
                      ? <div className="notification-panel__empty notification-panel__empty--warning"><Bell size={18} /><strong>Sync unavailable</strong><span>Open the relevant workspace to check current items.</span></div>
                      : <div className="notification-panel__empty"><CheckCircle2 size={18} /><strong>All clear</strong><span>No current action needs attention.</span></div>}
                  </div>

                </section>
              )}
            </div>

            <div className="shell-popover">
              <button
                type="button"
                className={`topbar-profile ${openPopover === 'profile' ? 'is-active' : ''}`}
                onClick={() => setOpenPopover((current) => current === 'profile' ? null : 'profile')}
                aria-label="Open profile menu"
                aria-expanded={openPopover === 'profile'}
                aria-haspopup="dialog"
              >
                <span className="topbar-profile__avatar">{session.user.full_name.slice(0, 1).toUpperCase()}</span>
                <span className="topbar-profile__copy"><strong>{session.user.full_name}</strong><small>{session.role.replaceAll('_', ' ')}</small></span>
              </button>

              {openPopover === 'profile' && (
                <section className="shell-popover-panel profile-panel" role="dialog" aria-label="Profile menu">
                  <div className="profile-panel__identity">
                    <span className="topbar-profile__avatar topbar-profile__avatar--large">{session.user.full_name.slice(0, 1).toUpperCase()}</span>
                    <span><strong>{session.user.full_name}</strong><small>{session.user.email}</small></span>
                  </div>
                  <dl className="profile-panel__meta">
                    <div><dt>Role</dt><dd>{session.role.replaceAll('_', ' ')}</dd></div>
                    <div><dt>Company</dt><dd>{session.company.name}</dd></div>
                  </dl>
                  <button type="button" className="profile-panel__logout" onClick={() => void onLogout()}><LogOut size={16} /> Sign out</button>
                </section>
              )}
            </div>
          </div>
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
