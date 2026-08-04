import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BadgeIndianRupee, Banknote, BarChart3, CalendarDays, Download, FileSpreadsheet, FileText, Landmark, Pencil, Plus, ReceiptText, RotateCcw, Search, Trash2, Upload } from 'lucide-react'
import type { Bill, BillList, CompanyLoan, FinanceOverview, FinanceTransaction, FinanceTransactionList, FinancialAccount, Profitability } from '../../erp-types'
import { EmptyState } from '../ui/PageState'
import { KpiGrid } from '../workspace'
import { exportLedgerCsv, label, money, monthStart, shortDate, today, toDateInputValue } from './finance-utils'

type DateRangeProps = {
  dateFrom: string
  setDateFrom: (value: string) => void
  dateTo: string
  setDateTo: (value: string) => void
}

function DateRangeFields({ dateFrom, setDateFrom, dateTo, setDateTo }: DateRangeProps) {
  return <>
    <label className="finance-date-field"><input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} required /></label>
    <label className="finance-date-field"><input type="date" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} required /></label>
  </>
}

export function Overview({ data, dateFrom, setDateFrom, dateTo, setDateTo, reload }: { data: FinanceOverview; reload: () => void } & DateRangeProps) {
  const cards = [
    ['Money in', data.money_in_month, ArrowDownLeft, 'positive'], ['Money out', data.money_out_month, ArrowUpRight, 'negative'],
    ['Bank balance', data.bank_balance, Landmark, 'neutral'], ['Cash balance', data.cash_balance, Banknote, 'neutral'],
    ['Customer receivables', data.customer_receivables, BadgeIndianRupee, 'warning'], ['Supplier payables', data.supplier_payables, ReceiptText, 'warning'],
    ['Expenses', data.expenses_month, CalendarDays, 'negative'], ['Net cash flow', data.net_cash_flow, BarChart3, data.net_cash_flow >= 0 ? 'positive' : 'negative'],
  ] as const
  const maxFlow = Math.max(1, ...data.monthly_flow.flatMap((row) => [row.money_in, row.money_out]))
  const maxExpense = Math.max(1, ...data.expense_by_category.map((row) => row.amount))
  return <>
    <div className="finance-range-toolbar">
      <DateRangeFields dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      <button className="secondary-button finance-range-apply" onClick={reload}>Apply</button>
    </div>
    <KpiGrid columns={4} phoneColumns={2} responsive className="finance-kpis">
      {cards.map(([name, value, Icon, tone]) => (
        <article className={`finance-kpi finance-kpi--${tone}`} key={name}>
          <span><Icon size={17} /></span>
          <div><small>{name}</small><strong>{money.format(value)}</strong></div>
        </article>
      ))}
    </KpiGrid>
    <div className="finance-overview-grid">
      <section className="erp-panel finance-overview-card finance-overview-card--table">
        <header><div><strong>Recent transactions</strong></div></header>
        <TransactionTable rows={data.recent_transactions} compact />
      </section>
      <section className="erp-panel finance-overview-card">
        <header>
          <div><strong>Monthly cash flow</strong></div>
          <div className="cash-flow-legend"><span><i /> Money in</span><span><i /> Money out</span></div>
        </header>
        {!data.monthly_flow.length ? <EmptyState title="No monthly movement yet" /> : <div className="cash-flow-chart">{data.monthly_flow.map((row) => <div key={row.month}><div><i style={{ height: `${Math.max(4, (row.money_in / maxFlow) * 100)}%` }} title={`Money in ${money.format(row.money_in)}`} /><b style={{ height: `${Math.max(4, (row.money_out / maxFlow) * 100)}%` }} title={`Money out ${money.format(row.money_out)}`} /></div><span>{row.month}</span></div>)}</div>}
      </section>
      <section className="erp-panel finance-overview-card finance-overview-card--table">
        <header><div><strong>Pending bills</strong></div></header>
        <BillTable rows={data.pending_bills} compact />
      </section>
      <section className="erp-panel finance-overview-card">
        <header><div><strong>Expense mix</strong></div></header>
        {!data.expense_by_category.length ? <EmptyState title="No expenses in this period" /> : <div className="expense-breakdown">{data.expense_by_category.map((row) => <div key={row.category}><div><span>{row.category}</span><strong>{money.format(row.amount)}</strong></div><i><b style={{ width: `${(row.amount / maxExpense) * 100}%` }} /></i></div>)}</div>}
      </section>
    </div>
  </>
}

