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
  MoreHorizontal,
  Pencil,
  Phone,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createBill, createFinanceTransaction, getFinanceCategories, getFinancialAccounts, reverseFinanceTransaction, saveCustomerLoan, updateFinanceTransaction } from '../../api/finance'
import { uploadStoredFile } from '../../api/files'
import type { Customer, CustomerFlowSnapshot, CustomerPayment } from '../../contracts/domain-contracts'
import type { FinanceCategory, FinancialAccount } from '../../erp-types'
import { fileUploadRules, validateUploadFile } from '../../lib/file-validation'
import { getModuleAccess } from '../../lib/permissions'
import { createCustomerFlowRepository, type CustomerDependencyPreview } from '../../lib/repositories/customer-flow-repository'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { ActionBar } from '../ui/ActionBar'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { KpiCard } from '../ui/KpiCard'
import { Pagination } from '../ui/Pagination'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, TabButton, TabStrip, WorkspacePage } from '../workspace'
import { ActivityTab, DocumentsTab, LoanTab, OverviewTab, PaymentsTab, ProjectsTab, QuotationsTab, TimelineTab } from './CustomerWorkspaceTabs'
import { CustomerEditForm, LoanForm, PaymentForm, SalesBillForm } from './CustomerWorkspaceForms'
import { label, money, revision } from './customer-workspace-utils'

type Tab = 'overview' | 'projects' | 'timeline' | 'quotations' | 'documents' | 'payments' | 'loan' | 'activity'
type PaymentFilter = 'all' | 'loan' | 'cash' | 'remaining'
type StatusFilter = 'current' | 'completed' | 'archived' | 'deleted'
type LifecycleAction = 'complete' | 'reactivate' | 'archive' | 'delete' | 'restore' | 'purge'



