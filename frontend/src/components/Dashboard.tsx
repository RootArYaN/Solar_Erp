import { AlertCircle, ArrowDownLeft, ArrowUpRight, BadgeIndianRupee, Boxes, CheckCircle2, ClipboardCheck, FileClock, HandCoins, IndianRupee, Landmark, LoaderCircle, PackageSearch, ReceiptText, RefreshCw, SunMedium, UsersRound, WalletCards } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDashboardSummary } from '../api/dashboard'
import type { DashboardSummary } from '../erp-types'
import { hasPermission, PERMISSIONS } from '../lib/permissions'
import type { Session } from '../types'
import { useToast } from './ui/ToastProvider'

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

  if (loading && !summary) return <section className="erp-page"><div className="erp-state"><LoaderCircle className="spin" /><strong>Loading live business summary…</strong></div></section>
  if (!summary) return <section className="erp-page"><div className="erp-state erp-state--error"><AlertCircle /><strong>{error || 'Dashboard is unavailable'}</strong><button className="secondary-button" onClick={() => void load()}>Retry</button></div></section>

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

  return <section className="erp-page dashboard-live">
    <header className="erp-page-head"><div><span>Operations overview</span><h1>Good to see you, {session.user.full_name.split(' ')[0]}.</h1></div><button className="secondary-button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={15} /> Refresh</button></header>

    <div className="erp-kpi-grid erp-kpi-grid--finance">
      <article><ArrowDownLeft /><span>Money received</span><strong>{money.format(summary.money_received_month)}</strong><small>This month</small></article>
      <article><ArrowUpRight /><span>Money paid</span><strong>{money.format(summary.money_paid_month)}</strong><small>This month</small></article>
      <article><WalletCards /><span>Expenses</span><strong>{money.format(summary.expenses_month)}</strong><small>This month</small></article>
      <article><HandCoins /><span>Customer receivables</span><strong>{money.format(summary.customer_receivables)}</strong><small>Pending collection</small></article>
      <article><ReceiptText /><span>Supplier payables</span><strong>{money.format(summary.supplier_payables)}</strong><small>Pending payment</small></article>
    </div>

    <section className="erp-panel"><header><div><span>Workflow pulse</span><h2>What needs attention</h2></div></header><div className="dashboard-operation-grid">{operational.map(([title, value, note, Icon, to, permission]) => {
      const allowed = hasPermission(session, permission)
      return <article key={title}><span className="dashboard-operation-icon"><Icon size={18} /></span><div><small>{title}</small><strong>{value}</strong><p>{note}</p></div>{allowed && <Link to={to} aria-label={`Open ${title}`}><ArrowUpRight size={15} /></Link>}</article>
    })}</div></section>

    <div className="erp-two-column"><section className="erp-panel"><header><div><span>Project pipeline</span><h2>Current work</h2></div></header><div className="dashboard-status-list"><div><SunMedium /><span>Installations in progress</span><strong>{summary.installations_in_progress}</strong></div><div><BadgeIndianRupee /><span>DCR pending</span><strong>{summary.dcr_pending}</strong></div><div><IndianRupee /><span>Subsidy pending</span><strong>{summary.subsidy_pending}</strong></div><div><CheckCircle2 /><span>Completed projects</span><strong>{summary.completed_projects}</strong></div></div></section><section className="erp-panel"><header><div><span>Access</span><h2>Your workspace</h2></div></header><div className="dashboard-status-list"><div><UsersRound /><span>Role</span><strong>{session.role.replaceAll('_', ' ')}</strong></div><div><ClipboardCheck /><span>Permissions</span><strong>{session.permissions.length}</strong></div><div><Landmark /><span>Company</span><strong>{session.company.code}</strong></div></div></section></div>
  </section>
}