export function Transactions({ data, rows, search, setSearch, direction, setDirection, dateFrom, setDateFrom, dateTo, setDateTo, reload, reportMode, canEdit, onEdit, onReverse, onDelete }: { data: FinanceTransactionList | null; rows: FinanceTransactionList['data']; search: string; setSearch: (value: string) => void; direction: string; setDirection: (value: string) => void; dateFrom: string; setDateFrom: (value: string) => void; dateTo: string; setDateTo: (value: string) => void; reload: () => void; reportMode: boolean; canEdit: boolean; onEdit: (row: FinanceTransaction) => void; onReverse: (row: FinanceTransaction) => void; onDelete: (row: FinanceTransaction) => void }) {
  return <>
    <section className="mini-kpis finance-ledger-kpis">
      <article><span>Money in</span><strong>{money.format(data?.money_in ?? 0)}</strong></article>
      <article><span>Money out</span><strong>{money.format(data?.money_out ?? 0)}</strong></article>
      <article><span>Net</span><strong>{money.format((data?.money_in ?? 0) - (data?.money_out ?? 0))}</strong></article>
      <article><span>Entries</span><strong>{data?.total ?? 0}</strong></article>
    </section>
    <div className="finance-ledger-toolbar">
      <label className="finance-ledger-field"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="finance-ledger-field"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <label className="finance-ledger-field finance-ledger-direction"><select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All</option><option value="credit">Money in</option><option value="debit">Money out</option></select></label>
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

export function Expenses({ data, dateFrom, setDateFrom, dateTo, setDateTo, reload, canEdit, onAdd, onEdit, onDelete }: { data: FinanceTransactionList | null; dateFrom: string; setDateFrom: (value: string) => void; dateTo: string; setDateTo: (value: string) => void; reload: () => void; canEdit: boolean; onAdd: () => void; onEdit: (row: FinanceTransaction) => void; onDelete: (row: FinanceTransaction) => void }) {
  const isToday = dateFrom === today() && dateTo === today()
  return <>
    <section className="mini-kpis finance-expense-kpis">
      <article><span>{isToday ? "Today's expense" : 'Selected expenses'}</span><strong>{money.format(data?.money_out ?? 0)}</strong></article>
      <article><span>Entries</span><strong>{data?.total ?? 0}</strong></article>
      <article><span>Average</span><strong>{money.format((data?.money_out ?? 0) / Math.max(1, data?.total ?? 0))}</strong></article>
    </section>
    <div className="finance-expense-toolbar">
      <div className="finance-expense-presets">
        <button onClick={() => { setDateFrom(today()); setDateTo(today()) }}>Today</button>
        <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); const value = toDateInputValue(d); setDateFrom(value); setDateTo(value) }}>Yesterday</button>
        <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 6); setDateFrom(toDateInputValue(d)); setDateTo(today()) }}>This week</button>
        <button onClick={() => { setDateFrom(monthStart()); setDateTo(today()) }}>This month</button>
      </div>
      <label className="finance-expense-date"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
      <label className="finance-expense-date"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      <button className="secondary-button finance-expense-apply" onClick={reload}>Apply</button>
      {canEdit && <button className="primary-button finance-expense-create" onClick={onAdd}><Plus size={14} /> Add expense</button>}
    </div>
    <TransactionTable rows={data?.data ?? []} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
  </>
}

export function Bills({ data, billType, setBillType, dateFrom, setDateFrom, dateTo, setDateTo, reload, canEdit, onAdd, onEdit, onPay, onDelete, onUpload, onDownload }: { data: BillList | null; billType: string; setBillType: (value: string) => void; reload: () => void; canEdit: boolean; onAdd: () => void; onEdit: (bill: Bill) => void; onPay: (bill: Bill) => void; onDelete: (bill: Bill) => void; onUpload: (bill: Bill, file: File) => void; onDownload: (bill: Bill) => void } & DateRangeProps) {
  return <>
    <section className="mini-kpis finance-bill-kpis">
      <article><span>Total bills</span><strong>{data?.total ?? 0}</strong></article>
      <article><span>Outstanding</span><strong>{money.format(data?.data.reduce((sum, row) => sum + row.balance_amount, 0) ?? 0)}</strong></article>
      <article><span>Paid</span><strong>{money.format(data?.data.reduce((sum, row) => sum + row.paid_amount, 0) ?? 0)}</strong></article>
    </section>
    <div className="finance-bills-toolbar">
      <DateRangeFields dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} />
      <label className="finance-bill-type">
        <select value={billType} onChange={(event) => setBillType(event.target.value)}>
          <option value="">All bills</option>
          <option value="sales">Sales</option>
          <option value="purchase">Purchase</option>
        </select>
      </label>
      <button className="secondary-button finance-bill-apply" onClick={reload}>Apply</button>
      {canEdit && <button className="primary-button finance-bill-create" onClick={onAdd}><Plus size={14} /> Create bill</button>}
    </div>
    <BillTable rows={data?.data ?? []} onEdit={canEdit ? onEdit : undefined} onPay={canEdit ? onPay : undefined} onDelete={canEdit ? onDelete : undefined} onUpload={canEdit ? onUpload : undefined} onDownload={onDownload} />
  </>
}

