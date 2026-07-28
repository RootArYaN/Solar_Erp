import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BadgeIndianRupee,
  Banknote,
  BarChart3,
  Building2,
  CalendarDays,
  FileSpreadsheet,
  FileText,
  Landmark,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createBill,
  createCompanyLoan,
  createFinanceTransaction,
  createFinancialAccount,
  deleteFinanceTransaction,
  getBills,
  getBillCustomers,
  getCompanyLoans,
  getExpenses,
  getFinanceCategories,
  getFinanceOverview,
  getFinanceTransactions,
  getFinancialAccounts,
  getProfitability,
  recordBillPayment,
  recordCompanyLoanPayment,
  reverseFinanceTransaction,
  transferFinancialAccounts,
  updateFinanceTransaction,
} from '../../api/finance'
import type { Bill, BillCustomerOption, BillList, CompanyLoan, FinanceCategory, FinanceOverview, FinanceTransaction, FinanceTransactionList, FinancialAccount, Profitability } from '../../erp-types'
import { getModuleAccess, PERMISSIONS } from '../../lib/permissions'
import { getProjectTimelines } from '../../api/workflow'
import type { ProjectTimelineListItem, Session } from '../../types'
import { Modal } from '../admin/Modal'
import { AlertDialog } from '../ui/AlertDialog'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, TabStrip, WorkspaceHeader, WorkspacePage } from '../workspace'

type Tab = 'overview' | 'transactions' | 'expenses' | 'bills' | 'accounts' | 'loans' | 'profitability' | 'reports'
type Dialog = 'transaction' | 'edit-transaction' | 'expense' | 'account' | 'transfer' | 'bill' | 'bill-payment' | 'loan' | 'loan-payment' | 'reverse-transaction' | null
const tabs: Tab[] = ['overview', 'transactions', 'expenses', 'bills', 'accounts', 'loans', 'profitability', 'reports']

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function today() { return new Date().toISOString().slice(0, 10) }
function monthStart() { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10) }

