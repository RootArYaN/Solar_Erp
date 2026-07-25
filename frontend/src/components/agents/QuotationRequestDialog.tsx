import { Gauge, MapPin, MessageSquareText } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { AgentCustomer, CreateQuotationRequestInput } from '../../types'
import { Modal } from '../admin/Modal'

export function QuotationRequestDialog({ customer, busy, onClose, onSubmit }: {
  customer: AgentCustomer
  busy: boolean
  onClose: () => void
  onSubmit: (value: CreateQuotationRequestInput) => Promise<void>
}) {
  const [summary, setSummary] = useState(customer.project_name || 'Rooftop solar EPC quotation')
  const [capacity, setCapacity] = useState('')
  const [siteAddress, setSiteAddress] = useState(customer.address)
  const [notes, setNotes] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit({ requirement_summary: summary, proposed_capacity_kw: Number(capacity), site_address: siteAddress, notes })
  }

  return <Modal title={`Request quotation for ${customer.customer_name}`} className="quotation-request-modal" hideTitle onClose={onClose}>
    <form className="admin-form quotation-request-form" onSubmit={submit}>
      <div className="quotation-request-fields">
        <label className="field"><span>Requirement</span><div className="field__control"><MessageSquareText size={17} /><input required minLength={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></div></label>
        <label className="field"><span>Proposed capacity (kW)</span><div className="field__control"><Gauge size={17} /><input required min="0.01" step="0.01" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></div></label>
        <label className="field"><span>Site address</span><div className="field__control"><MapPin size={17} /><input value={siteAddress} onChange={(event) => setSiteAddress(event.target.value)} /></div></label>
        <label className="field"><span>Notes for admin</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={600} placeholder="Roof type, preferred modules, subsidy or timeline" /></label>
      </div>
      <div className="workflow-note quotation-request-note">Sends directly to the admin approval center.</div>
      <footer className="modal-actions quotation-request-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button primary-button--compact" disabled={busy}>{busy ? 'Sending…' : 'Send to admin'}</button></footer>
    </form>
  </Modal>
}
