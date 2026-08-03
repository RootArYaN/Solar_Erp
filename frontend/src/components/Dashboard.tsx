import { AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, Boxes, CheckCircle2, ClipboardCheck, FileClock, HandCoins, IndianRupee, Landmark, LoaderCircle, PackageSearch, ReceiptText, RefreshCw, SunMedium, UsersRound, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDashboardSummary } from '../api/dashboard'
import type { DashboardSummary } from '../erp-types'
import { hasPermission, PERMISSIONS } from '../lib/permissions'
import type { Session } from '../types'
import { Button } from './ui/Button'
import { KpiCard } from './ui/KpiCard'
import { useToast } from './ui/ToastProvider'
import { KpiGrid, ScrollSurface, WorkspaceHeader, WorkspacePage } from './workspace'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export function Dashboard({ session }: { session: Session }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSummary(await getDashboardSummary()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load dashboard'); toast({ message: reason instanceof Error ? reason.message : 'Could not load dashboard', variant: 'error' }) }
    finally { setLoading(false) }
  }, [toast])

  useEffect(() => { void load() }, [load])

  if (loading && !summary) return <WorkspacePage className="erp-page"><div className="erp-state"><LoaderCircle className="spin" /><strong>Loading dashboard…</strong></div></WorkspacePage>
  if (!summary) return <WorkspacePage className="erp-page"><div className="erp-state erp-state--error"><AlertCircle /><strong>{error || 'Dashboard is unavailable'}</strong><Button variant="secondary" onClick={() => void load()}>Retry</Button></div></WorkspacePage>

  const operational = [
    ['Customers', summary.total_customers, `${summary.new_customers_month} new this month`, UsersRound, '/app/customers', PERMISSIONS.customers.view],
    ['Active projects', summary.active_projects, `${summary.completed_projects} completed`, SunMedium, '/app/projects', PERMISSIONS.projects.view],
    ['Pending quotations', summary.pending_quotations, 'Need review or approval', ClipboardCheck, '/app/approvals', PERMISSIONS.quotations.approve],
    ['Documents pending', summary.pending_documents, 'Awaiting completion', FileClock, '/app/customer-documents', PERMISSIONS.documents.view],
    ['Loan approvals', summary.loan_approvals_pending, 'Customer loan files', Landmark, '/app/customers', PERMISSIONS.customers.view],
    ['Material arrivals', summary.material_arrivals_pending, 'Scheduled or in transit', PackageSearch, '/app/projects', PERMISSIONS.projects.view],
    ['Installations', summary.installations_in_progress, 'Currently in progress', Boxes, '/app/projects', PERMISSIONS.projects.view],
    ['Low stock', summary.low_stock_items, 'Items need attention', PackageSearch, '/app/inventory', PERMISSIONS.inventory.view],
  ] as const
  const financial = [
    ['Money received', summary.money_received_month, 'This month', ArrowDownLeft, '/app/finance?tab=transactions&direction=credit'],
    ['Money paid', summary.money_paid_month, 'This month', ArrowUpRight, '/app/finance?tab=transactions&direction=debit'],
    ['Expenses', summary.expenses_month, 'This month', WalletCards, '/app/finance?tab=expenses'],
    ['Customer receivables', summary.customer_receivables, 'Pending collection', HandCoins, '/app/finance?tab=bills&bill_type=sales'],
    ['Supplier payables', summary.supplier_payables, 'Pending payment', ReceiptText, '/app/finance?tab=bills&bill_type=purchase'],
  ] as const
  const canViewFinance = hasPermission(session, PERMISSIONS.finance.view)

  return <WorkspacePage className="erp-page dashboard-live">
    <WorkspaceHeader
      className="dashboard-header"
      eyebrow="Operations overview"
      title={`Good to see you, ${session.user.full_name.split(' ')[0]}.`}
      actions={
        <Button
          variant="ghost"
          size="icon"
          leadingIcon={<RefreshCw className={loading ? 'spin' : ''} size={15} />}
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
        />
      }
    />

    <KpiGrid columns={5} phoneColumns={1} responsive>
      {financial.map(([title, value, note, Icon, to]) => (
        <KpiCard
          key={title}
          icon={<Icon />}
          label={title}
          value={money.format(value)}
          note={note}
          action={canViewFinance ? <Link to={to} aria-label={`Open ${title}`}><ArrowUpRight size={13} /></Link> : undefined}
        />
      ))}
    </KpiGrid>

    <ScrollSurface className="dashboard-scroll-body">
      <section className="erp-panel"><header><div><h2>What needs attention</h2></div></header><div className="dashboard-operation-grid">{operational.map(([title, value, note, Icon, to, permission]) => {
        const allowed = hasPermission(session, permission)
        return <article key={title}><span className="dashboard-operation-icon"><Icon size={18} /></span><div><small>{title}</small><strong>{value}</strong><p>{note}</p></div>{allowed && <Link to={to} aria-label={`Open ${title}`}><ArrowUpRight size={15} /></Link>}</article>
      })}</div></section>

      <div className="erp-two-column"><section className="erp-panel"><header><div><h2>Current work</h2></div></header><div className="dashboard-status-list"><div><SunMedium /><span>Installations in progress</span><strong>{summary.installations_in_progress}</strong></div><div><BadgeIndianRupee /><span>DCR pending</span><strong>{summary.dcr_pending}</strong></div><div><IndianRupee /><span>Subsidy pending</span><strong>{summary.subsidy_pending}</strong></div><div><CheckCircle2 /><span>Completed projects</span><strong>{summary.completed_projects}</strong></div></div></section><section className="erp-panel"><header><div><h2>Your workspace</h2></div></header><div className="dashboard-status-list"><div><UsersRound /><span>Role</span><strong>{session.role.replaceAll('_', ' ')}</strong></div><div><ClipboardCheck /><span>Permissions</span><strong>{session.permissions.length}</strong></div><div><Landmark /><span>Company</span><strong>{session.company.code}</strong></div></div></section></div>
    </ScrollSurface>
  </WorkspacePage>
}
