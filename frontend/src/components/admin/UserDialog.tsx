import { KeyRound, Mail, UserRound } from 'lucide-react'
import { FormEvent, useState } from 'react'
import type { ManagedUser, Role } from '../../types'
import { Modal } from './Modal'

type UserFormValue = {
  full_name: string
  email: string
  password: string
  role_codes: string[]
  is_active: boolean
}

export function UserDialog({
  user,
  roles,
  allowSuperAdmin,
  busy,
  onClose,
  onSubmit,
}: {
  user?: ManagedUser
  roles: Role[]
  allowSuperAdmin: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (value: UserFormValue) => Promise<void>
}) {
  const visibleRoles = roles.filter((role) => role.code !== 'super_admin' || allowSuperAdmin || user?.is_super_admin)
  const [value, setValue] = useState<UserFormValue>({
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    password: '',
    role_codes: user?.roles ?? [visibleRoles[0]?.code ?? 'customer'],
    is_active: user?.is_active ?? true,
  })

  function toggleRole(code: string) {
    setValue((current) => ({
      ...current,
      role_codes: current.role_codes.includes(code)
        ? current.role_codes.filter((roleCode) => roleCode !== code)
        : [...current.role_codes, code],
    }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit(value)
  }

  return (
    <Modal
      title={user ? 'Edit user' : 'Create user'}
      subtitle={user ? 'Update company access and account status.' : 'Create a secure account inside this company.'}
      onClose={onClose}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form__grid">
          <label className="field">
            <span>Full name</span>
            <div className="field__control"><UserRound size={17} /><input required minLength={2} value={value.full_name} onChange={(event) => setValue({ ...value, full_name: event.target.value })} placeholder="User name" /></div>
          </label>
          <label className="field">
            <span>Email address</span>
            <div className="field__control"><Mail size={17} /><input required type="email" value={value.email} onChange={(event) => setValue({ ...value, email: event.target.value })} placeholder="name@company.com" /></div>
          </label>
        </div>

        <label className="field">
          <span>{user ? 'New password (optional)' : 'Temporary password'}</span>
          <div className="field__control"><KeyRound size={17} /><input required={!user} minLength={8} type="password" value={value.password} onChange={(event) => setValue({ ...value, password: event.target.value })} placeholder={user ? 'Leave blank to keep current password' : 'Minimum 8 characters'} /></div>
        </label>

        <fieldset className="role-selector">
          <legend>Assigned roles</legend>
          <div className="role-selector__grid">
            {visibleRoles.map((role) => (
              <label className={`role-option ${value.role_codes.includes(role.code) ? 'role-option--selected' : ''}`} key={role.id}>
                <input type="checkbox" checked={value.role_codes.includes(role.code)} onChange={() => toggleRole(role.code)} />
                <span>
                  <strong>{role.name}</strong>
                  <small>{role.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="switch-row">
          <span><strong>Active account</strong><small>User can sign in and access assigned modules.</small></span>
          <input type="checkbox" checked={value.is_active} onChange={(event) => setValue({ ...value, is_active: event.target.checked })} />
        </label>

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button primary-button--compact" disabled={busy || value.role_codes.length === 0}>
            {busy ? 'Saving…' : user ? 'Save changes' : 'Create user'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
