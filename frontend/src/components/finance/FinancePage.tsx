import {
  ArrowRightLeft,
  BarChart3,
  Building2,
  FileSpreadsheet,
  FileText,
  Landmark,
  Plus,
  ReceiptText,
  RefreshCw,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createBill,
  createCompanyLoan,
  createFinanceTransaction,
  createFinancialAccount,
  deleteBill,
  deleteBillPayment,
  downloadMergedBills,
  deleteCompanyLoan,
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
  updateBill,
  updateCompanyLoan,
  updateFinanceTransaction,
} from '../../api/finance'
import { downloadStoredFile, removeStoredFile, uploadStoredFile } from '../../api/files'
import type { Bill, BillCustomerOption, BillList, BillPayment, CompanyLoan, FinanceCategory, FinanceOverview, FinanceTransaction, FinanceTransactionList, FinancialAccount, Profitability } from '../../erp-types'
import { fileUploadRules, validateUploadFile } from '../../lib/file-validation'
import { getModuleAccess, PERMISSIONS } from '../../lib/permissions'
import { getProjectTimelines } from '../../api/workflow'
import type { ProjectTimelineListItem, Session } from '../../types'
import { Modal } from '../admin/Modal'
import { AlertDialog } from '../ui/AlertDialog'
import { Button } from '../ui/Button'
import { ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { TabButton, TabStrip, WorkspaceHeader, WorkspacePage } from '../workspace'
import { Accounts, Bills, Expenses, Loans, Overview, ProfitabilityPanel, Transactions } from './FinanceSections'
import { AccountForm, BillForm, CompanyLoanForm, EditBillForm, EditCompanyLoanForm, EditTransactionForm, LoanPaymentForm, PaymentForm, TransactionForm, TransferForm } from './FinanceForms'
import { money, monthStart, today } from './finance-utils'

type Tab = 'overview' | 'transactions' | 'expenses' | 'bills' | 'accounts' | 'loans' | 'profitability' | 'reports'
type Dialog = 'transaction' | 'edit-transaction' | 'expense' | 'account' | 'transfer' | 'bill' | 'edit-bill' | 'bill-payment' | 'loan' | 'edit-loan' | 'loan-payment' | 'reverse-transaction' | null
const tabs: Tab[] = ['overview', 'transactions', 'expenses', 'bills', 'accounts', 'loans', 'profitability', 'reports']


export function FinancePage({ session }: { session: Session }) {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(() => tabs.includes(requestedTab as Tab) ? requestedTab as Tab : 'overview')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [downloadingMergedBills, setDownloadingMergedBills] = useState(false)
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
  const [billToDelete, setBillToDelete] = useState<Bill | null>(null)
  const [billPaymentToDelete, setBillPaymentToDelete] = useState<{ bill: Bill; payment: BillPayment } | null>(null)
  const [billAttachmentToRemove, setBillAttachmentToRemove] = useState<Bill | null>(null)
  const [loanToDelete, setLoanToDelete] = useState<CompanyLoan | null>(null)
  const [dateFrom, setDateFrom] = useState(monthStart())
  const [dateTo, setDateTo] = useState(today())
  const [allTransactionDates, setAllTransactionDates] = useState(true)
  const [allBillDates, setAllBillDates] = useState(true)
  const [direction, setDirection] = useState(() => ['credit', 'debit'].includes(searchParams.get('direction') ?? '') ? searchParams.get('direction') ?? '' : '')
  const [billType, setBillType] = useState(() => ['sales', 'purchase'].includes(searchParams.get('bill_type') ?? '') ? searchParams.get('bill_type') ?? '' : '')
  const [search, setSearch] = useState('')
  const { toast } = useToast()
  const access = getModuleAccess(session, 'finance')

  function rangeQuery() {
    return new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
  }

  function validDateRange() {
    if (!dateFrom || !dateTo) {
      setError('Choose both a From date and a To date.')
      return false
    }
    if (dateFrom <= dateTo) return true
    setError('The From date must be on or before the To date.')
    return false
  }

  async function loadBase() {
    if (!validDateRange()) return
    setLoading(true); setError('')
    try {
      const projectRequest = session.permissions.includes(PERMISSIONS.projects.view) ? getProjectTimelines() : Promise.resolve([])
      const [nextOverview, nextAccounts, nextCategories, nextProjects, nextBillCustomers] = await Promise.all([getFinanceOverview(rangeQuery().toString()), getFinancialAccounts(), getFinanceCategories(), projectRequest, getBillCustomers()])
      setOverview(nextOverview); setAccounts(nextAccounts); setCategories(nextCategories); setProjects(nextProjects); setBillCustomers(nextBillCustomers)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load company finance') }
    finally { setLoading(false) }
  }

  async function loadTab(nextTab = tab) {
    if (!validDateRange()) return
    setLoading(true); setError('')
    try {
      if (nextTab === 'overview') setOverview(await getFinanceOverview(rangeQuery().toString()))
      if (nextTab === 'transactions' || nextTab === 'reports') {
        const query = new URLSearchParams({ page_size: '100' })
        if (!allTransactionDates) {
          query.set('date_from', dateFrom)
          query.set('date_to', dateTo)
        }
        if (direction) query.set('direction', direction)
        setTransactions(await getFinanceTransactions(query.toString()))
      }
      if (nextTab === 'expenses') setExpenses(await getExpenses(new URLSearchParams({ date_from: dateFrom, date_to: dateTo, page_size: '100' }).toString()))
      if (nextTab === 'bills') {
        const query = new URLSearchParams({ page_size: '100' })
        if (!allBillDates) {
          query.set('date_from', dateFrom)
          query.set('date_to', dateTo)
        }
        if (billType) query.set('bill_type', billType)
        setBills(await getBills(query.toString()))
      }
      if (nextTab === 'accounts') setAccounts(await getFinancialAccounts())
      if (nextTab === 'loans') setLoans(await getCompanyLoans())
      if (nextTab === 'profitability') setProfitability(await getProfitability(rangeQuery().toString()))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load finance data') }
    finally { setLoading(false) }
  }

  useEffect(() => { void loadBase() }, [])
  const baseLoaded = overview !== null
  useEffect(() => { if (baseLoaded && tab !== 'overview') void loadTab(tab) }, [tab, baseLoaded])

  async function refreshAll() {
    await Promise.all([loadBase(), loadTab(tab)])
  }

  async function submitTransaction(event: FormEvent<HTMLFormElement>, expense = false) {
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

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await createFinancialAccount({ name: form.get('name'), account_type: form.get('account_type'), bank_name: form.get('bank_name'), masked_account_number: form.get('masked_account_number'), opening_balance: Number(form.get('opening_balance') || 0) })
      setDialog(null); await refreshAll(); toast({ message: 'Financial account created', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create account', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await transferFinancialAccounts({ transaction_date: form.get('transaction_date'), source_account_id: form.get('source_account_id'), destination_account_id: form.get('destination_account_id'), amount: Number(form.get('amount') || 0), reference_number: form.get('reference_number'), description: form.get('description') })
      setDialog(null); await refreshAll(); toast({ message: 'Account transfer completed', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not transfer money', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    const attachment = form.get('attachment')
    try {
      if (attachment instanceof File && attachment.size > 0) {
        const validation = await validateUploadFile(attachment, fileUploadRules.bill)
        if (!validation.valid) {
          toast({ message: validation.message, variant: 'warning' })
          return
        }
      }
      const bill = await createBill({ bill_type: form.get('bill_type'), bill_number: form.get('bill_number'), bill_date: form.get('bill_date'), customer_id: form.get('customer_id') || null, supplier_name: form.get('supplier_name') || '', project_id: form.get('project_id') || null, subtotal: Number(form.get('subtotal') || 0), tax_amount: Number(form.get('tax_amount') || 0), due_date: form.get('due_date') || null, note: form.get('note') || '' })
      let attachmentError = ''
      if (attachment instanceof File && attachment.size > 0) {
        try {
          await uploadStoredFile({ file: attachment, ownerType: 'finance_bill', ownerId: bill.id, projectId: bill.project_id || undefined, customerId: bill.customer_id || undefined })
        } catch (reason) {
          attachmentError = reason instanceof Error ? reason.message : 'Attachment upload failed'
        }
      }
      setDialog(null); await refreshAll()
      toast(attachmentError
        ? { message: `Bill created, but the attachment was not uploaded: ${attachmentError}`, variant: 'warning' }
        : { message: 'Bill created without duplicating payment', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create bill', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitBillPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedBill) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await recordBillPayment(selectedBill.id, { transaction_date: form.get('transaction_date'), amount: Number(form.get('amount') || 0), account_id: form.get('account_id'), payment_method: form.get('payment_method'), reference_number: form.get('reference_number'), description: form.get('description') })
      setDialog(null); setSelectedBill(null); await refreshAll(); toast({ message: 'Bill payment recorded in the separate bill calculation', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not record bill payment', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitBillEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedBill) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await updateBill(selectedBill.id, { bill_number: form.get('bill_number'), bill_date: form.get('bill_date'), customer_id: form.get('customer_id') || null, supplier_name: form.get('supplier_name') || '', project_id: form.get('project_id') || null, subtotal: Number(form.get('subtotal') || 0), tax_amount: Number(form.get('tax_amount') || 0), due_date: form.get('due_date') || null, note: form.get('note') || '' })
      setDialog(null); setSelectedBill(null); await refreshAll(); toast({ message: 'Bill updated', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not update bill', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLoan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await createCompanyLoan({ lender_name: form.get('lender_name'), loan_account_number: form.get('loan_account_number'), principal_amount: Number(form.get('principal_amount') || 0), interest_rate: Number(form.get('interest_rate') || 0), emi_amount: Number(form.get('emi_amount') || 0), start_date: form.get('start_date'), end_date: form.get('end_date') || null, next_due_date: form.get('next_due_date') || null, account_id: form.get('account_id'), reference_number: form.get('reference_number'), note: form.get('note') })
      setDialog(null); await refreshAll(); toast({ message: 'Company loan and disbursement recorded', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create company loan', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLoanPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedLoan) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await recordCompanyLoanPayment(selectedLoan.id, { transaction_date: form.get('transaction_date'), amount: Number(form.get('amount') || 0), account_id: form.get('account_id'), reference_number: form.get('reference_number'), note: form.get('note') })
      setDialog(null); setSelectedLoan(null); await refreshAll(); toast({ message: 'Company loan payment recorded', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not record loan payment', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLoanEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedLoan) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await updateCompanyLoan(selectedLoan.id, { lender_name: form.get('lender_name'), loan_account_number: form.get('loan_account_number'), principal_amount: Number(form.get('principal_amount') || 0), interest_rate: Number(form.get('interest_rate') || 0), emi_amount: Number(form.get('emi_amount') || 0), start_date: form.get('start_date'), end_date: form.get('end_date') || null, next_due_date: form.get('next_due_date') || null, note: form.get('note') || '' })
      setDialog(null); setSelectedLoan(null); await refreshAll(); toast({ message: 'Company loan updated', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not update company loan', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedTransaction) return; setWorking(true); const form = new FormData(event.currentTarget)
    try {
      await reverseFinanceTransaction(selectedTransaction.id, { transaction_date: form.get('transaction_date'), reason: form.get('reason') })
      setDialog(null); setSelectedTransaction(null); await refreshAll(); toast({ message: 'Transaction reversed with a linked correction entry', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not reverse transaction', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitTransactionEdit(event: FormEvent<HTMLFormElement>) {
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

  async function confirmBillDelete() {
    if (!billToDelete) return
    setWorking(true)
    try {
      await deleteBill(billToDelete.id)
      setBillToDelete(null)
      await refreshAll()
      toast({ message: 'Bill and linked payment entries deleted', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not delete bill', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function confirmBillPaymentDelete() {
    if (!billPaymentToDelete) return
    setWorking(true)
    try {
      await deleteBillPayment(billPaymentToDelete.bill.id, billPaymentToDelete.payment.id)
      setBillPaymentToDelete(null)
      await refreshAll()
      toast({ message: 'Bill payment removed; bill and bank balances recalculated', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not remove bill payment', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function confirmLoanDelete() {
    if (!loanToDelete) return
    setWorking(true)
    try {
      await deleteCompanyLoan(loanToDelete.id)
      setLoanToDelete(null)
      await refreshAll()
      toast({ message: 'Company loan and linked ledger entries deleted', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not delete company loan', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function uploadBillAttachment(bill: Bill, file: File) {
    setWorking(true)
    try {
      const validation = await validateUploadFile(file, fileUploadRules.bill)
      if (!validation.valid) {
        toast({ message: validation.message, variant: 'warning' })
        return
      }
      await uploadStoredFile({ file, ownerType: 'finance_bill', ownerId: bill.id, projectId: bill.project_id || undefined, customerId: bill.customer_id || undefined })
      await loadTab('bills')
      toast({ message: `Attachment uploaded for ${bill.bill_number}`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not upload bill attachment', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function downloadBillAttachment(bill: Bill) {
    if (!bill.file_id) return
    try {
      await downloadStoredFile(bill.file_id, `${bill.bill_number}-attachment`)
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not download bill attachment', variant: 'error' })
    }
  }

  async function confirmBillAttachmentRemove() {
    const bill = billAttachmentToRemove
    if (!bill?.file_id) return
    setWorking(true)
    try {
      await removeStoredFile(bill.file_id)
      setBillAttachmentToRemove(null)
      await loadTab('bills')
      toast({ message: `Document removed from ${bill.bill_number}`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not remove bill document', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function downloadFilteredBills() {
    if (!allBillDates && !validDateRange()) return
    const query = new URLSearchParams()
    if (!allBillDates) {
      query.set('date_from', dateFrom)
      query.set('date_to', dateTo)
    }
    if (billType) query.set('bill_type', billType)
    setDownloadingMergedBills(true)
    try {
      await downloadMergedBills(query.toString())
      toast({ message: 'Filtered bill documents merged and downloaded', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not merge bill documents', variant: 'error' })
    } finally {
      setDownloadingMergedBills(false)
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
    <WorkspaceHeader
      className="module-page-header finance-page-header"
      eyebrow="Company finance"
      title="Finance workspace"
      actionsLayout="grid"
      actions={<>
        <Button variant="secondary" leadingIcon={<RefreshCw className={loading ? 'spin' : ''} size={14} />} onClick={() => void refreshAll()} disabled={loading}>Refresh</Button>
        {access.canEdit && <Button variant="primary" leadingIcon={<Plus size={14} />} onClick={() => setDialog('transaction')}>Add transaction</Button>}
      </>}
    />

    <TabStrip className="finance-tabs" label="Company finance sections">{([
      ['overview', WalletCards, 'Overview'], ['transactions', ArrowRightLeft, 'Transactions'], ['expenses', ReceiptText, 'Expenses'], ['bills', FileText, 'Bills'],
      ['accounts', Landmark, 'Bank & Cash'], ['loans', Building2, 'Loans'], ['profitability', BarChart3, 'Profitability'], ['reports', FileSpreadsheet, 'Reports'],
    ] as Array<[Tab, typeof WalletCards, string]>).map(([key, Icon, text]) => <TabButton active={tab === key} onClick={() => setTab(key)} key={key}><Icon size={14} /> {text}</TabButton>)}</TabStrip>

    {error && <div className="inline-error">{error}</div>}
    <div className={`finance-tab-panel finance-tab-panel--${tab}`} role="tabpanel" data-scroll-surface="tab-body">
      {loading ? <LoadingSkeleton rows={6} /> : <>
        {tab === 'overview' && overview && <Overview data={overview} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} reload={() => void loadTab('overview')} />}
        {(tab === 'transactions' || tab === 'reports') && <Transactions data={transactions} rows={visibleTransactions} search={search} setSearch={setSearch} direction={direction} setDirection={setDirection} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} allDates={allTransactionDates} setAllDates={setAllTransactionDates} reload={() => void loadTab(tab)} reportMode={tab === 'reports'} canEdit={access.canEdit} onEdit={(row) => { setSelectedTransaction(row); setDialog('edit-transaction') }} onReverse={(row) => { setSelectedTransaction(row); setDialog('reverse-transaction') }} onDelete={setTransactionToDelete} />}
        {tab === 'expenses' && <Expenses data={expenses} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} reload={() => void loadTab('expenses')} canEdit={access.canEdit} onAdd={() => setDialog('expense')} onEdit={(row) => { setSelectedTransaction(row); setDialog('edit-transaction') }} onDelete={setTransactionToDelete} />}
        {tab === 'bills' && <Bills data={bills} billType={billType} setBillType={setBillType} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} allDates={allBillDates} setAllDates={setAllBillDates} reload={() => void loadTab('bills')} canEdit={access.canEdit} onAdd={() => setDialog('bill')} onEdit={(bill) => { setSelectedBill(bill); setDialog('edit-bill') }} onPay={(bill) => { setSelectedBill(bill); setDialog('bill-payment') }} onDelete={setBillToDelete} onUpload={(bill, file) => void uploadBillAttachment(bill, file)} onDownload={(bill) => void downloadBillAttachment(bill)} onRemoveAttachment={setBillAttachmentToRemove} onRemovePayment={(bill, payment) => setBillPaymentToDelete({ bill, payment })} onDownloadMerged={() => void downloadFilteredBills()} downloadingMerged={downloadingMergedBills} />}
        {tab === 'accounts' && <Accounts rows={accounts} canEdit={access.canEdit} onAdd={() => setDialog('account')} onTransfer={() => setDialog('transfer')} />}
        {tab === 'loans' && <Loans rows={loans} canEdit={access.canEdit} onAdd={() => setDialog('loan')} onEdit={(loan) => { setSelectedLoan(loan); setDialog('edit-loan') }} onPay={(loan) => { setSelectedLoan(loan); setDialog('loan-payment') }} onDelete={setLoanToDelete} />}
        {tab === 'profitability' && <ProfitabilityPanel data={profitability} dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} reload={() => void loadTab('profitability')} />}
      </>}
    </div>

    {dialog === 'transaction' && <Modal className="finance-modal" title="Post transaction" subtitle="Use for actual company money movement only." onClose={() => setDialog(null)}><TransactionForm accounts={accounts} categories={categories} projects={projects} working={working} onSubmit={(event) => void submitTransaction(event)} /></Modal>}
    {dialog === 'expense' && <Modal className="finance-modal" title="Record company expense" subtitle="Daily expenses are this same data filtered by date." onClose={() => setDialog(null)}><TransactionForm accounts={accounts} categories={categories.filter((row) => row.category_type === 'expense')} projects={projects} working={working} expense onSubmit={(event) => void submitTransaction(event, true)} /></Modal>}
    {dialog === 'account' && <Modal className="finance-modal" title="Add financial account" subtitle="Bank, cash, UPI or petty-cash balance." onClose={() => setDialog(null)}><AccountForm working={working} onSubmit={submitAccount} /></Modal>}
    {dialog === 'transfer' && <Modal className="finance-modal" title="Transfer between accounts" subtitle="Creates two linked transaction sides in one operation." onClose={() => setDialog(null)}><TransferForm accounts={accounts} working={working} onSubmit={submitTransfer} /></Modal>}
    {dialog === 'bill' && <Modal className="finance-modal" title="Create bill" subtitle="A bill records money owed; it does not post a payment." onClose={() => setDialog(null)}><BillForm customers={billCustomers} projects={projects} initialType={billType === 'purchase' ? 'purchase' : 'sales'} working={working} onSubmit={submitBill} /></Modal>}
    {dialog === 'edit-bill' && selectedBill && <Modal className="finance-modal" title={`Edit ${selectedBill.bill_number}`} subtitle="Payment totals remain linked and cannot be reduced below the amount already paid." onClose={() => { setDialog(null); setSelectedBill(null) }}><EditBillForm bill={selectedBill} customers={billCustomers} projects={projects} working={working} onSubmit={submitBillEdit} /></Modal>}
    {dialog === 'bill-payment' && selectedBill && <Modal className="finance-modal" title={`Pay ${selectedBill.bill_number}`} subtitle={`${money.format(selectedBill.balance_amount)} outstanding`} onClose={() => setDialog(null)}><PaymentForm accounts={accounts} amount={selectedBill.balance_amount} working={working} onSubmit={submitBillPayment} /></Modal>}
    {dialog === 'loan' && <Modal className="finance-modal" title="Add company loan" subtitle="Separate from customer solar loans." onClose={() => setDialog(null)}><CompanyLoanForm accounts={accounts} working={working} onSubmit={submitLoan} /></Modal>}
    {dialog === 'edit-loan' && selectedLoan && <Modal className="finance-modal" title={`Edit ${selectedLoan.lender_name}`} subtitle="Changing principal updates the linked disbursement while preserving repayments." onClose={() => { setDialog(null); setSelectedLoan(null) }}><EditCompanyLoanForm loan={selectedLoan} working={working} onSubmit={submitLoanEdit} /></Modal>}
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
    <AlertDialog
      open={Boolean(billPaymentToDelete)}
      title="Remove this bill payment?"
      description={billPaymentToDelete ? `${billPaymentToDelete.bill.bill_number} · ${money.format(billPaymentToDelete.payment.amount)} from ${billPaymentToDelete.payment.account_name}. The bill outstanding and bank balance will be recalculated.` : ''}
      confirmLabel="Remove payment"
      icon="delete"
      loading={working}
      onCancel={() => setBillPaymentToDelete(null)}
      onConfirm={confirmBillPaymentDelete}
    />
    <AlertDialog
      open={Boolean(billAttachmentToRemove)}
      title="Remove bill document?"
      description={billAttachmentToRemove ? `The uploaded document will be removed from ${billAttachmentToRemove.bill_number}. The bill and its payment data will stay unchanged.` : ''}
      confirmLabel="Remove document"
      icon="delete"
      loading={working}
      onCancel={() => setBillAttachmentToRemove(null)}
      onConfirm={confirmBillAttachmentRemove}
    />
    <AlertDialog
      open={Boolean(billToDelete)}
      title="Delete bill?"
      description={billToDelete ? `${billToDelete.bill_number} · ${money.format(billToDelete.total_amount)}. Its attachment and linked payment ledger entries will also be deleted.` : ''}
      confirmLabel="Delete bill"
      icon="delete"
      loading={working}
      onCancel={() => setBillToDelete(null)}
      onConfirm={confirmBillDelete}
    />
    <AlertDialog
      open={Boolean(loanToDelete)}
      title="Delete company loan?"
      description={loanToDelete ? `${loanToDelete.lender_name} · ${money.format(loanToDelete.principal_amount)}. The disbursement and repayment ledger entries will also be deleted.` : ''}
      confirmLabel="Delete loan"
      icon="delete"
      loading={working}
      onCancel={() => setLoanToDelete(null)}
      onConfirm={confirmLoanDelete}
    />
  </WorkspacePage>
}
