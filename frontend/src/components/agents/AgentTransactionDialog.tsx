import { CalendarDays, IndianRupee, ReceiptText } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { AgentTransaction, CreateAgentTransactionInput } from '../../types'
import { Modal } from '../admin/Modal'

type EntrySide = 'credit' | 'debit'

export function AgentTransactionDialog({
  busy,
  transaction,
  onClose,
  onSubmit,
}: {
  busy: boolean
  transaction?: AgentTransaction | null
  onClose: () => void
  onSubmit: (value: CreateAgentTransactionInput) => Promise<void>
}) {
  const [entrySide, setEntrySide] = useState<EntrySide>(transaction?.debit ? 'debit' : 'credit')
  const [transactionType, setTransactionType] = useState(transaction?.transaction_type || 'commission')
  const [reference, setReference] = useState(transaction?.reference || '')
  const [description, setDescription] = useState(transaction?.description || '')
  const [amount, setAmount] = useState(transaction ? String(transaction.debit || transaction.credit) : '')
  const [transactionDate, setTransactionDate] = useState(() => transaction ? new Date(transaction.transaction_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const numericAmount = Number(amount)
    await onSubmit({
      transaction_date: new Date(`${transactionDate}T12:00:00`).toISOString(),
      project_id: transaction?.project_id || undefined,
      reference,
      transaction_type: transactionType,
      description,
      debit: entrySide === 'debit' ? numericAmount : 0,
      credit: entrySide === 'credit' ? numericAmount : 0,
    })
  }

  return (
    <Modal title={transaction ? `Edit ${transaction.reference || 'agent transaction'}` : 'Submit transaction'} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form__grid">
          <label className="field">
            <span>Transaction date</span>
            <div className="field__control"><CalendarDays size={17} /><input required type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} /></div>
          </label>
          <label className="field">
            <span>Reference</span>
            <div className="field__control"><ReceiptText size={17} /><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="COM-2026-053" /></div>
          </label>
        </div>

        <div className="admin-form__grid">
          <label className="field">
            <span>Movement type</span>
            <div className="field__control field__control--select">
              <select value={transactionType} onChange={(event) => setTransactionType(event.target.value)}>
                <option value="commission">Commission</option>
                <option value="collection">Collection adjustment</option>
                <option value="expense">Expense</option>
                <option value="payout">Payout</option>
                <option value="adjustment">Balance adjustment</option>
              </select>
            </div>
          </label>
          <label className="field">
            <span>Debit or credit</span>
            <div className="field__control field__control--select">
              <select value={entrySide} onChange={(event) => setEntrySide(event.target.value as EntrySide)}>
                <option value="credit">Credit — increase balance</option>
                <option value="debit">Debit — reduce balance</option>
              </select>
            </div>
          </label>
        </div>

        <label className="field">
          <span>Amount</span>
          <div className="field__control"><IndianRupee size={17} /><input required min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></div>
        </label>

        <label className="field">
          <span>Description</span>
          <textarea required value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Transaction note" />
        </label>



        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button primary-button--compact" disabled={busy || Number(amount) <= 0}>{busy ? 'Saving…' : transaction ? 'Save changes' : 'Submit for approval'}</button>
        </footer>
      </form>
    </Modal>
  )
}
