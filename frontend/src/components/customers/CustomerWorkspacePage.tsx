import {
  BadgeIndianRupee,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderKanban,
  History,
  Landmark,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createBill, createFinanceTransaction, getFinanceCategories, getFinancialAccounts, saveCustomerLoan } from '../../api/finance'
import { downloadStoredFile, uploadStoredFile } from '../../api/files'
import type { Customer, CustomerFlowSnapshot } from '../../contracts/domain-contracts'
import type { FinanceCategory, FinancialAccount } from '../../erp-types'
import { getModuleAccess } from '../../lib/permissions'
import { createCustomerFlowRepository } from '../../lib/repositories/customer-flow-repository'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, TabStrip, WorkspacePage } from '../workspace'

type Tab = 'overview' | 'projects' | 'timeline' | 'quotations' | 'documents' | 'payments' | 'loan' | 'activity'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

function revision(snapshot: CustomerFlowSnapshot | null) {
  const quotation = snapshot?.quotations[0]
  return quotation?.revisions.find((row) => row.id === quotation.current_revision_id) ?? quotation?.revisions[0] ?? null
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function customerForm(snapshot: CustomerFlowSnapshot) {
  const contact = snapshot.customer.contacts[0]
  return {
    full_name: snapshot.customer.display_name,
    phone: contact?.phone ?? '',
    alternate_phone: snapshot.customer.alternate_phone ?? contact?.alternate_phone ?? '',
    email: contact?.email ?? '',
    billing_address: snapshot.customer.billing_address ?? '',
    site_address: snapshot.customer.site_address ?? snapshot.customer.addresses[0]?.line_1 ?? '',
    district: snapshot.customer.district ?? '',
    state: snapshot.customer.state || 'Gujarat',
    postal_code: snapshot.customer.postal_code ?? '',
    consumer_number: snapshot.customer.consumer_number ?? '',
    electricity_provider: snapshot.customer.electricity_provider ?? '',
    customer_type: snapshot.customer.customer_type,
    lead_source: snapshot.customer.lead_source ?? '',
    status: snapshot.customer.status,
  }
}

export function CustomerWorkspacePage({ session }: { session: Session }) {
  const repository = useMemo(() => createCustomerFlowRepository(session.access_token), [session.access_token])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const { toast } = useToast()

  const customerAccess = getModuleAccess(session, 'customers')
  const documentAccess = getModuleAccess(session, 'documents')
  const quotationAccess = getModuleAccess(session, 'quotations')
  const financeAccess = getModuleAccess(session, 'finance')
  const currentRevision = revision(snapshot)
  const project = snapshot?.project ?? null
  const totalReceived = snapshot?.payments.filter((row) => row.direction === 'credit' && row.status === 'posted').reduce((sum, row) => sum + Number(row.amount), 0) ?? 0
  const totalRefunded = snapshot?.payments.filter((row) => row.direction === 'debit' && row.status === 'posted').reduce((sum, row) => sum + Number(row.amount), 0) ?? 0
  const approvedValue = Number(project?.approved_value ?? currentRevision?.grand_total ?? 0)
  const balance = Math.max(0, approvedValue - totalReceived + totalRefunded)

  async function loadCustomers() {
    setLoading(true)
    setError('')
    try {
      const page = await repository.listCustomers(null)
      setCustomers(page.items)
      setSelectedId((current) => current || page.items[0]?.id || '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customers')
    } finally {
      setLoading(false)
    }
  }

  async function loadSnapshot(customerId = selectedId) {
    if (!customerId) return
    setDetailLoading(true)
    setError('')
    try {
      setSnapshot(await repository.getSnapshot(customerId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customer details')
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => { void loadCustomers() }, [])
  useEffect(() => { if (selectedId) void loadSnapshot(selectedId) }, [selectedId])
  useEffect(() => {
    if (!paymentOpen) return
    void Promise.all([getFinancialAccounts(), getFinanceCategories()]).then(([nextAccounts, nextCategories]) => {
      setAccounts(nextAccounts)
      setCategories(nextCategories)
    }).catch(() => undefined)
  }, [paymentOpen])

  const visibleCustomers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((row) => `${row.display_name} ${row.record_number} ${row.consumer_number} ${row.contacts[0]?.phone ?? ''}`.toLowerCase().includes(term))
  }, [customers, search])

  async function approveQuotation() {
    if (!snapshot || !snapshot.quotations[0]) return
    setWorking(true)
    try {
      const next = await repository.approveQuotation(snapshot.customer.id, snapshot.quotations[0].id, 'Approved for B2C project conversion.')
      setSnapshot(next)
      toast({ message: 'Quotation approved and project workspace updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not approve quotation', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function saveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    setWorking(true)
    const form = new FormData(event.currentTarget)
    const input = Object.fromEntries(form.entries())
    try {
      const next = await repository.updateCustomer(snapshot.customer.id, input)
      setSnapshot(next)
      setCustomers((current) => current.map((row) => row.id === next.customer.id ? next.customer : row))
      setEditOpen(false)
      toast({ message: 'Customer details updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update customer', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get('amount') || 0)
    const direction = String(form.get('direction') || 'credit')
    setWorking(true)
    try {
      await createFinanceTransaction({
        transaction_date: form.get('transaction_date'), direction, amount,
        category_id: form.get('category_id') || null, account_id: form.get('account_id'),
        payment_method: form.get('payment_method'), party_type: 'customer', party_name: snapshot.customer.display_name,
        customer_id: snapshot.customer.id, project_id: project?.id ?? null,
        source_type: form.get('source_type'), reference_number: form.get('reference_number'), description: form.get('description'),
      })
      await loadSnapshot()
      setPaymentOpen(false)
      toast({ message: direction === 'credit' ? 'Customer payment recorded' : 'Customer refund recorded', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not record payment', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function saveLoan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!project) return
    const form = new FormData(event.currentTarget)
    const value = Object.fromEntries(form.entries()) as Record<string, unknown>
    for (const field of ['requested_amount', 'approved_amount', 'customer_contribution', 'first_disbursement_amount', 'second_disbursement_amount', 'emi_amount']) value[field] = Number(value[field] || 0)
    setWorking(true)
    try {
      await saveCustomerLoan(project.id, value)
      await loadSnapshot()
      setLoanOpen(false)
      toast({ message: 'Customer loan updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update loan', variant: 'error' })
    } finally { setWorking(false) }
  }


  async function createSalesBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    const form = new FormData(event.currentTarget)
    setWorking(true)
    try {
      await createBill({
        bill_type: 'sales', bill_number: form.get('bill_number'), bill_date: form.get('bill_date'),
        customer_id: snapshot.customer.id, project_id: project?.id ?? null,
        subtotal: Number(form.get('subtotal') || 0), tax_amount: Number(form.get('tax_amount') || 0),
        due_date: form.get('due_date') || null, note: form.get('note'),
      })
      setBillOpen(false)
      toast({ message: 'Customer sales bill created. Payment remains separate.', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not create sales bill', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function uploadDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !snapshot) return
    setWorking(true)
    try {
      await uploadStoredFile({ file, ownerType: 'customer_document', ownerId: snapshot.customer.id, customerId: snapshot.customer.id, projectId: project?.id })
      await loadSnapshot()
      toast({ message: 'Customer document uploaded', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not upload document', variant: 'error' })
    } finally {
      setWorking(false)
      event.target.value = ''
    }
  }

  if (loading) return <WorkspacePage className="customer-detail-page"><LoadingSkeleton rows={8} /></WorkspacePage>
  if (error && !snapshot) return <WorkspacePage className="customer-detail-page"><ErrorState message={error} onRetry={() => void loadCustomers()} /></WorkspacePage>

  return (
    <WorkspacePage variant="split" className="customer-detail-page">
      {(customerAccess.readOnly || documentAccess.readOnly) && <ReadOnlyNotice />}
      <div className="customer-detail-layout">
        <aside className="customer-directory">
          <header><div><strong>Customers</strong><span>{visibleCustomers.length} B2C records</span></div><button onClick={() => void loadCustomers()} aria-label="Refresh customers"><RefreshCw size={15} /></button></header>
          <label className="erp-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone or consumer no." /></label>
          <div className="customer-directory__list">
            {visibleCustomers.map((row) => <button className={selectedId === row.id ? 'active' : ''} key={row.id} onClick={() => setSelectedId(row.id)}>
              <span className="customer-avatar">{row.display_name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{row.display_name}</strong><small>{row.contacts[0]?.phone || row.record_number}</small></span>
              <em>{label(row.status)}</em>
            </button>)}
            {!visibleCustomers.length && <EmptyState title="No customers found" />}
          </div>
        </aside>

        <main className="customer-workspace">
          {detailLoading || !snapshot ? <LoadingSkeleton rows={7} /> : <>
            <header className="customer-workspace__header">
              <div className="customer-title-block"><span className="customer-title-icon">{snapshot.customer.display_name.slice(0, 1)}</span><div><div className="customer-title-meta"><span>{snapshot.customer.record_number}</span><span>{label(snapshot.customer.customer_type)}</span><span className={`status-badge status-badge--${snapshot.customer.status}`}>{label(snapshot.customer.status)}</span></div><h1>{snapshot.customer.display_name}</h1><p><Phone size={13} /> {snapshot.customer.contacts[0]?.phone || 'No phone'} <MapPin size={13} /> {snapshot.customer.site_address || 'Site address pending'}</p></div></div>
              <div className="customer-header-actions"><button className="secondary-button" onClick={() => void loadSnapshot()}><RefreshCw size={14} /> Refresh</button>{customerAccess.canEdit && <button className="primary-button primary-button--compact" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit</button>}</div>
            </header>

            <KpiGrid columns={4} className="customer-kpis">
              <article><span><FolderKanban size={16} /></span><div><small>Current project</small><strong>{project?.record_number || 'Not created'}</strong><em>{project ? `${project.capacity_kw} kW · ${label(project.payment_mode || 'mode pending')}` : 'Approve quotation to create'}</em></div></article>
              <article><span><CalendarClock size={16} /></span><div><small>Current stage</small><strong>{snapshot.timeline.find((row) => row.status === 'current')?.name || (project?.status ? label(project.status) : 'Quotation')}</strong><em>{project ? `${Math.round((snapshot.timeline.filter((row) => row.status === 'completed').length / Math.max(1, snapshot.timeline.length)) * 100)}% complete` : 'Project not started'}</em></div></article>
              <article><span><BadgeIndianRupee size={16} /></span><div><small>Approved value</small><strong>{money.format(approvedValue)}</strong><em>{currentRevision?.record_number || 'No approved quotation'}</em></div></article>
              <article><span><CheckCircle2 size={16} /></span><div><small>Received / pending</small><strong>{money.format(totalReceived)}</strong><em>{money.format(balance)} pending</em></div></article>
            </KpiGrid>

            <TabStrip className="workspace-tabs" label="Customer detail sections">
              {([
                ['overview', Building2, 'Overview'], ['projects', FolderKanban, 'Projects'], ['timeline', CalendarClock, 'Timeline'],
                ['quotations', ClipboardList, 'Quotations'], ['documents', FileText, 'Documents'], ['payments', BadgeIndianRupee, 'Payments'],
                ['loan', Landmark, 'Loan'], ['activity', History, 'Activity'],
              ] as Array<[Tab, typeof Building2, string]>).filter(([key]) => key !== 'loan' || project?.payment_mode === 'loan' || snapshot.loan).map(([key, Icon, text]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}><Icon size={14} /> {text}</button>)}
            </TabStrip>

            <section className="workspace-tab-panel" data-scroll-surface="tab-body">
              {tab === 'overview' && <OverviewTab snapshot={snapshot} />}
              {tab === 'projects' && <ProjectsTab snapshot={snapshot} />}
              {tab === 'timeline' && <TimelineTab snapshot={snapshot} />}
              {tab === 'quotations' && <QuotationsTab snapshot={snapshot} canApprove={quotationAccess.canApprove} working={working} onApprove={approveQuotation} />}
              {tab === 'documents' && <DocumentsTab snapshot={snapshot} canUpload={documentAccess.canCreate || documentAccess.canEdit} working={working} onUpload={uploadDocument} />}
              {tab === 'payments' && <PaymentsTab snapshot={snapshot} approvedValue={approvedValue} totalReceived={totalReceived} balance={balance} canManage={financeAccess.canEdit || financeAccess.canCreate} onAdd={() => setPaymentOpen(true)} onBill={() => setBillOpen(true)} />}
              {tab === 'loan' && <LoanTab snapshot={snapshot} canManage={financeAccess.canEdit} onEdit={() => setLoanOpen(true)} />}
              {tab === 'activity' && <ActivityTab snapshot={snapshot} />}
            </section>
          </>}
        </main>
      </div>

      {editOpen && snapshot && <Modal title="Edit customer" subtitle="B2C customer and installation-site details" onClose={() => setEditOpen(false)}><CustomerEditForm snapshot={snapshot} working={working} onSubmit={saveCustomer} /></Modal>}
      {paymentOpen && snapshot && <Modal title="Record customer money" subtitle="This posts once to the shared company finance ledger." onClose={() => setPaymentOpen(false)}><PaymentForm accounts={accounts} categories={categories} working={working} onSubmit={recordPayment} /></Modal>}
      {billOpen && snapshot && <Modal title="Create customer sales bill" subtitle="The bill records the receivable; payment is posted separately." onClose={() => setBillOpen(false)}><SalesBillForm approvedValue={approvedValue} working={working} onSubmit={createSalesBill} /></Modal>}
      {loanOpen && project && <Modal title="Customer solar loan" subtitle="Project-specific bank approval and disbursement details" onClose={() => setLoanOpen(false)}><LoanForm snapshot={snapshot!} working={working} onSubmit={saveLoan} /></Modal>}
    </WorkspacePage>
  )
}

function OverviewTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  const contact = snapshot.customer.contacts[0]
  const rows = [
    ['Full name', snapshot.customer.display_name], ['Phone', contact?.phone], ['Alternate phone', snapshot.customer.alternate_phone], ['Email', contact?.email],
    ['Consumer number', snapshot.customer.consumer_number], ['Electricity provider', snapshot.customer.electricity_provider], ['Customer type', label(snapshot.customer.customer_type)],
    ['Assigned agent', snapshot.customer.assigned_agent_id ? 'Assigned' : 'Unassigned'], ['Lead source', snapshot.customer.lead_source], ['Status', label(snapshot.customer.status)],
    ['Billing address', snapshot.customer.billing_address], ['Installation site', snapshot.customer.site_address], ['District / state', [snapshot.customer.district, snapshot.customer.state, snapshot.customer.postal_code].filter(Boolean).join(', ')],
    ['Created', shortDate.format(new Date(snapshot.customer.created_at))], ['Last updated', dateTime.format(new Date(snapshot.customer.updated_at))],
  ]
  return <div className="detail-grid">{rows.map(([name, value]) => <div className="detail-field" key={name}><span>{name}</span><strong>{value || '—'}</strong></div>)}</div>
}

function ProjectsTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.projects.length) return <EmptyState title="No project yet" message="Approve a quotation to create the customer project." />
  return <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Project</th><th>Site / capacity</th><th>Payment</th><th>Documentation</th><th>Material</th><th>Installation</th><th>Subsidy</th></tr></thead><tbody>{snapshot.projects.map((row) => <tr key={row.id}><td><strong>{row.record_number}</strong><small>{row.name}</small></td><td>{row.capacity_kw} kW<small>{row.site_address}</small></td><td><span className="soft-badge">{label(row.payment_mode || 'Pending')}</span></td><td>{label(row.documentation_status)}</td><td>{label(row.material_status)}</td><td>{label(row.installation_status)}</td><td>{label(row.subsidy_status)}</td></tr>)}</tbody></table></div>
}

function TimelineTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.timeline.length) return <EmptyState title="Timeline not created" message="The project timeline starts after quotation approval." />
  return <div className="customer-timeline">{snapshot.timeline.map((row) => <article className={`customer-timeline__row customer-timeline__row--${row.status}`} key={row.key}><span className="customer-timeline__marker" /><div><header><strong>{row.name}</strong><span>{label(row.status)}</span></header><p>{row.note || 'No note added.'}</p><footer>{row.event_date ? shortDate.format(new Date(row.event_date)) : row.completed_at ? dateTime.format(new Date(row.completed_at)) : 'Date pending'}{row.updated_by && ` · ${row.updated_by}`}</footer></div></article>)}</div>
}

function QuotationsTab({ snapshot, canApprove, working, onApprove }: { snapshot: CustomerFlowSnapshot; canApprove: boolean; working: boolean; onApprove: () => void }) {
  if (!snapshot.quotations.length) return <EmptyState title="No quotations" />
  return <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Quotation</th><th>Date</th><th>Capacity / title</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{snapshot.quotations.map((row, index) => { const rev = row.revisions.find((item) => item.id === row.current_revision_id) ?? row.revisions[0]; return <tr key={row.id}><td><strong>{row.record_number}</strong><small>{rev?.record_number}</small></td><td>{shortDate.format(new Date(row.created_at))}</td><td>{row.title}</td><td>{money.format(Number(rev?.grand_total ?? 0))}</td><td><span className="soft-badge">{label(rev?.status || 'draft')}</span></td><td>{index === 0 && canApprove && rev?.status === 'submitted' && <button className="primary-button primary-button--compact" disabled={working} onClick={onApprove}>Approve</button>}</td></tr> })}</tbody></table></div>
}

function DocumentsTab({ snapshot, canUpload, working, onUpload }: { snapshot: CustomerFlowSnapshot; canUpload: boolean; working: boolean; onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void }) {
  return <><div className="tab-toolbar"><div><strong>Customer documents</strong><span>{snapshot.documents.length} stored files</span></div>{canUpload && <label className="primary-button primary-button--compact"><Upload size={14} /> Upload<input hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" disabled={working} onChange={onUpload} /></label>}</div>{!snapshot.documents.length ? <EmptyState title="No documents uploaded" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Document</th><th>Type</th><th>Project</th><th>Status</th><th>Uploaded</th><th /></tr></thead><tbody>{snapshot.documents.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{label(row.owner_type)}</td><td>{row.project_id ? 'Linked' : 'Customer'}</td><td><span className="soft-badge">{label(row.status)}</span></td><td>{shortDate.format(new Date(row.created_at))}</td><td><button className="secondary-button" onClick={() => void downloadStoredFile(row.id, row.name)}>Download</button></td></tr>)}</tbody></table></div>}</>
}

function PaymentsTab({ snapshot, approvedValue, totalReceived, balance, canManage, onAdd, onBill }: { snapshot: CustomerFlowSnapshot; approvedValue: number; totalReceived: number; balance: number; canManage: boolean; onAdd: () => void; onBill: () => void }) {
  return <><section className="mini-kpis"><article><span>Approved</span><strong>{money.format(approvedValue)}</strong></article><article><span>Received</span><strong>{money.format(totalReceived)}</strong></article><article><span>Pending</span><strong>{money.format(balance)}</strong></article><article><span>Entries</span><strong>{snapshot.payments.length}</strong></article></section><div className="tab-toolbar"><div><strong>Customer money</strong><span>Shared with company finance—no duplicate ledger.</span></div>{canManage && <div><button className="secondary-button" onClick={onBill}><FileText size={14} /> Sales bill</button><button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Record money</button></div>}</div>{!snapshot.payments.length ? <EmptyState title="No customer transactions" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Date</th><th>Transaction</th><th>Description</th><th>Account</th><th>Money in</th><th>Money out</th><th>Status</th></tr></thead><tbody>{snapshot.payments.map((row) => <tr key={row.id}><td>{shortDate.format(new Date(row.transaction_date))}</td><td><strong>{row.transaction_number}</strong><small>{row.reference_number}</small></td><td>{row.description || label(row.source_type)}</td><td>{row.account_name}<small>{label(row.payment_method)}</small></td><td className="money-in">{row.direction === 'credit' ? money.format(Number(row.amount)) : '—'}</td><td className="money-out">{row.direction === 'debit' ? money.format(Number(row.amount)) : '—'}</td><td>{label(row.status)}</td></tr>)}</tbody></table></div>}</>
}

function LoanTab({ snapshot, canManage, onEdit }: { snapshot: CustomerFlowSnapshot; canManage: boolean; onEdit: () => void }) {
  const loan = snapshot.loan
  return <><div className="tab-toolbar"><div><strong>Customer solar loan</strong><span>Separate from company borrowing.</span></div>{canManage && snapshot.project && <button className="primary-button primary-button--compact" onClick={onEdit}><Pencil size={14} /> {loan ? 'Update' : 'Create'} loan</button>}</div>{!loan ? <EmptyState title="No customer loan record" message="Create it only when the project uses loan payment mode." /> : <div className="detail-grid">{[
    ['Bank', loan.bank_name], ['Application number', loan.application_number], ['Requested', money.format(Number(loan.requested_amount))], ['Approved', money.format(Number(loan.approved_amount))],
    ['Customer contribution', money.format(Number(loan.customer_contribution))], ['Application status', label(loan.application_status)], ['Documents', label(loan.documentation_status)],
    ['First disbursement', money.format(Number(loan.first_disbursement_amount))], ['Second disbursement', money.format(Number(loan.second_disbursement_amount))], ['EMI', money.format(Number(loan.emi_amount))], ['Loan status', label(loan.loan_status)], ['Note', loan.note],
  ].map(([name, value]) => <div className="detail-field" key={name}><span>{name}</span><strong>{value || '—'}</strong></div>)}</div>}</>
}

function ActivityTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.activity.length) return <EmptyState title="No activity yet" />
  return <div className="activity-list">{snapshot.activity.map((row) => <article key={row.id}><span><History size={14} /></span><div><strong>{label(row.event.replace('.', ' '))}</strong><p>{label(row.entity)}{row.project_id ? ' · Project linked' : ''}</p><time>{dateTime.format(new Date(row.created_at))} · {label(row.user_role)}</time></div></article>)}</div>
}

function CustomerEditForm({ snapshot, working, onSubmit }: { snapshot: CustomerFlowSnapshot; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const form = customerForm(snapshot)
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid">
    <label><span>Full name</span><input name="full_name" defaultValue={form.full_name} required /></label><label><span>Customer type</span><select name="customer_type" defaultValue={form.customer_type}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="society">Society</option><option value="institutional">Institutional</option></select></label>
    <label><span>Phone</span><input name="phone" defaultValue={form.phone} required /></label><label><span>Alternate phone</span><input name="alternate_phone" defaultValue={form.alternate_phone} /></label>
    <label><span>Email</span><input name="email" type="email" defaultValue={form.email} /></label><label><span>Consumer number</span><input name="consumer_number" defaultValue={form.consumer_number} /></label>
    <label><span>Electricity provider</span><input name="electricity_provider" defaultValue={form.electricity_provider} /></label><label><span>Lead source</span><input name="lead_source" defaultValue={form.lead_source} /></label>
    <label className="erp-form-wide"><span>Installation site</span><textarea name="site_address" defaultValue={form.site_address} /></label><label className="erp-form-wide"><span>Billing address</span><textarea name="billing_address" defaultValue={form.billing_address} /></label>
    <label><span>District</span><input name="district" defaultValue={form.district} /></label><label><span>State</span><input name="state" defaultValue={form.state} /></label><label><span>Postal code</span><input name="postal_code" defaultValue={form.postal_code} /></label><label><span>Status</span><select name="status" defaultValue={form.status}><option value="lead">Lead</option><option value="registered">Registered</option><option value="quotation_requested">Quotation requested</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select></label>
  </div><footer className="erp-form-actions"><button type="submit" className="primary-button" disabled={working}>Save customer</button></footer></form>
}

function PaymentForm({ accounts, categories, working, onSubmit }: { accounts: FinancialAccount[]; categories: FinanceCategory[]; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label><span>Direction</span><select name="direction"><option value="credit">Money in</option><option value="debit">Refund / money out</option></select></label><label><span>Amount</span><input type="number" min="0.01" step="0.01" name="amount" required /></label><label><span>Account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Category</span><select name="category_id"><option value="">No category</option>{categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Payment method</span><select name="payment_method"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Type</span><select name="source_type"><option value="customer_payment">Customer payment</option><option value="customer_advance">Advance</option><option value="loan_disbursement">Loan disbursement</option><option value="subsidy_received">Subsidy received</option><option value="customer_refund">Refund</option></select></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Description</span><input name="description" placeholder="Short payment note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working || !accounts.length}>Post transaction</button></footer></form>
}

function LoanForm({ snapshot, working, onSubmit }: { snapshot: CustomerFlowSnapshot; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const loan = snapshot.loan
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Bank</span><input name="bank_name" defaultValue={loan?.bank_name} /></label><label><span>Application number</span><input name="application_number" defaultValue={loan?.application_number} /></label><label><span>Requested amount</span><input type="number" name="requested_amount" defaultValue={loan?.requested_amount ?? 0} /></label><label><span>Approved amount</span><input type="number" name="approved_amount" defaultValue={loan?.approved_amount ?? 0} /></label><label><span>Customer contribution</span><input type="number" name="customer_contribution" defaultValue={loan?.customer_contribution ?? 0} /></label><label><span>Application status</span><select name="application_status" defaultValue={loan?.application_status ?? 'draft'}>{['draft','applied','documents_pending','submitted_to_bank','under_review','conditionally_approved','approved','rejected','cancelled'].map((row) => <option key={row}>{row}</option>)}</select></label><label><span>Document status</span><select name="documentation_status" defaultValue={loan?.documentation_status ?? 'pending'}><option>pending</option><option>submitted</option><option>approved</option><option>rejected</option></select></label><label><span>Loan status</span><select name="loan_status" defaultValue={loan?.loan_status ?? 'draft'}>{['draft','applied','documents_pending','submitted_to_bank','under_review','conditionally_approved','approved','partially_disbursed','fully_disbursed','rejected','cancelled'].map((row) => <option key={row}>{row}</option>)}</select></label><label><span>First disbursement</span><input type="number" name="first_disbursement_amount" defaultValue={loan?.first_disbursement_amount ?? 0} /></label><label><span>Second disbursement</span><input type="number" name="second_disbursement_amount" defaultValue={loan?.second_disbursement_amount ?? 0} /></label><label><span>EMI amount</span><input type="number" name="emi_amount" defaultValue={loan?.emi_amount ?? 0} /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" defaultValue={loan?.note} /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Save loan</button></footer></form>
}


function SalesBillForm({ approvedValue, working, onSubmit }: { approvedValue: number; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Bill number</span><input name="bill_number" required /></label><label><span>Bill date</span><input type="date" name="bill_date" defaultValue={today} required /></label><label><span>Due date</span><input type="date" name="due_date" /></label><label><span>Subtotal</span><input type="number" name="subtotal" min="0" step="0.01" defaultValue={approvedValue} required /></label><label><span>Tax</span><input type="number" name="tax_amount" min="0" step="0.01" defaultValue="0" /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Create sales bill</button></footer></form>
}
