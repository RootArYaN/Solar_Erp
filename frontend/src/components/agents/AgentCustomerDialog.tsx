import { Building2, Mail, MapPin, Phone, UserRound } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { AgentCustomer, CreateAgentCustomerInput } from '../../types'
import { Modal } from '../admin/Modal'

export function AgentCustomerDialog({ busy, customer, onClose, onSubmit }: {
  busy: boolean
  customer?: AgentCustomer
  onClose: () => void
  onSubmit: (value: CreateAgentCustomerInput) => Promise<void>
}) {
  const [customerName, setCustomerName] = useState(customer?.customer_name ?? '')
  const [companyName, setCompanyName] = useState(customer?.company_name ?? '')
  const [email, setEmail] = useState(customer?.email ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [address, setAddress] = useState(customer?.address ?? '')
  const [projectName, setProjectName] = useState(customer?.project_name ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit({ customer_name: customerName, company_name: companyName, email, phone, address, project_name: projectName })
  }

  return <Modal title={customer ? 'Edit customer' : 'Register customer'} onClose={onClose}>
    <form className="admin-form" onSubmit={submit}>
      <div className="admin-form__grid">
        <label className="field"><span>Customer name</span><div className="field__control"><UserRound size={17} /><input required minLength={2} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></div></label>
        <label className="field"><span>Company name</span><div className="field__control"><Building2 size={17} /><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></div></label>
      </div>
      <div className="admin-form__grid">
        <label className="field"><span>Phone</span><div className="field__control"><Phone size={17} /><input required minLength={7} value={phone} onChange={(event) => setPhone(event.target.value)} /></div></label>
        <label className="field"><span>Email</span><div className="field__control"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
      </div>
      <label className="field"><span>Address</span><div className="field__control"><MapPin size={17} /><input value={address} onChange={(event) => setAddress(event.target.value)} /></div></label>
      <label className="field"><span>Initial project / enquiry</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Example: 25 kW rooftop solar" /></label>
      {customer?.can_edit && <p className="agent-customer-edit-note">Agents can save customer changes once. Admin and super-admin accounts are not limited.</p>}
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button primary-button--compact" disabled={busy || customerName.trim().length < 2 || phone.trim().length < 7}>{busy ? 'Saving…' : customer ? 'Save customer' : 'Register customer'}</button></footer>
    </form>
  </Modal>
}
