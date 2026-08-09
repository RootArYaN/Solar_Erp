import { BadgeCheck, Mail, MapPin, Phone, UserRound, Zap } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { AgentCustomer, CreateAgentCustomerInput } from '../../types'
import { Modal } from '../admin/Modal'

export function AgentCustomerDialog({ busy, customer, onClose, onSubmit }: { busy: boolean; customer?: AgentCustomer; onClose: () => void; onSubmit: (value: CreateAgentCustomerInput) => Promise<void> }) {
  const [form, setForm] = useState<CreateAgentCustomerInput>({
    customer_name: customer?.customer_name ?? '', company_name: '', email: customer?.email ?? '', phone: customer?.phone ?? '', alternate_phone: customer?.alternate_phone ?? '', address: customer?.address ?? '', billing_address: customer?.billing_address ?? '', site_address: customer?.site_address ?? customer?.address ?? '', district: customer?.district ?? '', state: customer?.state ?? 'Gujarat', postal_code: customer?.postal_code ?? '', consumer_number: customer?.consumer_number ?? '', electricity_provider: customer?.electricity_provider ?? '', customer_type: customer?.customer_type ?? 'residential', lead_source: customer?.lead_source ?? '', project_name: customer?.project_name ?? '',
  })
  const set = (key: keyof CreateAgentCustomerInput, value: string) => setForm((current) => ({ ...current, [key]: value }))
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSubmit(form) }

  return <Modal title={customer ? 'Edit customer' : 'Add customer'} subtitle="Customer and installation details" onClose={onClose}>
    <form className="admin-form" onSubmit={submit}>
      <div className="admin-form__grid"><label className="field"><span>Customer name</span><div className="field__control"><UserRound size={17} /><input required minLength={2} value={form.customer_name} onChange={(event) => set('customer_name', event.target.value)} /></div></label><label className="field"><span>Customer type</span><div className="field__control"><BadgeCheck size={17} /><select value={form.customer_type} onChange={(event) => set('customer_type', event.target.value)}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="society">Society</option><option value="institutional">Institutional</option></select></div></label></div>
      <div className="admin-form__grid"><label className="field"><span>Phone</span><div className="field__control"><Phone size={17} /><input required minLength={7} value={form.phone} onChange={(event) => set('phone', event.target.value)} /></div></label><label className="field"><span>Alternate phone</span><div className="field__control"><Phone size={17} /><input value={form.alternate_phone} onChange={(event) => set('alternate_phone', event.target.value)} /></div></label></div>
      <label className="field"><span>Email</span><div className="field__control"><Mail size={17} /><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} /></div></label>
      <label className="field"><span>Site address</span><div className="field__control"><MapPin size={17} /><input value={form.site_address} onChange={(event) => { set('site_address', event.target.value); if (!form.address) set('address', event.target.value) }} /></div></label>
      <div className="admin-form__grid"><label className="field"><span>District</span><div className="field__control"><input value={form.district} onChange={(event) => set('district', event.target.value)} /></div></label><label className="field"><span>Postal code</span><div className="field__control"><input inputMode="numeric" value={form.postal_code} onChange={(event) => set('postal_code', event.target.value)} /></div></label></div>
      <div className="admin-form__grid"><label className="field"><span>Consumer number</span><div className="field__control"><input value={form.consumer_number} onChange={(event) => set('consumer_number', event.target.value)} /></div></label><label className="field"><span>Electricity provider</span><div className="field__control"><Zap size={17} /><input value={form.electricity_provider} onChange={(event) => set('electricity_provider', event.target.value)} /></div></label></div>
      <div className="admin-form__grid"><label className="field"><span>How they found us</span><div className="field__control"><input value={form.lead_source} onChange={(event) => set('lead_source', event.target.value)} /></div></label><label className="field"><span>First project or request</span><div className="field__control"><input value={form.project_name} onChange={(event) => set('project_name', event.target.value)} placeholder="Example: 3.24 kW rooftop solar" /></div></label></div>
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button primary-button--compact" disabled={busy || form.customer_name.trim().length < 2 || form.phone.trim().length < 7}>{busy ? 'Saving…' : customer ? 'Save customer' : 'Register customer'}</button></footer>
    </form>
  </Modal>
}