function exportLedgerCsv(rows: FinanceTransactionList['data']) {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('\"', '\"\"')}"`
  const headings = ['Date', 'Transaction', 'Party', 'Category', 'Source', 'Account', 'Money In', 'Money Out', 'Method', 'Reference', 'Status']
  const records = rows.map((row) => [
    row.transaction_date,
    row.transaction_number,
    row.party_name,
    row.category_name,
    label(row.source_type),
    row.account_name,
    row.direction === 'credit' ? row.amount : '',
    row.direction === 'debit' ? row.amount : '',
    row.payment_method,
    row.reference_number,
    row.status,
  ])
  const blob = new Blob([[headings, ...records].map((record) => record.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `finance-ledger-${today()}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function FinancePage({ session }: { session: Session }) {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(() => tabs.includes(requestedTab as Tab) ? requestedTab as Tab : 'overview')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [transactions, setTransactions] = useState<FinanceTransactionList | null>(null)
  const [expenses, setExpenses] = useState<FinanceTransactionList | null>(null)
  const [bills, setBills] = useState<BillList | null>(null)
  const [billCustomers, setBillCustomers] = useState<BillCustomerOption[]>([])
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const [projects, setProjects] = useState<ProjectTimelineListItem[]>([])
  const [loans, setLoans] = useState<CompanyLoan[]>([])
  const [profitability, setProfitability] = useState<Profitability | null>(null)
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null)
  const [selectedLoan, setSelectedLoan] = useState<CompanyLoan | null>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<FinanceTransaction | null>(null)
  const [transactionToDelete, setTransactionToDelete] = useState<FinanceTransaction | null>(null)
  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo, setDateTo] = useState(today())
  const [direction, setDirection] = useState(() => ['credit', 'debit'].includes(searchParams.get('direction') ?? '') ? searchParams.get('direction') ?? '' : '')
  const [billType, setBillType] = useState(() => ['sales', 'purchase'].includes(searchParams.get('bill_type') ?? '') ? searchParams.get('bill_type') ?? '' : '')
  const [search, setSearch] = useState('')
  const { toast } = useToast()
  const access = getModuleAccess(session, 'finance')

  async function loadBase() {
    setLoading(true); setError('')
    try {
      const projectRequest = session.permissions.includes(PERMISSIONS.projects.view) ? getProjectTimelines(session.access_token) : Promise.resolve([])
      const [nextOverview, nextAccounts, nextCategories, nextProjects, nextBillCustomers] = await Promise.all([getFinanceOverview(), getFinancialAccounts(), getFinanceCategories(), projectRequest, getBillCustomers()])
      setOverview(nextOverview); setAccounts(nextAccounts); setCategories(nextCategories); setProjects(nextProjects); setBillCustomers(nextBillCustomers)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load company finance') }
    finally { setLoading(false) }
  }

  async function loadTab(nextTab = tab) {
    setLoading(true); setError('')
    try {
      if (nextTab === 'overview') setOverview(await getFinanceOverview())
      if (nextTab === 'transactions' || nextTab === 'reports') {
        const query = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, page_size: '100' })
        if (direction) query.set('direction', direction)
        setTransactions(await getFinanceTransactions(query.toString()))
      }
      if (nextTab === 'expenses') setExpenses(await getExpenses(new URLSearchParams({ date_from: dateFrom, date_to: dateTo, page_size: '100' }).toString()))
      if (nextTab === 'bills') {
        const query = new URLSearchParams({ page_size: '100' }); if (billType) query.set('bill_type', billType)
        setBills(await getBills(query.toString()))
      }
      if (nextTab === 'accounts') setAccounts(await getFinancialAccounts())
      if (nextTab === 'loans') setLoans(await getCompanyLoans())
      if (nextTab === 'profitability') setProfitability(await getProfitability())
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load finance data') }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadBase() }, [])
  useEffect(() => { if (!loading || overview) void loadTab(tab) }, [tab])

  async function refreshAll() {
    await Promise.all([loadBase(), loadTab(tab)])
  }

  async function submitTransaction(event: React.FormEvent<HTMLFormElement>, expense = false) {
    event.preventDefault(); setWorking(true)
    const form = new FormData(event.currentTarget)
    try {
      await createFinanceTransaction({
        transaction_date: form.get('transaction_date'), direction: expense ? 'debit' : form.get('direction'),
        amount: Number(form.get('amount') || 0), account_id: form.get('account_id'), category_id: form.get('category_id') || null,
        payment_method: form.get('payment_method'), party_type: form.get('party_type') || 'other', party_name: form.get('party_name'),
        project_id: form.get('project_id') || null, source_type: expense ? 'expense' : form.get('source_type'), reference_number: form.get('reference_number'), description: form.get('description'),
      })
      setDialog(null); await refreshAll(); toast({ message: expense ? 'Company expense recorded' : 'Finance transaction posted', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not post transaction', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await createFinancialAccount({ name: form.get('name'), account_type: form.get('account_type'), bank_name: form.get('bank_name'), masked_account_number: form.get('masked_account_number'), opening_balance: Number(form.get('opening_balance') || 0) })
      setDialog(null); await refreshAll(); toast({ message: 'Financial account created', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create account', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await transferFinancialAccounts({ transaction_date: form.get('transaction_date'), source_account_id: form.get('source_account_id'), destination_account_id: form.get('destination_account_id'), amount: Number(form.get('amount') || 0), reference_number: form.get('reference_number'), description: form.get('description') })
      setDialog(null); await refreshAll(); toast({ message: 'Account transfer completed', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not transfer money', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitBill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await createBill({ bill_type: form.get('bill_type'), bill_number: form.get('bill_number'), bill_date: form.get('bill_date'), customer_id: form.get('customer_id') || null, supplier_name: form.get('supplier_name') || '', project_id: form.get('project_id') || null, subtotal: Number(form.get('subtotal') || 0), tax_amount: Number(form.get('tax_amount') || 0), due_date: form.get('due_date') || null, note: form.get('note') || '' })
      setDialog(null); await refreshAll(); toast({ message: 'Bill created without duplicating payment', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create bill', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitBillPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedBill) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await recordBillPayment(selectedBill.id, { transaction_date: form.get('transaction_date'), amount: Number(form.get('amount') || 0), account_id: form.get('account_id'), payment_method: form.get('payment_method'), reference_number: form.get('reference_number'), description: form.get('description') })
      setDialog(null); setSelectedBill(null); await refreshAll(); toast({ message: 'Bill payment linked to one finance transaction', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not record bill payment', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLoan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await createCompanyLoan({ lender_name: form.get('lender_name'), loan_account_number: form.get('loan_account_number'), principal_amount: Number(form.get('principal_amount') || 0), interest_rate: Number(form.get('interest_rate') || 0), emi_amount: Number(form.get('emi_amount') || 0), start_date: form.get('start_date'), end_date: form.get('end_date') || null, next_due_date: form.get('next_due_date') || null, account_id: form.get('account_id'), reference_number: form.get('reference_number'), note: form.get('note') })
      setDialog(null); await refreshAll(); toast({ message: 'Company loan and disbursement recorded', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create company loan', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLoanPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedLoan) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await recordCompanyLoanPayment(selectedLoan.id, { transaction_date: form.get('transaction_date'), amount: Number(form.get('amount') || 0), account_id: form.get('account_id'), reference_number: form.get('reference_number'), note: form.get('note') })
      setDialog(null); setSelectedLoan(null); await refreshAll(); toast({ message: 'Company loan payment recorded', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not record loan payment', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitReversal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedTransaction) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await reverseFinanceTransaction(selectedTransaction.id, { transaction_date: form.get('transaction_date'), reason: form.get('reason') })
      setDialog(null); setSelectedTransaction(null); await refreshAll(); toast({ message: 'Transaction reversed with a linked correction entry', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not reverse transaction', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitTransactionEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedTransaction) return
    setWorking(true)
    const form = new FormData(event.currentTarget)
    try {
      await updateFinanceTransaction(selectedTransaction.id, {
        transaction_date: form.get('transaction_date'),
        direction: form.get('direction'),
        amount: Number(form.get('amount') || 0),
        account_id: form.get('account_id'),
        category_id: form.get('category_id') || null,
        payment_method: form.get('payment_method'),
        source_type: form.get('source_type'),
        reference_number: form.get('reference_number'),
        description: form.get('description'),
      })
      setDialog(null)
      setSelectedTransaction(null)
      await refreshAll()
      toast({ message: 'Transaction updated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update transaction', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function confirmTransactionDelete() {
    if (!transactionToDelete) return
    setWorking(true)
    try {
      await deleteFinanceTransaction(transactionToDelete.id)
      setTransactionToDelete(null)
      await refreshAll()
      toast({ message: 'Finance transaction deleted', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not delete transaction', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  const visibleTransactions = useMemo(() => {
    const term = search.trim().toLowerCase()
    const rows = transactions?.data ?? []
    return term ? rows.filter((row) => `${row.transaction_number} ${row.party_name} ${row.description} ${row.reference_number}`.toLowerCase().includes(term)) : rows
  }, [transactions, search])

  if (loading && !overview) return <WorkspacePage className="finance-page"><LoadingSkeleton rows={8} /></WorkspacePage>
  if (error && !overview) return <WorkspacePage className="finance-page"><ErrorState message={error} onRetry={() => void loadBase()} /></WorkspacePage>

  return <WorkspacePage variant="fixed-tabs" className="finance-page">
    {access.readOnly && <ReadOnlyNotice />}
    <WorkspaceHeader className="module-page-header finance-page-header">
      <div>
        <span className="module-kicker">Company finance</span>
        <h1>Finance workspace</h1>
      </div>
      <div>
        <button className="secondary-button" onClick={() => void refreshAll()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={14} /> Refresh</button>
        {access.canEdit && <button className="primary-button" onClick={() => setDialog('transaction')}><Plus size={14} /> Add transaction</button>}
      </div>
    </WorkspaceHeader>

    <TabStrip className="finance-tabs" role="tablist" aria-label="Company finance sections">{([
      ['overview', WalletCards, 'Overview'], ['transactions', ArrowRightLeft, 'Transactions'], ['expenses', ReceiptText, 'Expenses'], ['bills', FileText, 'Bills'],
      ['accounts', Landmark, 'Bank & Cash'], ['loans', Building2, 'Loans'], ['profitability', BarChart3, 'Profitability'], ['reports', FileSpreadsheet, 'Reports'],
    ] as Array<[Tab, typeof WalletCards, string]>).map(([key, Icon, text]) => <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}><Icon size={14} /> {text}</button>)}</TabStrip>

    {error && <div className="inline-error">{error}</div>}
    <div className={`finance-tab-panel finance-tab-panel--${tab}`} role="tabpanel" data-scroll-surface="tab-body">
      {loading ? <LoadingSkeleton rows={6} /> : <>
        {tab === 'overview' && overview && <Overview data={overview} />}
        {(tab === 'transactions' || tab === 'reports') && <Transactions data={transactions} rows={visibleTransactions} search={search} setSearch={setSearch} direction={direction} setDirection={setDirection} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} reload={() => void loadTab(tab)} reportMode={tab === 'reports'} canEdit={access.canEdit} onEdit={(row) => { setSelectedTransaction(row); setDialog('edit-transaction') }} onReverse={(row) => { setSelectedTransaction(row); setDialog('reverse-transaction') }} onDelete={setTransactionToDelete} />}
        {tab === 'expenses' && <Expenses data={expenses} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} reload={() => void loadTab('expenses')} canEdit={access.canEdit} onAdd={() => setDialog('expense')} onEdit={(row) => { setSelectedTransaction(row); setDialog('edit-transaction') }} />}
        {tab === 'bills' && <Bills data={bills} billType={billType} setBillType={setBillType} reload={() => void loadTab('bills')} canEdit={access.canEdit} onAdd={() => setDialog('bill')} onPay={(bill) => { setSelectedBill(bill); setDialog('bill-payment') }} />}
        {tab === 'accounts' && <Accounts rows={accounts} canEdit={access.canEdit} onAdd={() => setDialog('account')} onTransfer={() => setDialog('transfer')} />}
        {tab === 'loans' && <Loans rows={loans} canEdit={access.canEdit} onAdd={() => setDialog('loan')} onPay={(loan) => { setSelectedLoan(loan); setDialog('loan-payment') }} />}
        {tab === 'profitability' && <ProfitabilityPanel data={profitability} />}
      </>}
    </div>

    {dialog === 'transaction' && <Modal className="finance-modal" title="Post transaction" subtitle="Use for actual company money movement only." onClose={() => setDialog(null)}><TransactionForm accounts={accounts} categories={categories} projects={projects} working={working} onSubmit={(event) => void submitTransaction(event)} /></Modal>}
    {dialog === 'expense' && <Modal className="finance-modal" title="Record company expense" subtitle="Daily expenses are this same data filtered by date." onClose={() => setDialog(null)}><TransactionForm accounts={accounts} categories={categories.filter((row) => row.category_type === 'expense')} projects={projects} working={working} expense onSubmit={(event) => void submitTransaction(event, true)} /></Modal>}
    {dialog === 'account' && <Modal className="finance-modal" title="Add financial account" subtitle="Bank, cash, UPI or petty-cash balance." onClose={() => setDialog(null)}><AccountForm working={working} onSubmit={submitAccount} /></Modal>}
    {dialog === 'transfer' && <Modal className="finance-modal" title="Transfer between accounts" subtitle="Creates two linked transaction sides in one operation." onClose={() => setDialog(null)}><TransferForm accounts={accounts} working={working} onSubmit={submitTransfer} /></Modal>}
    {dialog === 'bill' && <Modal className="finance-modal" title="Create bill" subtitle="A bill records money owed; it does not post a payment." onClose={() => setDialog(null)}><BillForm customers={billCustomers} projects={projects} initialType={billType === 'purchase' ? 'purchase' : 'sales'} working={working} onSubmit={submitBill} /></Modal>}
    {dialog === 'bill-payment' && selectedBill && <Modal className="finance-modal" title={`Pay ${selectedBill.bill_number}`} subtitle={`${money.format(selectedBill.balance_amount)} outstanding`} onClose={() => setDialog(null)}><PaymentForm accounts={accounts} amount={selectedBill.balance_amount} working={working} onSubmit={submitBillPayment} /></Modal>}
    {dialog === 'loan' && <Modal className="finance-modal" title="Add company loan" subtitle="Separate from customer solar loans." onClose={() => setDialog(null)}><CompanyLoanForm accounts={accounts} working={working} onSubmit={submitLoan} /></Modal>}
    {dialog === 'edit-transaction' && selectedTransaction && <Modal className="finance-modal" title={`Edit ${selectedTransaction.transaction_number}`} subtitle="Updates the shared ledger entry and records the changed fields in the audit log." onClose={() => { setDialog(null); setSelectedTransaction(null) }}><EditTransactionForm transaction={selectedTransaction} accounts={accounts} categories={categories} working={working} onSubmit={submitTransactionEdit} /></Modal>}
    {dialog === 'reverse-transaction' && selectedTransaction && <Modal title="Reverse transaction" subtitle={`${selectedTransaction.transaction_number} · ${money.format(selectedTransaction.amount)}`} onClose={() => { setDialog(null); setSelectedTransaction(null) }}><form className="erp-form" onSubmit={submitReversal}><div className="inline-warning">This does not delete or overwrite the original entry. A linked opposite entry will be posted.</div><div className="erp-form-grid"><label><span>Reversal date</span><input type="date" name="transaction_date" defaultValue={today()} required /></label><label className="erp-form-wide"><span>Reason</span><textarea name="reason" minLength={3} required /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => { setDialog(null); setSelectedTransaction(null) }}>Cancel</button><button className="primary-button" disabled={working}>Post reversal</button></footer></form></Modal>}

    {dialog === 'loan-payment' && selectedLoan && <Modal className="finance-modal" title={`Pay ${selectedLoan.lender_name}`} subtitle={`${money.format(selectedLoan.outstanding_amount)} outstanding`} onClose={() => setDialog(null)}><LoanPaymentForm accounts={accounts} amount={selectedLoan.emi_amount || selectedLoan.outstanding_amount} working={working} onSubmit={submitLoanPayment} /></Modal>}
    <AlertDialog
      open={Boolean(transactionToDelete)}
      title="Delete finance transaction?"
      description={transactionToDelete ? `${transactionToDelete.transaction_number} · ${money.format(transactionToDelete.amount)}. Linked bill or loan balances will be recalculated.` : ''}
      confirmLabel="Delete transaction"
      icon="delete"
      loading={working}
      onCancel={() => setTransactionToDelete(null)}
      onConfirm={confirmTransactionDelete}
    />
  </WorkspacePage>
}

function Overview({ data }: { data: FinanceOverview }) {
  const cards = [
    ['Money in this month', data.money_in_month, ArrowDownLeft, 'positive'], ['Money out this month', data.money_out_month, ArrowUpRight, 'negative'],
    ['Bank balance', data.bank_balance, Landmark, 'neutral'], ['Cash balance', data.cash_balance, Banknote, 'neutral'],
    ['Customer receivables', data.customer_receivables, BadgeIndianRupee, 'warning'], ['Supplier payables', data.supplier_payables, ReceiptText, 'warning'],
    ['Expenses this month', data.expenses_month, CalendarDays, 'negative'], ['Net cash flow', data.net_cash_flow, BarChart3, data.net_cash_flow >= 0 ? 'positive' : 'negative'],
  ] as const
  const maxFlow = Math.max(1, ...data.monthly_flow.flatMap((row) => [row.money_in, row.money_out]))
  const maxExpense = Math.max(1, ...data.expense_by_category.map((row) => row.amount))
  return <>
    <KpiGrid columns={4} className="finance-kpis">
      {cards.map(([name, value, Icon, tone]) => (
        <article className={`finance-kpi finance-kpi--${tone}`} key={name}>
          <span><Icon size={17} /></span>
          <div><small>{name}</small><strong>{money.format(value)}</strong></div>
        </article>
      ))}
    </KpiGrid>
    <div className="finance-overview-grid">
      <section className="erp-panel finance-overview-card">
        <header><div><strong>Recent transactions</strong><span>Latest company money movements</span></div></header>
        <TransactionTable rows={data.recent_transactions} compact />
      </section>
      <section className="erp-panel finance-overview-card">
        <header>
          <div><strong>Monthly cash flow</strong><span>Money in versus money out</span></div>
          <div className="cash-flow-legend"><span><i /> Money in</span><span><i /> Money out</span></div>
        </header>
        {!data.monthly_flow.length ? <EmptyState title="No monthly movement yet" /> : <div className="cash-flow-chart">{data.monthly_flow.map((row) => <div key={row.month}><div><i style={{ height: `${Math.max(4, (row.money_in / maxFlow) * 100)}%` }} title={`Money in ${money.format(row.money_in)}`} /><b style={{ height: `${Math.max(4, (row.money_out / maxFlow) * 100)}%` }} title={`Money out ${money.format(row.money_out)}`} /></div><span>{row.month}</span></div>)}</div>}
      </section>
      <section className="erp-panel finance-overview-card">
        <header><div><strong>Pending bills</strong><span>Customer receivables and supplier payables</span></div></header>
        <BillTable rows={data.pending_bills} compact />
      </section>
      <section className="erp-panel finance-overview-card">
        <header><div><strong>Expense mix</strong><span>Current month by category</span></div></header>
        {!data.expense_by_category.length ? <EmptyState title="No expenses this month" /> : <div className="expense-breakdown">{data.expense_by_category.map((row) => <div key={row.category}><div><span>{row.category}</span><strong>{money.format(row.amount)}</strong></div><i><b style={{ width: `${(row.amount / maxExpense) * 100}%` }} /></i></div>)}</div>}
      </section>
    </div>
  </>
}

function Transactions({ data, rows, search, setSearch, direction, setDirection, dateFrom, setDateFrom, dateTo, setDateTo, reload, reportMode, canEdit, onEdit, onReverse, onDelete }: { data: FinanceTransactionList | null; rows: FinanceTransactionList['data']; search: string; setSearch: (value: string) => void; direction: string; setDirection: (value: string) => void; dateFrom: string; setDateFrom: (value: string) => void; dateTo: string; setDateTo: (value: string) => void; reload: () => void; reportMode: boolean; canEdit: boolean; onEdit: (row: FinanceTransaction) => void; onReverse: (row: FinanceTransaction) => void; onDelete: (row: FinanceTransaction) => void }) {
  return <>
    <section className="mini-kpis finance-ledger-kpis">
      <article><span>Money in</span><strong>{money.format(data?.money_in ?? 0)}</strong></article>
      <article><span>Money out</span><strong>{money.format(data?.money_out ?? 0)}</strong></article>
      <article><span>Net</span><strong>{money.format((data?.money_in ?? 0) - (data?.money_out ?? 0))}</strong></article>
      <article><span>Entries</span><strong>{data?.total ?? 0}</strong></article>
    </section>
    <div className="finance-ledger-toolbar">
      <div className="finance-ledger-heading">
        <strong>{reportMode ? 'Full transaction ledger' : 'Company transactions'}</strong>
        <span>{reportMode ? 'Printable source report.' : 'Actual money movement only.'}</span>
      </div>
      <label className="finance-ledger-field"><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="finance-ledger-field"><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <label className="finance-ledger-field finance-ledger-direction"><span>Direction</span><select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All</option><option value="credit">Money in</option><option value="debit">Money out</option></select></label>
      <label className="finance-ledger-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ledger" aria-label="Search ledger" /></label>
      <button className="secondary-button finance-ledger-apply" onClick={reload}>Apply</button>
      {reportMode && <div className="finance-ledger-export">
        <button className="secondary-button" onClick={() => exportLedgerCsv(rows)}><FileSpreadsheet size={13} /> CSV</button>
        <button className="secondary-button" onClick={() => window.print()}><FileText size={13} /> Print</button>
      </div>}
    </div>
    <TransactionTable rows={rows} canEdit={canEdit && !reportMode} onEdit={onEdit} onReverse={onReverse} onDelete={onDelete} />
  </>
}

function Expenses({ data, dateFrom, setDateFrom, dateTo, setDateTo, reload, canEdit, onAdd, onEdit }: { data: FinanceTransactionList | null; dateFrom: string; setDateFrom: (value: string) => void; dateTo: string; setDateTo: (value: string) => void; reload: () => void; canEdit: boolean; onAdd: () => void; onEdit: (row: FinanceTransaction) => void }) {
  const isToday = dateFrom === today() && dateTo === today()
  return <>
    <section className="mini-kpis finance-expense-kpis">
      <article><span>{isToday ? "Today's expense" : 'Selected expenses'}</span><strong>{money.format(data?.money_out ?? 0)}</strong></article>
      <article><span>Entries</span><strong>{data?.total ?? 0}</strong></article>
      <article><span>Average</span><strong>{money.format((data?.money_out ?? 0) / Math.max(1, data?.total ?? 0))}</strong></article>
    </section>
    <div className="finance-expense-toolbar">
      <div className="finance-expense-heading">
        <strong>Company expenses</strong>
        <span>Filter the shared ledger by date.</span>
      </div>
      <div className="finance-expense-presets">
        <button onClick={() => { setDateFrom(today()); setDateTo(today()) }}>Today</button>
        <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); const value = d.toISOString().slice(0, 10); setDateFrom(value); setDateTo(value) }}>Yesterday</button>
        <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(d.toISOString().slice(0, 10)); setDateTo(today()) }}>This week</button>
        <button onClick={() => { setDateFrom(monthStart()); setDateTo(today()) }}>This month</button>
      </div>
      <label className="finance-expense-date"><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="finance-expense-date"><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <button className="secondary-button finance-expense-apply" onClick={reload}>Apply</button>
      {canEdit && <button className="primary-button finance-expense-create" onClick={onAdd}><Plus size={14} /> Add expense</button>}
    </div>
    <TransactionTable rows={data?.data ?? []} canEdit={canEdit} onEdit={onEdit} />
  </>
}

function Bills({ data, billType, setBillType, reload, canEdit, onAdd, onPay }: { data: BillList | null; billType: string; setBillType: (value: string) => void; reload: () => void; canEdit: boolean; onAdd: () => void; onPay: (bill: Bill) => void }) {
  return <>
    <section className="mini-kpis finance-bill-kpis">
      <article><span>Total bills</span><strong>{data?.total ?? 0}</strong></article>
      <article><span>Outstanding</span><strong>{money.format(data?.data.reduce((sum, row) => sum + row.balance_amount, 0) ?? 0)}</strong></article>
      <article><span>Paid</span><strong>{money.format(data?.data.reduce((sum, row) => sum + row.paid_amount, 0) ?? 0)}</strong></article>
    </section>
    <div className="finance-bills-toolbar">
      <div className="finance-bills-heading">
        <strong>Sales and purchase bills</strong>
        <span>Bills and payments stay linked.</span>
      </div>
      <label className="finance-bill-type">
        <span>Bill type</span>
        <select value={billType} onChange={(event) => setBillType(event.target.value)}>
          <option value="">All bills</option>
          <option value="sales">Sales</option>
          <option value="purchase">Purchase</option>
        </select>
      </label>
      <button className="secondary-button finance-bill-apply" onClick={reload}>Apply</button>
      {canEdit && <button className="primary-button finance-bill-create" onClick={onAdd}><Plus size={14} /> Create bill</button>}
    </div>
    <BillTable rows={data?.data ?? []} onPay={canEdit ? onPay : undefined} />
  </>
}

function Accounts({ rows, canEdit, onAdd, onTransfer }: { rows: FinancialAccount[]; canEdit: boolean; onAdd: () => void; onTransfer: () => void }) {
  return <><div className="tab-toolbar"><div><strong>Bank and cash accounts</strong><span>Balance = opening balance + money in − money out.</span></div>{canEdit && <div><button className="secondary-button" onClick={onTransfer}><ArrowRightLeft size={14} /> Transfer</button><button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Account</button></div>}</div><section className="account-grid">{rows.map((row) => <article key={row.id}><span className={`account-icon account-icon--${row.account_type}`}><Landmark size={18} /></span><div><small>{label(row.account_type)}</small><strong>{row.name}</strong><p>{row.bank_name || row.masked_account_number || 'Internal account'}</p></div><b>{money.format(row.current_balance)}</b></article>)}{!rows.length && <EmptyState title="No financial accounts" />}</section></>
}

function Loans({ rows, canEdit, onAdd, onPay }: { rows: CompanyLoan[]; canEdit: boolean; onAdd: () => void; onPay: (loan: CompanyLoan) => void }) {
  return <><div className="tab-toolbar"><div><strong>Company loans</strong><span>Business borrowing only—customer solar loans stay inside customer projects.</span></div>{canEdit && <button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Company loan</button>}</div>{!rows.length ? <EmptyState title="No company loans" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Lender</th><th>Principal</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Next due</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.lender_name}</strong><small>{row.loan_account_number}</small></td><td>{money.format(row.principal_amount)}</td><td>{money.format(row.outstanding_amount)}</td><td>{row.interest_rate}%</td><td>{money.format(row.emi_amount)}</td><td>{row.next_due_date ? shortDate.format(new Date(row.next_due_date)) : '—'}</td><td><span className="soft-badge">{label(row.status)}</span></td><td>{canEdit && row.status !== 'closed' && <button className="secondary-button" onClick={() => onPay(row)}>Pay</button>}</td></tr>)}</tbody></table></div>}</>
}

function ProfitabilityPanel({ data }: { data: Profitability | null }) {
  if (!data) return <EmptyState title="No profitability data" />
  return <><section className="finance-kpis"><article className="finance-kpi"><span><BadgeIndianRupee size={17} /></span><div><small>Sales value</small><strong>{money.format(data.sales_value)}</strong></div></article><article className="finance-kpi"><span><ArrowDownLeft size={17} /></span><div><small>Money received</small><strong>{money.format(data.money_received)}</strong></div></article><article className="finance-kpi"><span><ReceiptText size={17} /></span><div><small>Material + project cost</small><strong>{money.format(data.material_cost + data.project_expenses)}</strong></div></article><article className="finance-kpi"><span><BarChart3 size={17} /></span><div><small>Estimated gross profit</small><strong>{money.format(data.estimated_gross_profit)}</strong></div></article></section><div className="tab-toolbar"><div><strong>Project profitability</strong><span>Calculated from linked quotation value and project expenses.</span></div></div>{!data.projects.length ? <EmptyState title="No project profitability yet" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Project</th><th>Sales value</th><th>Money received</th><th>Cost</th><th>Gross profit</th></tr></thead><tbody>{data.projects.map((row) => <tr key={row.project_id}><td><strong>{row.project_number}</strong><small>{row.project_name}</small></td><td>{money.format(row.sales_value)}</td><td>{money.format(row.money_received)}</td><td>{money.format(row.cost)}</td><td className={row.gross_profit >= 0 ? 'money-in' : 'money-out'}>{money.format(row.gross_profit)}</td></tr>)}</tbody></table></div>}</>
}

function TransactionTable({ rows, compact = false, canEdit = false, onEdit, onReverse, onDelete }: { rows: FinanceTransactionList['data']; compact?: boolean; canEdit?: boolean; onEdit?: (row: FinanceTransaction) => void; onReverse?: (row: FinanceTransaction) => void; onDelete?: (row: FinanceTransaction) => void }) {
  if (!rows.length) return <EmptyState title="No transactions found" />
  return <div className={`erp-table-wrap ${compact ? 'erp-table-wrap--compact' : ''}`}><table className="erp-table"><thead><tr><th>Date</th><th>Transaction / party</th><th>Category / source</th>{!compact && <th>Account</th>}<th>Money in</th><th>Money out</th>{!compact && <th>Status</th>}{canEdit && <th />}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate.format(new Date(row.transaction_date))}</td><td><strong>{row.transaction_number}</strong><small>{row.party_name || row.description}</small></td><td>{row.category_name || label(row.source_type)}<small>{row.reference_number}</small></td>{!compact && <td>{row.account_name}<small>{label(row.payment_method)}</small></td>}<td className="money-in">{row.direction === 'credit' ? money.format(row.amount) : '—'}</td><td className="money-out">{row.direction === 'debit' ? money.format(row.amount) : '—'}</td>{!compact && <td><span className="soft-badge">{label(row.status)}</span></td>}{canEdit && <td><div className="erp-row-actions">{onEdit && <button className="secondary-button secondary-button--compact" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>}{row.status === 'posted' && onReverse && <button className="secondary-button secondary-button--compact" onClick={() => onReverse(row)}><RotateCcw size={13} /> Reverse</button>}{onDelete && <button type="button" className="danger-icon-button finance-transaction-delete" onClick={() => onDelete(row)} aria-label={`Delete ${row.transaction_number}`} title="Delete transaction"><Trash2 size={14} /></button>}</div></td>}</tr>)}</tbody></table></div>
}

function EditTransactionForm({ transaction, accounts, categories, working, onSubmit }: { transaction: FinanceTransaction; accounts: FinancialAccount[]; categories: FinanceCategory[]; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input name="transaction_date" type="date" defaultValue={transaction.transaction_date} required /></label><label><span>Direction</span><select name="direction" defaultValue={transaction.direction}><option value="credit">Money in</option><option value="debit">Money out</option></select></label><label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={transaction.amount} required /></label><label><span>Account</span><select name="account_id" defaultValue={transaction.account_id} required>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Category</span><select name="category_id" defaultValue={transaction.category_id || ''}><option value="">No category</option>{categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Payment method</span><select name="payment_method" defaultValue={transaction.payment_method}><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Source type</span><input name="source_type" defaultValue={transaction.source_type} required /></label><label><span>Reference</span><input name="reference_number" defaultValue={transaction.reference_number} /></label><label className="erp-form-wide"><span>Description</span><input name="description" defaultValue={transaction.description} /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working || !accounts.length}>Save changes</button></footer></form>
}

function BillTable({ rows, compact = false, onPay }: { rows: Bill[]; compact?: boolean; onPay?: (bill: Bill) => void }) {
  if (!rows.length) return <EmptyState title="No bills found" />
  return <div className={`erp-table-wrap ${compact ? 'erp-table-wrap--compact' : ''}`}><table className="erp-table"><thead><tr><th>Bill / party</th><th>Type</th><th>Total</th><th>Paid</th><th>Balance</th>{!compact && <th>Due</th>}<th>Status</th>{onPay && <th />}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.bill_number}</strong><small>{row.customer_name || row.supplier_name}</small></td><td>{label(row.bill_type)}</td><td>{money.format(row.total_amount)}</td><td>{money.format(row.paid_amount)}</td><td>{money.format(row.balance_amount)}</td>{!compact && <td>{row.due_date ? shortDate.format(new Date(row.due_date)) : '—'}</td>}<td><span className="soft-badge">{label(row.payment_status)}</span></td>{onPay && <td>{row.balance_amount > 0 && <button className="secondary-button" onClick={() => onPay(row)}>Record payment</button>}</td>}</tr>)}</tbody></table></div>
}

function TransactionForm({ accounts, categories, projects, working, expense = false, onSubmit }: { accounts: FinancialAccount[]; categories: FinanceCategory[]; projects: ProjectTimelineListItem[]; working: boolean; expense?: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input name="transaction_date" type="date" defaultValue={today()} required /></label>{!expense && <label><span>Direction</span><select name="direction"><option value="credit">Money in</option><option value="debit">Money out</option></select></label>}<label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label><label><span>Account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Category</span><select name="category_id"><option value="">No category</option>{categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Payment method</span><select name="payment_method"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Paid to / received from</span><input name="party_name" /></label><label><span>Party type</span><select name="party_type"><option value="other">Other</option><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="agent">Agent</option><option value="employee">Employee</option><option value="lender">Lender</option></select></label>{!expense && <label><span>Source</span><select name="source_type"><option value="manual_adjustment">Manual entry</option><option value="customer_payment">Customer payment</option><option value="supplier_payment">Supplier payment</option><option value="subsidy_received">Subsidy received</option><option value="agent_commission">Agent commission</option></select></label>}<label><span>Project (optional)</span><select name="project_id"><option value="">General company entry</option>{projects.map((row) => <option value={row.project_id} key={row.project_id}>{row.project_number} · {row.customer_name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Description</span><input name="description" required /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working || !accounts.length}>Post {expense ? 'expense' : 'transaction'}</button></footer></form>
}

function AccountForm({ working, onSubmit }: { working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Account name</span><input name="name" required /></label><label><span>Type</span><select name="account_type"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="petty_cash">Petty cash</option></select></label><label><span>Bank name</span><input name="bank_name" /></label><label><span>Masked account number</span><input name="masked_account_number" placeholder="•••• 1234" /></label><label><span>Opening balance</span><input type="number" step="0.01" name="opening_balance" defaultValue="0" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Create account</button></footer></form> }

function TransferForm({ accounts, working, onSubmit }: { accounts: FinancialAccount[]; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" required /></label><label><span>From account</span><select name="source_account_id" required><option value="">Select source</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name} · {money.format(row.current_balance)}</option>)}</select></label><label><span>To account</span><select name="destination_account_id" required><option value="">Select destination</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label><span>Description</span><input name="description" defaultValue="Account transfer" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Transfer money</button></footer></form> }

function BillForm({ customers, projects, initialType, working, onSubmit }: { customers: BillCustomerOption[]; projects: ProjectTimelineListItem[]; initialType: 'sales' | 'purchase'; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const [type, setType] = useState<'sales' | 'purchase'>(initialType)
  const [customerId, setCustomerId] = useState('')
  const availableProjects = type === 'sales' ? projects.filter((row) => row.customer_id === customerId) : projects

  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid">
    <label><span>Bill type</span><select name="bill_type" value={type} onChange={(event) => { setType(event.target.value as 'sales' | 'purchase'); setCustomerId('') }}><option value="sales">Sales bill</option><option value="purchase">Purchase bill</option></select></label>
    <label><span>Bill number</span><input name="bill_number" required /></label>
    <label><span>Bill date</span><input type="date" name="bill_date" defaultValue={today()} required /></label>
    <label><span>Due date</span><input type="date" name="due_date" /></label>
    {type === 'sales'
      ? <label className="erp-form-wide"><span>Customer</span><select name="customer_id" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required><option value="">Select customer</option>{customers.map((row) => <option value={row.id} key={row.id}>{row.customer_name}</option>)}</select></label>
      : <label className="erp-form-wide"><span>Supplier name</span><input name="supplier_name" required /></label>}
    <label><span>Project (optional)</span><select name="project_id" disabled={type === 'sales' && !customerId}><option value="">{type === 'sales' ? 'No linked project' : 'General purchase'}</option>{availableProjects.map((row) => <option value={row.project_id} key={row.project_id}>{row.project_number} · {row.customer_name}</option>)}</select></label>
    <label><span>Subtotal</span><input type="number" name="subtotal" min="0.01" step="0.01" required /></label>
    <label><span>Tax</span><input type="number" name="tax_amount" min="0" step="0.01" defaultValue="0" /></label>
    <label className="erp-form-wide"><span>Note</span><textarea name="note" /></label>
  </div><footer className="erp-form-actions"><button className="primary-button" disabled={working || (type === 'sales' && !customers.length)}>{working ? 'Creating…' : `Create ${type} bill`}</button></footer></form>
}

function PaymentForm({ accounts, amount, working, onSubmit }: { accounts: FinancialAccount[]; amount: number; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} required /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" max={amount} step="0.01" defaultValue={amount} required /></label><label><span>Account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Method</span><select name="payment_method"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Reference</span><input name="reference_number" /></label><label><span>Description</span><input name="description" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Record payment</button></footer></form> }

function CompanyLoanForm({ accounts, working, onSubmit }: { accounts: FinancialAccount[]; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Lender</span><input name="lender_name" required /></label><label><span>Loan account number</span><input name="loan_account_number" /></label><label><span>Principal</span><input type="number" name="principal_amount" min="0.01" step="0.01" required /></label><label><span>Interest rate %</span><input type="number" name="interest_rate" min="0" step="0.001" /></label><label><span>EMI</span><input type="number" name="emi_amount" min="0" step="0.01" /></label><label><span>Disbursement account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Start date</span><input type="date" name="start_date" defaultValue={today()} required /></label><label><span>End date</span><input type="date" name="end_date" /></label><label><span>Next due date</span><input type="date" name="next_due_date" /></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Create company loan</button></footer></form> }

function LoanPaymentForm({ accounts, amount, working, onSubmit }: { accounts: FinancialAccount[]; amount: number; working: boolean; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} required /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" defaultValue={amount} required /></label><label><span>Paid from</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Note</span><input name="note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Record loan payment</button></footer></form> }
