import type { FinanceTransactionList } from '../../erp-types'

export const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
export const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function monthStart() {
  const date = new Date()
  date.setDate(1)
  return date.toISOString().slice(0, 10)
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