export function Accounts({ rows, canEdit, onAdd, onTransfer }: { rows: FinancialAccount[]; canEdit: boolean; onAdd: () => void; onTransfer: () => void }) {
  return <><div className="tab-toolbar"><div></div>{canEdit && <div><button className="secondary-button" onClick={onTransfer}><ArrowRightLeft size={14} /> Transfer</button><button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Account</button></div>}</div><section className="account-grid">{rows.map((row) => <article key={row.id}><span className={`account-icon account-icon--${row.account_type}`}><Landmark size={18} /></span><div><small>{label(row.account_type)}</small><strong>{row.name}</strong><p>{row.bank_name || row.masked_account_number || 'Internal account'}</p></div><b>{money.format(row.current_balance)}</b></article>)}{!rows.length && <EmptyState title="No financial accounts" />}</section></>
}

export function Loans({ rows, canEdit, onAdd, onEdit, onPay, onDelete }: { rows: CompanyLoan[]; canEdit: boolean; onAdd: () => void; onEdit: (loan: CompanyLoan) => void; onPay: (loan: CompanyLoan) => void; onDelete: (loan: CompanyLoan) => void }) {
  return <><div className="tab-toolbar"><div></div>{canEdit && <button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Company loan</button>}</div>{!rows.length ? <EmptyState title="No company loans" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Lender</th><th>Principal</th><th>Outstanding</th><th>Interest</th><th>EMI</th><th>Next due</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.lender_name}</strong><small>{row.loan_account_number}</small></td><td>{money.format(row.principal_amount)}</td><td>{money.format(row.outstanding_amount)}</td><td>{row.interest_rate}%</td><td>{money.format(row.emi_amount)}</td><td>{row.next_due_date ? shortDate.format(new Date(row.next_due_date)) : '—'}</td><td><span className="soft-badge">{label(row.status)}</span></td><td>{canEdit && <div className="erp-row-actions"><button className="secondary-button secondary-button--compact" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>{row.status !== 'closed' && <button className="secondary-button secondary-button--compact" onClick={() => onPay(row)}>Pay</button>}<button type="button" className="danger-icon-button finance-transaction-delete" onClick={() => onDelete(row)} aria-label={`Delete loan from ${row.lender_name}`} title="Delete loan"><Trash2 size={14} /></button></div>}</td></tr>)}</tbody></table></div>}</>
}

export function ProfitabilityPanel({ data, dateFrom, setDateFrom, dateTo, setDateTo, reload }: { data: Profitability | null; reload: () => void } & DateRangeProps) {
  if (!data) return <EmptyState title="No profitability data" />
  return <><div className="finance-range-toolbar"><DateRangeFields dateFrom={dateFrom} setDateFrom={setDateFrom} dateTo={dateTo} setDateTo={setDateTo} /><button className="secondary-button finance-range-apply" onClick={reload}>Apply</button></div><section className="finance-kpis"><article className="finance-kpi"><span><BadgeIndianRupee size={17} /></span><div><small>Sales value</small><strong>{money.format(data.sales_value)}</strong></div></article><article className="finance-kpi"><span><ArrowDownLeft size={17} /></span><div><small>Money received</small><strong>{money.format(data.money_received)}</strong></div></article><article className="finance-kpi"><span><ReceiptText size={17} /></span><div><small>Material + project cost</small><strong>{money.format(data.material_cost + data.project_expenses)}</strong></div></article><article className="finance-kpi"><span><BarChart3 size={17} /></span><div><small>Estimated gross profit</small><strong>{money.format(data.estimated_gross_profit)}</strong></div></article></section>{!data.projects.length ? <EmptyState title="No project profitability for this period" /> : <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Project</th><th>Sales value</th><th>Money received</th><th>Cost</th><th>Gross profit</th></tr></thead><tbody>{data.projects.map((row) => <tr key={row.project_id}><td><strong>{row.project_number}</strong><small>{row.project_name}</small></td><td>{money.format(row.sales_value)}</td><td>{money.format(row.money_received)}</td><td>{money.format(row.cost)}</td><td className={row.gross_profit >= 0 ? 'money-in' : 'money-out'}>{money.format(row.gross_profit)}</td></tr>)}</tbody></table></div>}</>
}

