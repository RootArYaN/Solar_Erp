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
  RefreshCw,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { createBill, createFinanceTransaction, getFinanceCategories, getFinancialAccounts, saveCustomerLoan, updateFinanceTransaction } from '../../api/finance'
import { uploadStoredFile } from '../../api/files'
import type { Customer, CustomerFlowSnapshot, CustomerPayment } from '../../contracts/domain-contracts'
import type { FinanceCategory, FinancialAccount } from '../../erp-types'
import { fileUploadRules, validateUploadFile } from '../../lib/file-validation'
import { getModuleAccess } from '../../lib/permissions'
import { createCustomerFlowRepository } from '../../lib/repositories/customer-flow-repository'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { ActionBar } from '../ui/ActionBar'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { KpiCard } from '../ui/KpiCard'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, TabButton, TabStrip, WorkspacePage } from '../workspace'
import { ActivityTab, DocumentsTab, LoanTab, OverviewTab, PaymentsTab, ProjectsTab, QuotationsTab, TimelineTab } from './CustomerWorkspaceTabs'
import { CustomerEditForm, LoanForm, PaymentForm, SalesBillForm } from './CustomerWorkspaceForms'
import { label, money, revision } from './customer-workspace-utils'

type Tab = 'overview' | 'projects' | 'timeline' | 'quotations' | 'documents' | 'payments' | 'loan' | 'activity'
type PaymentFilter = 'all' | 'loan' | 'cash' | 'remaining'



export function CustomerWorkspacePage({ session }: { session: Session }) {
  const repository = useMemo(() => createCustomerFlowRepository(), [])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState<CustomerPayment | null>(null)
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
    return customers.filter((row) => {
      const matchesSearch = !term || `${row.display_name} ${row.record_number} ${row.consumer_number} ${row.contacts[0]?.phone ?? ''}`.toLowerCase().includes(term)
      const matchesPayment = paymentFilter === 'all'
        || (paymentFilter === 'remaining' ? Number(row.outstanding_balance) > 0 : row.payment_mode === paymentFilter)
      return matchesSearch && matchesPayment
    })
  }, [customers, paymentFilter, search])

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
        source_type: form.get('source_type'), reference_number: form.get('reference_number'), description: form.get('description'),
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
          <header><div><strong>Customers</strong><span>{visibleCustomers.length} B2C records</span></div><button onClick={() => void loadCustomers()} aria-label="Refresh customers"><RefreshCw size={15} /></button></header>
          <div className="customer-directory__filters">
            <Field label="Search customers" hideLabel prefix={<Search size={15} />} className="customer-directory__search"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, phone or consumer no." /></Field>
            <select aria-label="Filter customers by payment" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as PaymentFilter)}>
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
        </aside>

        <main className="customer-workspace">
          {detailLoading || !snapshot ? <LoadingSkeleton rows={7} /> : <>
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
                <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} onClick={() => void loadSnapshot()}></Button>
                {customerAccess.canEdit && <Button variant="primary" size="compact" leadingIcon={<Pencil size={14} />} onClick={() => setEditOpen(true)}></Button>}
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
              {tab === 'payments' && <PaymentsTab snapshot={snapshot} approvedValue={approvedValue} totalReceived={totalReceived} balance={balance} canManage={financeAccess.canEdit || financeAccess.canCreate} onAdd={() => { setEditingPayment(null); setPaymentOpen(true) }} onEdit={(payment) => { setEditingPayment(payment); setPaymentOpen(true) }} onBill={() => setBillOpen(true)} />}
              {tab === 'loan' && <LoanTab snapshot={snapshot} canManage={financeAccess.canEdit} onEdit={() => setLoanOpen(true)} />}
              {tab === 'activity' && <ActivityTab snapshot={snapshot} />}
            </section>
          </>}
        </main>
      </div>

      {editOpen && snapshot && <Modal title="Edit customer" subtitle="B2C customer and installation-site details" onClose={() => setEditOpen(false)}><CustomerEditForm snapshot={snapshot} working={working} onSubmit={saveCustomer} /></Modal>}
      {paymentOpen && snapshot && <Modal title={editingPayment ? `Edit ${editingPayment.transaction_number}` : 'Record customer money'} subtitle={editingPayment ? 'Updates this shared-ledger transaction and records an audit event.' : 'This posts once to the shared company finance ledger.'} onClose={() => { setPaymentOpen(false); setEditingPayment(null) }}><PaymentForm key={`${editingPayment?.id ?? 'new'}-${accounts.length}-${categories.length}`} accounts={accounts} categories={categories} payment={editingPayment} working={working} onSubmit={recordPayment} /></Modal>}
      {billOpen && snapshot && <Modal title="Create customer sales bill" subtitle="The bill records the receivable; payment is posted separately." onClose={() => setBillOpen(false)}><SalesBillForm approvedValue={approvedValue} working={working} onSubmit={createSalesBill} /></Modal>}
      {loanOpen && project && <Modal title="Customer solar loan" subtitle="Project-specific bank approval and disbursement details" onClose={() => setLoanOpen(false)}><LoanForm snapshot={snapshot!} working={working} onSubmit={saveLoan} /></Modal>}
    </WorkspacePage>
  )
}