export function CustomerWorkspacePage({ session }: { session: Session }) {
  const repository = useMemo(() => createCustomerFlowRepository(), [])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current')
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [customerPage, setCustomerPage] = useState(1)
  const customerPageSize = 50
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<CustomerPayment | null>(null)
  const [reversingPayment, setReversingPayment] = useState<CustomerPayment | null>(null)
  const [paymentReversalDate, setPaymentReversalDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentReversalReason, setPaymentReversalReason] = useState('')
  const [loanOpen, setLoanOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null)
  const [lifecyclePreview, setLifecyclePreview] = useState<CustomerDependencyPreview | null>(null)
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [purgeConfirmation, setPurgeConfirmation] = useState('')
  const [forceCompletion, setForceCompletion] = useState(false)
  const [working, setWorking] = useState(false)
  const [lifecycleMenuOpen, setLifecycleMenuOpen] = useState(false)
  const lifecycleMenuRef = useRef<HTMLDivElement>(null)
  const detailRequestRef = useRef(0)
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const { toast } = useToast()

  const customerAccess = getModuleAccess(session, 'customers')
  const documentAccess = getModuleAccess(session, 'documents')
  const quotationAccess = getModuleAccess(session, 'quotations')
  const financeAccess = getModuleAccess(session, 'finance')
  const currentRevision = revision(snapshot)
  const project = snapshot?.project ?? null
  const totalReceived = Number(snapshot?.total_received ?? 0)
  const totalRefunded = Number(snapshot?.total_refunded ?? 0)
  const approvedValue = Number(project?.approved_value ?? currentRevision?.grand_total ?? 0)
  const balance = Math.max(0, approvedValue - totalReceived + totalRefunded)

  async function loadCustomers() {
    setLoading(true)
    setError('')
    try {
      const page = await repository.listCustomers({
        page: customerPage,
        pageSize: customerPageSize,
        status: statusFilter === 'current' ? undefined : statusFilter,
        query: search,
        paymentMode: paymentFilter,
      })
      if (!page.items.length && customerPage > 1 && (page.total ?? 0) > 0) {
        setCustomerPage((current) => Math.max(1, current - 1))
        return
      }
      setCustomers(page.items)
      setTotalCustomers(page.total ?? page.items.length)
      setSelectedId((current) => page.items.some((row) => row.id === current) ? current : (page.items[0]?.id || ''))
      if (!page.items.length) setSnapshot(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customers')
    } finally {
      setLoading(false)
    }
  }

  async function loadSnapshot(customerId = selectedId, activeSection: Tab = tab) {
    if (!customerId) return
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    setDetailError('')
    setSnapshot((current) => current?.customer.id === customerId ? current : null)
    try {
      const sections = activeSection === 'overview' ? ['overview'] : ['overview', activeSection]
      const next = await repository.getSnapshot(customerId, sections)
      if (requestId === detailRequestRef.current) setSnapshot(next)
    } catch (reason) {
      if (requestId === detailRequestRef.current) {
        setSnapshot(null)
        setDetailError(reason instanceof Error ? reason.message : 'Could not load customer details')
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCustomers() }, search.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [customerPage, search, statusFilter, paymentFilter])
  useEffect(() => {
    if (selectedId) {
      void loadSnapshot(selectedId, tab)
      return
    }
    detailRequestRef.current += 1
    setSnapshot(null)
    setDetailError('')
    setDetailLoading(false)
  }, [selectedId, tab])
  useEffect(() => {
    if (!paymentOpen) return
    void Promise.all([getFinancialAccounts(), getFinanceCategories()]).then(([nextAccounts, nextCategories]) => {
      setAccounts(nextAccounts)
      setCategories(nextCategories)
    }).catch(() => undefined)
  }, [paymentOpen])
  useEffect(() => {
    if (!lifecycleMenuOpen) return
    function closeMenu(event: MouseEvent) {
      if (!lifecycleMenuRef.current?.contains(event.target as Node)) setLifecycleMenuOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setLifecycleMenuOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [lifecycleMenuOpen])
  useEffect(() => { setLifecycleMenuOpen(false) }, [selectedId])

  const visibleCustomers = customers

  async function openLifecycle(action: LifecycleAction) {
    if (!snapshot) return
    setLifecycleReason('')
    setPurgeConfirmation('')
    setForceCompletion(false)
    setLifecyclePreview(null)
    if (session.user.is_super_admin && ['complete', 'archive', 'delete', 'purge'].includes(action)) {
      try { setLifecyclePreview(await repository.getDependencyPreview(snapshot.customer.id)) }
      catch (reason) {
        toast({ message: reason instanceof Error ? reason.message : 'Could not calculate customer impact', variant: 'error' })
        return
      }
    }
    setLifecycleAction(action)
  }

  async function applyLifecycle() {
    if (!snapshot || !lifecycleAction) return
    const customerId = snapshot.customer.id
    if ((['delete', 'purge'].includes(lifecycleAction) || (lifecycleAction === 'complete' && forceCompletion)) && !lifecycleReason.trim()) {
      toast({ message: 'A reason is required for destructive actions', variant: 'warning' })
      return
    }
    if (lifecycleAction === 'purge' && purgeConfirmation !== 'PURGE') {
      toast({ message: 'Type PURGE to confirm permanent deletion', variant: 'warning' })
      return
    }
    setWorking(true)
    try {
      if (lifecycleAction === 'complete') await repository.completeCustomer(customerId, lifecycleReason, session.user.is_super_admin && forceCompletion)
      if (lifecycleAction === 'reactivate') await repository.reactivateCustomer(customerId, lifecycleReason)
      if (lifecycleAction === 'archive') await repository.archiveCustomer(customerId, lifecycleReason)
      if (lifecycleAction === 'delete') await repository.deleteCustomer(customerId, lifecycleReason)
      if (lifecycleAction === 'restore') {
        if (snapshot.customer.status === 'archived') await repository.reactivateCustomer(customerId, lifecycleReason)
        else await repository.restoreCustomer(customerId, lifecycleReason)
      }
      if (lifecycleAction === 'purge') await repository.purgeCustomer(customerId, lifecycleReason)
      setLifecycleAction(null)
      if (['delete', 'purge'].includes(lifecycleAction)) {
        // Do not leave a tombstoned customer rendered while the operational list refreshes.
        setSnapshot(null)
        setSelectedId('')
      }
      await loadCustomers()
      if (!['delete', 'purge'].includes(lifecycleAction)) await loadSnapshot(customerId, tab)
      window.dispatchEvent(new Event('solar-erp:notifications-changed'))
      toast({ message: `Customer ${lifecycleAction} action completed`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update customer lifecycle', variant: 'error' })
    } finally { setWorking(false) }
  }

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

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
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

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!snapshot) return
    const form = new FormData(event.currentTarget)
    const amount = Number(form.get('amount') || 0)
    const direction = String(form.get('direction') || 'credit')
    setWorking(true)
    try {
      const body = {
        transaction_date: form.get('transaction_date'), direction, amount,
        category_id: form.get('category_id') || null, account_id: form.get('account_id'),
        payment_method: form.get('payment_method') || 'bank', source_type: form.get('source_type'),
        reference_number: form.get('reference_number'), description: form.get('description'),
      }
      if (editingPayment) {
        await updateFinanceTransaction(editingPayment.id, body)
      } else {
        await createFinanceTransaction({
          ...body,
          party_type: 'customer', party_name: snapshot.customer.display_name,
          customer_id: snapshot.customer.id, project_id: project?.id ?? null,
        })
      }
      await loadSnapshot()
      setPaymentOpen(false)
      setEditingPayment(null)
      toast({ message: editingPayment ? 'Customer transaction updated' : direction === 'credit' ? 'Customer payment recorded' : 'Customer refund recorded', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not record payment', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function reverseCustomerPayment() {
    if (!reversingPayment || !snapshot) return
    if (paymentReversalReason.trim().length < 3) {
      toast({ message: 'Enter a short reason for the reversal', variant: 'warning' })
      return
    }
    setWorking(true)
    try {
      await reverseFinanceTransaction(reversingPayment.id, { transaction_date: paymentReversalDate, reason: paymentReversalReason.trim() })
      setReversingPayment(null)
      setPaymentReversalReason('')
      await loadSnapshot(snapshot.customer.id, 'payments')
      toast({ message: `${reversingPayment.transaction_number} reversed`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not reverse customer transaction', variant: 'error' })
    } finally { setWorking(false) }
  }

  async function saveLoan(event: FormEvent<HTMLFormElement>) {
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


  async function createSalesBill(event: FormEvent<HTMLFormElement>) {
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

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !snapshot) return
    const validation = await validateUploadFile(file, fileUploadRules.customerDocument)
    if ('message' in validation) {
      toast({ message: validation.message, variant: 'warning' })
      event.target.value = ''
      return
    }
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
          <header><div><strong>Customers</strong><span>{totalCustomers} matching records</span></div><button onClick={() => void loadCustomers()} aria-label="Refresh customers"><RefreshCw size={15} /></button></header>
          <div className="customer-directory__filters">
            <Field label="Search customers" hideLabel prefix={<Search size={15} />} className="customer-directory__search"><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setCustomerPage(1) }} placeholder="Name, phone or consumer no." /></Field>
            <select aria-label="Filter customers by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setCustomerPage(1) }}>
              <option value="current">Current</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
              {session.user.is_super_admin && <option value="deleted">Deleted</option>}
            </select>
            <select aria-label="Filter customers by payment" value={paymentFilter} onChange={(event) => { setPaymentFilter(event.target.value as PaymentFilter); setCustomerPage(1) }}>
              <option value="all">All payments</option>
              <option value="loan">Loan</option>
              <option value="cash">Cash</option>
              <option value="remaining">Balance remaining</option>
            </select>
          </div>
          <div className="customer-directory__list">
            {visibleCustomers.map((row) => <button className={selectedId === row.id ? 'active' : ''} key={row.id} onClick={() => setSelectedId(row.id)}>
              <span className="customer-avatar">{row.display_name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{row.display_name}</strong><small>{row.contacts[0]?.phone || row.record_number}</small></span>
              <em>{label(row.status)}</em>
            </button>)}
            {!visibleCustomers.length && <EmptyState title="No customers found" />}
          </div>
          <Pagination compact className="customer-directory__pager" page={customerPage} pageSize={customerPageSize} total={totalCustomers} loading={loading} onPageChange={setCustomerPage} />
        </aside>

        <main className="customer-workspace">
          {detailLoading ? <LoadingSkeleton rows={7} /> : detailError ? <ErrorState message={detailError} onRetry={() => void loadSnapshot()} /> : !snapshot ? <EmptyState title="Select a customer" /> : <>
            <header className="customer-workspace__header">
              <div className="customer-title-block">
                <span className="customer-title-icon">{snapshot.customer.display_name.slice(0, 1)}</span>
                <div className="customer-title-content">
                  <h1>{snapshot.customer.display_name}</h1>
                  <div className="customer-title-meta">
                  </div>
                  <p className="customer-title-contact">
                    <span className="customer-contact-item"><Phone size={13} /><span>{snapshot.customer.contacts[0]?.phone || 'No phone'}</span></span>
                    <span className="customer-contact-item"><MapPin size={13} /><span>{snapshot.customer.site_address || 'Site address pending'}</span></span>
                  </p>
                </div>
              </div>
              <ActionBar className="customer-header-actions" layout="grid">
                <Button variant="secondary" size="icon" aria-label="Refresh customer" leadingIcon={<RefreshCw size={14} />} onClick={() => void loadSnapshot()} />
                {customerAccess.canEdit && !['archived', 'deleted'].includes(snapshot.customer.status) && <Button variant="primary" size="icon" aria-label="Edit customer" leadingIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)} />}
                <div className="customer-action-menu" ref={lifecycleMenuRef}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="customer-action-menu__trigger"
                    aria-label="More customer actions"
                    aria-haspopup="menu"
                    aria-expanded={lifecycleMenuOpen}
                    leadingIcon={<MoreHorizontal size={16} />}
                    onClick={() => setLifecycleMenuOpen((open) => !open)}
                  />
                  {lifecycleMenuOpen && <div className="customer-action-menu__panel" role="menu" aria-label="Customer lifecycle actions">
                    {customerAccess.canEdit && !['completed', 'archived', 'deleted'].includes(snapshot.customer.status) && <button type="button" role="menuitem" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('complete') }}>Complete</button>}
                    {customerAccess.canEdit && snapshot.customer.status === 'completed' && <button type="button" role="menuitem" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('reactivate') }}>Reactivate</button>}
                    {session.user.is_super_admin && !['archived', 'deleted'].includes(snapshot.customer.status) && <button type="button" role="menuitem" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('archive') }}>Archive</button>}
                    {session.user.is_super_admin && snapshot.customer.status !== 'deleted' && <button type="button" role="menuitem" className="is-danger" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('delete') }}>Delete</button>}
                    {session.user.is_super_admin && ['archived', 'deleted'].includes(snapshot.customer.status) && <button type="button" role="menuitem" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('restore') }}>Restore</button>}
                    {session.user.is_super_admin && snapshot.customer.status === 'deleted' && <button type="button" role="menuitem" className="is-danger" onClick={() => { setLifecycleMenuOpen(false); void openLifecycle('purge') }}>Permanent purge</button>}
                  </div>}
                </div>
              </ActionBar>
            </header>

            <KpiGrid columns={4} phoneColumns={2} responsive className="customer-summary-grid">
              <KpiCard icon={<FolderKanban />} label="Current project" value={project?.record_number || 'Not created'} note={project ? `${project.capacity_kw} kW · ${label(project.payment_mode || 'mode pending')}` : 'Awaiting approved quotation'} />
              <KpiCard icon={<CalendarClock />} label="Current stage" value={snapshot.timeline.find((row) => row.status === 'current')?.name || (project?.status ? label(project.status) : 'Quotation')} note={project ? `${Math.round((snapshot.timeline.filter((row) => row.status === 'completed').length / Math.max(1, snapshot.timeline.length)) * 100)}% complete` : 'Project not started'} tone="navy" />
              <KpiCard icon={<BadgeIndianRupee />} label="Approved value" value={money.format(approvedValue)} note={currentRevision?.record_number || 'No approved quotation'} />
              <KpiCard icon={<CheckCircle2 />} label="Received / pending" value={money.format(totalReceived)} note={`${money.format(balance)} pending`} tone={balance > 0 ? 'neutral' : 'success'} />
            </KpiGrid>

            <TabStrip className="workspace-tabs" label="Customer detail sections">
              {([
                ['overview', Building2, 'Overview'], ['projects', FolderKanban, 'Projects'], ['timeline', CalendarClock, 'Timeline'],
                ['quotations', ClipboardList, 'Quotations'], ['documents', FileText, 'Documents'], ['payments', BadgeIndianRupee, 'Payments'],
                ['loan', Landmark, 'Loan'], ['activity', History, 'Activity'],
              ] as Array<[Tab, typeof Building2, string]>).filter(([key]) => key !== 'loan' || project?.payment_mode === 'loan' || snapshot.loan).map(([key, Icon, text]) => <TabButton active={tab === key} onClick={() => setTab(key)} key={key}><Icon size={14} /> {text}</TabButton>)}
            </TabStrip>

            <section className="workspace-tab-panel customer-tab-panel" data-scroll-surface="tab-body">
              {tab === 'overview' && <OverviewTab snapshot={snapshot} />}
              {tab === 'projects' && <ProjectsTab snapshot={snapshot} />}
              {tab === 'timeline' && <TimelineTab snapshot={snapshot} />}
              {tab === 'quotations' && <QuotationsTab snapshot={snapshot} canApprove={quotationAccess.canApprove} working={working} onApprove={approveQuotation} />}
              {tab === 'documents' && <DocumentsTab snapshot={snapshot} canUpload={documentAccess.canCreate || documentAccess.canEdit} working={working} onUpload={uploadDocument} />}
              {tab === 'payments' && <PaymentsTab snapshot={snapshot} approvedValue={approvedValue} totalReceived={totalReceived} balance={balance} canManage={financeAccess.canEdit || financeAccess.canCreate} canReverse={session.user.is_super_admin} onAdd={() => { setEditingPayment(null); setPaymentOpen(true) }} onEdit={(payment) => { setEditingPayment(payment); setPaymentOpen(true) }} onReverse={(payment) => { setPaymentReversalDate(new Date().toISOString().slice(0, 10)); setPaymentReversalReason(''); setReversingPayment(payment) }} onBill={() => setBillOpen(true)} />}
              {tab === 'loan' && <LoanTab snapshot={snapshot} canManage={financeAccess.canEdit} onEdit={() => setLoanOpen(true)} />}
              {tab === 'activity' && <ActivityTab snapshot={snapshot} />}
            </section>
          </>}
        </main>
      </div>

      {lifecycleAction && snapshot && <Modal className="customer-lifecycle-modal" bodyClassName="customer-lifecycle-modal__body" title={`${label(lifecycleAction)} customer`} subtitle={lifecycleAction === 'purge' ? 'Permanent purge is deliberately restricted and cannot remove dependent financial history.' : 'Lifecycle changes are protected on the backend and recorded in audit history.'} onClose={() => !working && setLifecycleAction(null)}>
        <div className="erp-form customer-lifecycle-form">
          {lifecyclePreview && <div className="customer-lifecycle-impact">
            <strong>Dependency impact</strong>
            <p>{lifecyclePreview.projects} projects · {lifecyclePreview.finance_transactions} finance transactions · {lifecyclePreview.inventory_movements} inventory movements · {lifecyclePreview.documents} documents</p>
            {!!lifecyclePreview.completion_blockers.length && lifecycleAction === 'complete' && <p>{lifecyclePreview.completion_blockers.join(' · ')}</p>}
            {!!lifecyclePreview.purge_blockers.length && lifecycleAction === 'purge' && <p>{lifecyclePreview.purge_blockers.join(' · ')}</p>}
          </div>}
          {lifecycleAction === 'complete' && session.user.is_super_admin && !!lifecyclePreview?.completion_blockers.length && <label className="inline-check"><input type="checkbox" checked={forceCompletion} onChange={(event) => setForceCompletion(event.target.checked)} /><span>Override completion blockers</span></label>}
          <label><span>Reason {['delete', 'purge'].includes(lifecycleAction) || (lifecycleAction === 'complete' && forceCompletion) ? '(required)' : '(optional)'}</span><textarea value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} placeholder="Short reason for the audit trail" /></label>
          {lifecycleAction === 'purge' && <label><span>Type PURGE to confirm</span><input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} /></label>}
          <footer className="erp-form-actions"><Button variant={lifecycleAction === 'purge' || lifecycleAction === 'delete' ? 'danger' : 'primary'} disabled={working} onClick={() => void applyLifecycle()}>{working ? 'Working…' : `Confirm ${label(lifecycleAction)}`}</Button></footer>
        </div>
      </Modal>}
      {editOpen && snapshot && <Modal title="Edit customer" subtitle="B2C customer and installation-site details" onClose={() => setEditOpen(false)}><CustomerEditForm snapshot={snapshot} working={working} onSubmit={saveCustomer} /></Modal>}
      {paymentOpen && snapshot && <Modal title={editingPayment ? `Edit ${editingPayment.transaction_number}` : 'Record customer money'} subtitle={editingPayment ? 'Only harmless metadata can change after posting. Reverse the transaction to correct financial values.' : 'This posts once to the shared company finance ledger.'} onClose={() => { setPaymentOpen(false); setEditingPayment(null) }}><PaymentForm key={`${editingPayment?.id ?? 'new'}-${accounts.length}-${categories.length}`} accounts={accounts} categories={categories} payment={editingPayment} working={working} onSubmit={recordPayment} /></Modal>}
      {reversingPayment && <Modal title={`Reverse ${reversingPayment.transaction_number}`} subtitle="The original ledger row remains traceable and an opposite transaction is posted." onClose={() => !working && setReversingPayment(null)}><div className="erp-form"><div className="customer-lifecycle-impact"><strong>Reversal impact</strong><p>{reversingPayment.direction === 'credit' ? 'Removes' : 'Restores'} {money.format(Number(reversingPayment.amount))} from the customer payment effect while preserving history.</p></div><label><span>Reversal date</span><input type="date" value={paymentReversalDate} onChange={(event) => setPaymentReversalDate(event.target.value)} /></label><label><span>Reason (required)</span><textarea value={paymentReversalReason} onChange={(event) => setPaymentReversalReason(event.target.value)} placeholder="Why is this transaction being reversed?" /></label><footer className="erp-form-actions"><Button variant="danger" disabled={working} onClick={() => void reverseCustomerPayment()}>{working ? 'Reversing…' : 'Reverse transaction'}</Button></footer></div></Modal>}
      {billOpen && snapshot && <Modal title="Create customer sales bill" subtitle="The bill records the receivable; payment is posted separately." onClose={() => setBillOpen(false)}><SalesBillForm approvedValue={approvedValue} working={working} onSubmit={createSalesBill} /></Modal>}
      {loanOpen && project && <Modal title="Customer solar loan" subtitle="Project-specific bank approval and disbursement details" onClose={() => setLoanOpen(false)}><LoanForm snapshot={snapshot!} working={working} onSubmit={saveLoan} /></Modal>}
    </WorkspacePage>
  )
}
