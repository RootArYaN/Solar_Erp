import { MapPin, Phone } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { AgentProfile, UpdateAgentProfileInput } from '../../types'
import { Modal } from '../admin/Modal'

export function AgentProfileDialog({
  profile,
  busy,
  onClose,
  onSubmit,
}: {
  profile: AgentProfile
  busy: boolean
  onClose: () => void
  onSubmit: (value: UpdateAgentProfileInput) => Promise<void>
}) {
  const [value, setValue] = useState<UpdateAgentProfileInput>({
    phone: profile.phone,
    alternate_phone: profile.alternate_phone,
    address_line_1: profile.address_line_1,
    address_line_2: profile.address_line_2,
    city: profile.city,
    state: profile.state,
    postal_code: profile.postal_code,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit(value)
  }

  return (
    <Modal title="Edit agent profile" subtitle="Contact and address details stay scoped to the current company." onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form__grid">
          <label className="field">
            <span>Primary phone</span>
            <div className="field__control"><Phone size={17} /><input value={value.phone} onChange={(event) => setValue({ ...value, phone: event.target.value })} placeholder="+91 98765 43210" /></div>
          </label>
          <label className="field">
            <span>Alternate phone</span>
            <div className="field__control"><Phone size={17} /><input value={value.alternate_phone} onChange={(event) => setValue({ ...value, alternate_phone: event.target.value })} placeholder="Optional number" /></div>
          </label>
        </div>

        <label className="field">
          <span>Address line 1</span>
          <div className="field__control"><MapPin size={17} /><input value={value.address_line_1} onChange={(event) => setValue({ ...value, address_line_1: event.target.value })} placeholder="Building, street or area" /></div>
        </label>
        <label className="field">
          <span>Address line 2</span>
          <div className="field__control"><MapPin size={17} /><input value={value.address_line_2} onChange={(event) => setValue({ ...value, address_line_2: event.target.value })} placeholder="Landmark or locality" /></div>
        </label>

        <div className="admin-form__grid agent-address-grid">
          <label className="field">
            <span>City</span>
            <div className="field__control"><input value={value.city} onChange={(event) => setValue({ ...value, city: event.target.value })} placeholder="Surat" /></div>
          </label>
          <label className="field">
            <span>State</span>
            <div className="field__control"><input value={value.state} onChange={(event) => setValue({ ...value, state: event.target.value })} placeholder="Gujarat" /></div>
          </label>
          <label className="field">
            <span>Postal code</span>
            <div className="field__control"><input value={value.postal_code} onChange={(event) => setValue({ ...value, postal_code: event.target.value })} placeholder="395007" /></div>
          </label>
        </div>

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button primary-button--compact" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
        </footer>
      </form>
    </Modal>
  )
}