export function TransactionTable({ rows, compact = false, canEdit = false, onEdit, onReverse, onDelete }: { rows: FinanceTransactionList['data']; compact?: boolean; canEdit?: boolean; onEdit?: (row: FinanceTransaction) => void; onReverse?: (row: FinanceTransaction) => void; onDelete?: (row: FinanceTransaction) => void }) {
  if (!rows.length) return <EmptyState title="No transactions found" />
  return <div className={`erp-table-wrap ${compact ? 'erp-table-wrap--compact' : ''}`}><table className="erp-table"><thead><tr><th>Date</th><th>Transaction / party</th><th>Category / source</th>{!compact && <th>Account</th>}<th>Money in</th><th>Money out</th>{!compact && <th>Status</th>}{canEdit && <th />}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate.format(new Date(row.transaction_date))}</td><td><strong>{row.transaction_number}</strong><small>{row.party_name || row.description}</small></td><td>{row.category_name || label(row.source_type)}<small>{row.reference_number}</small></td>{!compact && <td>{row.account_name}<small>{label(row.payment_method)}</small></td>}<td className="money-in">{row.direction === 'credit' ? money.format(row.amount) : '—'}</td><td className="money-out">{row.direction === 'debit' ? money.format(row.amount) : '—'}</td>{!compact && <td><span className="soft-badge">{label(row.status)}</span></td>}{canEdit && <td><div className="erp-row-actions">{onEdit && <button className="secondary-button secondary-button--compact" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>}{row.status === 'posted' && onReverse && <button className="secondary-button secondary-button--compact" onClick={() => onReverse(row)}><RotateCcw size={13} /> Reverse</button>}{onDelete && <button type="button" className="danger-icon-button finance-transaction-delete" onClick={() => onDelete(row)} aria-label={`Delete ${row.transaction_number}`} title="Delete transaction"><Trash2 size={14} /></button>}</div></td>}</tr>)}</tbody></table></div>
}

export function BillTable({ rows, compact = false, onEdit, onPay, onDelete, onUpload, onDownload }: { rows: Bill[]; compact?: boolean; onEdit?: (bill: Bill) => void; onPay?: (bill: Bill) => void; onDelete?: (bill: Bill) => void; onUpload?: (bill: Bill, file: File) => void; onDownload?: (bill: Bill) => void }) {
  if (!rows.length) return <EmptyState title="No bills found" />
  const hasActions = Boolean(onEdit || onPay || onDelete || onUpload || onDownload)
  return <div className={`erp-table-wrap ${compact ? 'erp-table-wrap--compact' : ''}`}><table className="erp-table"><thead><tr><th>Bill / party</th><th>Type</th><th>Total</th><th>Paid</th><th>Balance</th>{!compact && <th>Due</th>}<th>Status</th>{hasActions && <th />}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.bill_number}</strong><small>{row.customer_name || row.supplier_name}</small></td><td>{label(row.bill_type)}</td><td>{money.format(row.total_amount)}</td><td>{money.format(row.paid_amount)}</td><td>{money.format(row.balance_amount)}</td>{!compact && <td>{row.due_date ? shortDate.format(new Date(row.due_date)) : '—'}</td>}<td><span className="soft-badge">{label(row.payment_status)}</span></td>{hasActions && <td><div className="erp-row-actions">{onEdit && <button className="secondary-button secondary-button--compact" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button>}{onPay && row.balance_amount > 0 && <button className="secondary-button secondary-button--compact" onClick={() => onPay(row)}>Pay</button>}{row.file_id && onDownload && <button type="button" className="secondary-button secondary-button--compact" onClick={() => onDownload(row)}><Download size={13} /> Bill</button>}{!row.file_id && onUpload && <label className="secondary-button secondary-button--compact finance-bill-upload"><Upload size={13} /> Upload<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label={`Upload attachment for ${row.bill_number}`} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(row, file) }} /></label>}{onDelete && <button type="button" className="danger-icon-button finance-transaction-delete" onClick={() => onDelete(row)} aria-label={`Delete bill ${row.bill_number}`} title="Delete bill"><Trash2 size={14} /></button>}</div></td>}</tr>)}</tbody></table></div>
}
