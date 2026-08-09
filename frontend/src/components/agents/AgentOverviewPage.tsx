import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeIndianRupee,
  BriefcaseBusiness,
  CircleDollarSign,
  Download,
  Edit3,
  FilePlus2,
  FileText,
  Mail,
  Phone,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectDisplayName } from '../../lib/project-name'
import { WORKSPACE_ROUTE_ACCESS } from '../../lib/workspace-routes'
import {
  createAgentCustomer,
  createAgentTransaction,
  createQuotationRequest,
  deleteAgentTransaction,
  getAgentOverview,
  getAgents,
  updateAgentCustomer,
  updateAgentTransaction,
  updateAgentProfile,
} from '../../lib/api'
import { downloadQuotationPdf } from '../../lib/quotation-document'
import type {
  AgentListItem,
  AgentCustomer,
  AgentOverview,
  AgentTransaction,
  CreateAgentCustomerInput,
  CreateAgentTransactionInput,
  CreateQuotationRequestInput,
  Session,
  UpdateAgentProfileInput,
} from '../../types'
import { useToast } from '../ui/ToastProvider'
import { AlertDialog } from '../ui/AlertDialog'
import { Pagination } from '../ui/Pagination'
import { AgentCustomerDialog } from './AgentCustomerDialog'
import { AgentProfileDialog } from './AgentProfileDialog'
import { AgentTransactionDialog } from './AgentTransactionDialog'
import { QuotationRequestDialog } from './QuotationRequestDialog'
import { KpiGrid, WorkspacePage } from '../workspace'
import { AgentWorkspaceControls } from './AgentWorkspaceControls'

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })


function transactionLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function AgentOverviewPage({ session }: { session: Session }) {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [selectedMembershipId, setSelectedMembershipId] = useState('')
  const [overview, setOverview] = useState<AgentOverview | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [transactionSearch, setTransactionSearch] = useState('')
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState('')
  const [debouncedTransactionSearch, setDebouncedTransactionSearch] = useState('')
  const [customerPage, setCustomerPage] = useState(1)
  const [transactionPage, setTransactionPage] = useState(1)
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'agents' | 'customers'>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const [editingProfile, setEditingProfile] = useState(false)
  const [postingTransaction, setPostingTransaction] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<AgentTransaction | null>(null)
  const [transactionToDelete, setTransactionToDelete] = useState<AgentTransaction | null>(null)
  const [registeringCustomer, setRegisteringCustomer] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<AgentCustomer | null>(null)
  const [quotationCustomer, setQuotationCustomer] = useState<AgentCustomer | null>(null)

  const canPostTransactions = session.permissions.includes('agents.transactions.submit') || session.permissions.includes('agents.manage') || session.permissions.includes('finance.manage')
  const canManageAgentTransactions = session.user.is_super_admin || session.permissions.includes('agents.manage') || session.permissions.includes('finance.manage')
  const canRegisterCustomers = session.permissions.includes('customers.create') || session.permissions.includes('agents.manage')
  const canRequestQuotations = session.permissions.includes('quotations.create') || session.permissions.includes('quotations.approve')
  const canOpenDocuments = session.user.is_super_admin || session.permissions.includes('documents.view') || session.permissions.includes('documents.manage')
  const canEditSelectedProfile = Boolean(
    overview && (
      overview.profile.membership_id === session.membership_id
      || (agents.length === 1 && session.role === 'agent')
      || session.permissions.includes('agents.manage')
    ),
  )

  async function loadAgentList() {
    setLoading(true)
    try {
      const nextAgents = await getAgents()
      setAgents(nextAgents)
      setSelectedMembershipId((current) => {
        if (nextAgents.some((agent) => agent.membership_id === current)) return current
        return nextAgents[0]?.membership_id ?? ''
      })
      if (nextAgents.length === 0) setOverview(null)
      setLoading(false)
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load agents', variant: 'error' })
      setLoading(false)
    }
  }

  async function loadOverview(membershipId: string) {
    if (!membershipId) return
    setLoading(true)
    try {
      setOverview(await getAgentOverview(membershipId, {
        customerPage,
        customerPageSize: 25,
        customerQuery: debouncedCustomerSearch,
        transactionPage,
        transactionPageSize: 25,
        transactionQuery: debouncedTransactionSearch,
      }))
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load agent overview', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function refreshPage() {
    setLoading(true)
    try {
      const nextAgents = await getAgents()
      const nextMembershipId = nextAgents.some((agent) => agent.membership_id === selectedMembershipId)
        ? selectedMembershipId
        : nextAgents[0]?.membership_id ?? ''
      const nextOverview = nextMembershipId
        ? await getAgentOverview(nextMembershipId, {
          customerPage,
          customerPageSize: 25,
          customerQuery: debouncedCustomerSearch,
          transactionPage,
          transactionPageSize: 25,
          transactionQuery: debouncedTransactionSearch,
        })
        : null
      setAgents(nextAgents)
      setSelectedMembershipId(nextMembershipId)
      setOverview(nextOverview)
      toast({ message: 'Agent overview refreshed', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not refresh agent overview', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadAgentList() }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCustomerSearch(customerSearch.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [customerSearch])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTransactionSearch(transactionSearch.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [transactionSearch])
  useEffect(() => { void loadOverview(selectedMembershipId) }, [selectedMembershipId, customerPage, transactionPage, debouncedCustomerSearch, debouncedTransactionSearch])

  const filteredCustomers = overview?.customers ?? []
  const filteredTransactions = overview?.transactions ?? []

  const workspaceResults = useMemo(() => {
    const term = workspaceSearch.trim().toLowerCase()
    if (!term) return { agents: [], customers: [] }

    return {
      agents: searchScope === 'customers' ? [] : agents.filter((agent) => (
        `${agent.full_name} ${agent.email} ${agent.phone} ${agent.city}`
          .toLowerCase()
          .includes(term)
      )).slice(0, 6),
      customers: searchScope === 'agents' ? [] : (overview?.customers ?? []).filter((customer) => (
        `${customer.customer_name} ${customer.consumer_number} ${customer.email} ${customer.phone} ${customer.project_name}`
          .toLowerCase()
          .includes(term)
      )).slice(0, 6),
    }
  }, [agents, overview, searchScope, workspaceSearch])

  async function saveProfile(value: UpdateAgentProfileInput) {
    if (!overview) return
    setBusy(true)
    try {
      await updateAgentProfile(
        overview.profile.membership_id,
        value,
      )
      setEditingProfile(false)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: 'Agent profile updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update agent profile', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function postTransaction(value: CreateAgentTransactionInput) {
    if (!overview) return
    setBusy(true)
    try {
      const transaction = await createAgentTransaction(overview.profile.membership_id, value)
      setPostingTransaction(false)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: transaction.approval_status === 'pending' ? 'Transaction submitted for admin approval' : 'Transaction approved and posted', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not submit transaction', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function saveTransaction(value: CreateAgentTransactionInput) {
    if (!overview || !editingTransaction) return
    setBusy(true)
    try {
      await updateAgentTransaction(
        overview.profile.membership_id,
        editingTransaction.id,
        value,
      )
      setEditingTransaction(null)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: 'Agent transaction updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update agent transaction', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmTransactionDelete() {
    if (!overview || !transactionToDelete) return
    setBusy(true)
    try {
      await deleteAgentTransaction(
        overview.profile.membership_id,
        transactionToDelete.id,
      )
      setTransactionToDelete(null)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: 'Agent transaction deleted', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not delete agent transaction', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function registerCustomer(value: CreateAgentCustomerInput) {
    if (!overview) return
    setBusy(true)
    try {
      await createAgentCustomer(overview.profile.membership_id, value)
      setRegisteringCustomer(false)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: 'Customer registered and assigned to this agent', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not register customer', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function saveCustomer(value: CreateAgentCustomerInput) {
    if (!overview || !editingCustomer) return
    setBusy(true)
    try {
      await updateAgentCustomer(
        overview.profile.membership_id,
        editingCustomer.id,
        value,
      )
      setEditingCustomer(null)
      await Promise.all([loadOverview(overview.profile.membership_id), loadAgentList()])
      toast({ message: session.role === 'agent' ? 'Customer updated. Your one-time edit has been used.' : 'Customer updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update customer', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function requestQuotation(value: CreateQuotationRequestInput) {
    if (!quotationCustomer || !overview) return
    setBusy(true)
    try {
      await createQuotationRequest(quotationCustomer.id, value)
      setQuotationCustomer(null)
      await loadOverview(overview.profile.membership_id)
      toast({ message: 'Quotation request forwarded to admin and super admin', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not request quotation', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function downloadApprovedQuotation(customer: AgentCustomer) {
    if (!customer.approved_quotation) return
    const downloaded = await downloadQuotationPdf({
      quotation: customer.approved_quotation,
      customerId: customer.id,
      customerName: customer.customer_name,
      companyName: '',
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      notes: customer.project_name,
      agentName: overview?.profile.full_name || '',
    })
    if (!downloaded) toast({ message: 'Upload the customer signature as a JPG, PNG, or WebP image before downloading the approved quotation.', variant: 'warning' })
  }

  return (
    <WorkspacePage className="agent-page">
      <AgentWorkspaceControls
        agents={agents}
        overview={overview}
        selectedMembershipId={selectedMembershipId}
        workspaceSearch={workspaceSearch}
        searchScope={searchScope}
        searchResults={workspaceResults}
        loading={loading}
        canEditProfile={canEditSelectedProfile}
        canRegisterCustomers={canRegisterCustomers}
        canPostTransactions={canPostTransactions}
        onWorkspaceSearchChange={setWorkspaceSearch}
        onSearchScopeChange={setSearchScope}
        onSelectAgent={(membershipId) => {
          setSelectedMembershipId(membershipId)
          setCustomerPage(1)
          setTransactionPage(1)
          setCustomerSearch('')
          setTransactionSearch('')
          setWorkspaceSearch('')
        }}
        onSelectCustomer={(customer) => {
          setCustomerPage(1)
          setCustomerSearch(customer.customer_name)
          setWorkspaceSearch('')
        }}
        onRefresh={() => void refreshPage()}
        onEditProfile={() => setEditingProfile(true)}
        onRegisterCustomer={() => setRegisteringCustomer(true)}
        onAddTransaction={() => setPostingTransaction(true)}
      />

      <div className="agent-page__body">
      {loading && !overview ? (
        <div className="agent-loading">Loading…</div>
      ) : !overview ? (
        <div className="empty-state agent-empty-state">
          <UsersRound size={28} />
          <strong>No agent profiles available</strong>
        </div>
      ) : (
        <>
          <section className="agent-summary-layout">
            <motion.article className="agent-profile-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div className="agent-profile-card__header">
                <div className="agent-avatar">{overview.profile.full_name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>
                <div>
                  <h2>{overview.profile.full_name}</h2>
                </div>
              </div>

              <div className="agent-contact-list">
                {overview.profile.phone && <a href={`tel:${overview.profile.phone}`}><Phone size={17} /><span><small>Phone</small><strong>{overview.profile.phone}</strong></span></a>}
              </div>
            </motion.article>

            <KpiGrid columns={4} phoneColumns={1} responsive className="agent-kpi-grid">
              <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}>
                <div className="agent-kpi__icon"><UsersRound size={20} /></div>
                <span>Total customers</span>
                <strong>{overview.customer_count}</strong>
                <small>{overview.active_customer_count} currently active</small>
              </motion.article>
              <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <div className="agent-kpi__icon"><BadgeIndianRupee size={20} /></div>
                <span>Total commission</span>
                <strong>{currency.format(overview.commission_total)}</strong>
                <small>Approved commission entries</small>
              </motion.article>
              <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
                <div className="agent-kpi__icon"><CircleDollarSign size={20} /></div>
                <span>Overall balance</span>
                <strong>{currency.format(overview.profile.current_balance)}</strong>
                <small>Opening: {currency.format(overview.profile.opening_balance)}</small>
              </motion.article>
              <motion.article initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
                <div className="agent-kpi__icon"><BriefcaseBusiness size={20} /></div>
                <span>Customer outstanding</span>
                <strong>{currency.format(overview.customer_outstanding)}</strong>
                <small>Across assigned customers</small>
              </motion.article>
            </KpiGrid>
          </section>

          <div className="agent-tables-grid">
            <section className="data-panel agent-data-panel">
              <div className="agent-section-heading">
                <div><UsersRound size={19} /><span><strong>Customers</strong></span></div>
                <div className="search-control agent-search"><Search size={16} /><input value={customerSearch} onChange={(event) => { setCustomerPage(1); setCustomerSearch(event.target.value) }} placeholder="Search customers or projects" /></div>
              </div>
              {filteredCustomers.length === 0 ? <div className="empty-state">No customers match this search.</div> : (
                <><div className="agent-table-wrap">
                  <table className="agent-table customer-table">
                    <thead><tr><th>Customer</th><th>Contact</th><th>Project</th><th>Status</th><th className="numeric-cell">Outstanding</th><th>Action</th></tr></thead>
                    <tbody>
                      {filteredCustomers.map((customer) => (
                        <tr key={customer.id}>
                          <td data-label="Customer"><div className="customer-identity"><div className="customer-avatar">{customer.customer_name.slice(0, 1)}</div><span><strong>{customer.customer_name}</strong><small>{customer.consumer_number || customer.customer_type}</small></span></div></td>
                          <td data-label="Contact"><div className="table-contact"><strong>{customer.phone || '—'}</strong></div></td>
                          <td data-label="Project"><strong className="project-name">{customer.project_name ? projectDisplayName(customer.project_name, customer.customer_name) : 'Not assigned'}</strong></td>
                          <td data-label="Status"><span className={`customer-status customer-status--${customer.status}`}>{customer.status.replaceAll('_', ' ')}</span></td>
                          <td data-label="Outstanding" className="numeric-cell"><strong>{currency.format(customer.outstanding_balance)}</strong></td>
                          <td data-label="Action"><div className="agent-customer-actions">
                            {customer.approved_quotation && <button className="table-action-button table-action-button--download" type="button" onClick={() => void downloadApprovedQuotation(customer)}><Download size={12} /></button>}
                            {canOpenDocuments && customer.approved_quotation && customer.project_id && <button className="table-action-button table-action-button--neutral" type="button" onClick={() => navigate(`${WORKSPACE_ROUTE_ACCESS.documents.path}?customer=${encodeURIComponent(customer.id)}`)}><FileText size={12} /></button>}
                            {customer.can_edit && <button className="table-action-button table-action-button--neutral" type="button" onClick={() => setEditingCustomer(customer)}><Edit3 size={12} /></button>}
                            {canRequestQuotations && !['pending', 'quotation_ready', 'pending_approval', 'approved'].includes(customer.quotation_status || customer.quotation_request_status || '')
                              ? <button className="table-action-button quotation-request-button" type="button" onClick={() => setQuotationCustomer(customer)} aria-label={`Request quotation for ${customer.customer_name}`} title="Request quotation"><FilePlus2 size={14} /></button>
                              : !customer.approved_quotation && !customer.can_edit && <small>{customer.project_number ? 'Project created' : customer.quotation_request_status ? 'With admin' : '—'}</small>}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div><Pagination compact className="agent-data-pagination" page={overview.customer_page} pageSize={overview.customer_page_size} total={overview.customer_total} loading={loading} onPageChange={setCustomerPage} /></>
              )}
            </section>

            <section className="data-panel agent-data-panel">
              <div className="agent-section-heading">
                <div><CircleDollarSign size={19} /><span><strong>Transactions</strong></span></div>
                <div className="agent-section-actions">
                  <div className="search-control agent-search transaction-search">
                    <Search size={16} />
                    <input value={transactionSearch} onChange={(event) => { setTransactionPage(1); setTransactionSearch(event.target.value) }} placeholder="Search transactions" />
                  </div>
                  <span className="record-count">
                    {overview.transaction_total.toLocaleString('en-IN')} records
                  </span>
                </div>
              </div>
              {filteredTransactions.length === 0 ? <div className="empty-state">{overview.transactions.length === 0 ? 'No agent transactions have been posted.' : 'No transactions match this search.'}</div> : (
                <><div className="agent-table-wrap">
                  <table className="agent-table transaction-table">
                    <thead><tr><th>Date</th><th>Reference</th><th>Transaction</th><th>Approval</th><th className="numeric-cell">Debit</th><th className="numeric-cell">Credit</th><th className="numeric-cell">Posted balance</th>{canPostTransactions && <th>Action</th>}</tr></thead>
                    <tbody>
                      {filteredTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td data-label="Date">{dateFormatter.format(new Date(transaction.transaction_date))}</td>
                          <td data-label="Reference"><code>{transaction.reference || '—'}</code></td>
                          <td data-label="Transaction"><div className="transaction-detail"><span className={`transaction-icon ${transaction.credit > 0 ? 'transaction-icon--credit' : 'transaction-icon--debit'}`}>{transaction.credit > 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><span><strong>{transactionLabel(transaction.transaction_type)}</strong><small>{transaction.description}</small></span></div></td>
                          <td data-label="Approval"><span className={`workflow-status workflow-status--${transaction.approval_status}`}>{transaction.approval_status}</span>{transaction.approval_status === 'rejected' && <small>{transaction.approval_comment}</small>}</td>
                          <td data-label="Debit" className="numeric-cell amount-debit">{transaction.debit > 0 ? currency.format(transaction.debit) : '—'}</td>
                          <td data-label="Credit" className="numeric-cell amount-credit">{transaction.credit > 0 ? currency.format(transaction.credit) : '—'}</td>
                          <td data-label="Balance" className="numeric-cell"><strong>{currency.format(transaction.running_balance)}</strong></td>
                          {canPostTransactions && <td data-label="Action"><div className="agent-transaction-actions">{(canManageAgentTransactions || transaction.approval_status === 'pending') && <button className="table-action-button table-action-button--neutral" type="button" onClick={() => setEditingTransaction(transaction)}><Edit3 size={12} /></button>}{transaction.approval_status === 'pending' && <button className="danger-icon-button" type="button" onClick={() => setTransactionToDelete(transaction)} aria-label={`Delete pending transaction ${transaction.reference || transaction.id}`} title="Delete pending transaction"><Trash2 size={14} /></button>}</div></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div><Pagination compact className="agent-data-pagination" page={overview.transaction_page} pageSize={overview.transaction_page_size} total={overview.transaction_total} loading={loading} onPageChange={setTransactionPage} /></>
              )}
            </section>
          </div>
        </>
      )}
      </div>

      {editingProfile && overview && <AgentProfileDialog profile={overview.profile} busy={busy} onClose={() => setEditingProfile(false)} onSubmit={saveProfile} />}
      {registeringCustomer && <AgentCustomerDialog busy={busy} onClose={() => setRegisteringCustomer(false)} onSubmit={registerCustomer} />}
      {editingCustomer && <AgentCustomerDialog customer={editingCustomer} busy={busy} onClose={() => setEditingCustomer(null)} onSubmit={saveCustomer} />}
      {quotationCustomer && <QuotationRequestDialog customer={quotationCustomer} busy={busy} onClose={() => setQuotationCustomer(null)} onSubmit={requestQuotation} />}
      {postingTransaction && <AgentTransactionDialog busy={busy} onClose={() => setPostingTransaction(false)} onSubmit={postTransaction} />}
      {editingTransaction && <AgentTransactionDialog transaction={editingTransaction} busy={busy} onClose={() => setEditingTransaction(null)} onSubmit={saveTransaction} />}
      <AlertDialog
        open={Boolean(transactionToDelete)}
        title="Delete agent transaction?"
        description={transactionToDelete ? `${transactionLabel(transactionToDelete.transaction_type)} · ${currency.format(Math.max(transactionToDelete.debit, transactionToDelete.credit))}. The agent balance will be recalculated.` : ''}
        confirmLabel="Delete transaction"
        icon="delete"
        loading={busy}
        onCancel={() => setTransactionToDelete(null)}
        onConfirm={confirmTransactionDelete}
      />
    </WorkspacePage>
  )
}
