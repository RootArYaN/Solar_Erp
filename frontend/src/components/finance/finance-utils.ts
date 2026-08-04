import type { FinanceTransactionList } from '../../erp-types'

export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function today() {
  return toDateInputValue(new Date())
}

export function monthStart() {
  const date = new Date()
  date.setDate(1)
  return toDateInputValue(date)
}

export function exportLedgerCsv(rows: FinanceTransactionList['data']) {
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
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
