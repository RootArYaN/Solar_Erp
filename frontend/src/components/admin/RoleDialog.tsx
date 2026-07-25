import { FormEvent, useMemo, useState } from 'react'
import type { Permission, Role } from '../../types'
import { Modal } from './Modal'

type RoleFormValue = {
  name: string
  code: string
  description: string
  permission_codes: string[]
}

const tabOptions = [
  { label: 'Overview', codes: ['dashboard.view'] },
  { label: 'Customers', codes: ['customers.view'] },
  { label: 'Agents', codes: ['agents.view'] },
  { label: 'Inventory', codes: ['inventory.view'] },
  { label: 'Customer data', codes: ['documents.view'] },
  { label: 'Posters', codes: ['posters.view'] },
  { label: 'Solar pricing', codes: ['pricing.view'] },
  { label: 'Devices', codes: ['security.sessions.view'] },
  { label: 'Users & roles', codes: ['users.view', 'roles.view'] },
] as const

const tabPermissionCodes = new Set<string>(tabOptions.flatMap((option) => option.codes))

function permissionGroup(code: string) {
  return code.split('.')[0]
}

export function RoleDialog({
  role,
  permissions,
  busy,
  canEdit,
  onClose,
  onSubmit,
}: {
  role?: Role
  permissions: Permission[]
  busy: boolean
  canEdit: boolean
  onClose: () => void
  onSubmit: (value: RoleFormValue) => Promise<void>
}) {
  const [value, setValue] = useState<RoleFormValue>({
    name: role?.name ?? '',
    code: role?.code ?? '',
    description: role?.description ?? '',
    permission_codes: role?.permissions ?? ['dashboard.view'],
  })
  const groups = useMemo(() => permissions.filter((permission) => !tabPermissionCodes.has(permission.code)).reduce<Record<string, Permission[]>>((result, permission) => {
    const group = permissionGroup(permission.code)
    result[group] = [...(result[group] ?? []), permission]
    return result
  }, {}), [permissions])
  const availableCodes = useMemo(() => new Set(permissions.map((permission) => permission.code)), [permissions])
  const availableTabs = tabOptions.filter((option) => option.codes.every((code) => availableCodes.has(code)))

  function togglePermission(code: string) {
    setValue((current) => ({
      ...current,
      permission_codes: current.permission_codes.includes(code)
        ? current.permission_codes.filter((permissionCode) => permissionCode !== code)
        : [...current.permission_codes, code],
    }))
  }

  function toggleTab(codes: readonly string[]) {
    setValue((current) => {
      const selected = codes.every((code) => current.permission_codes.includes(code))
      return {
        ...current,
        permission_codes: selected
          ? current.permission_codes.filter((code) => !codes.includes(code))
          : Array.from(new Set([...current.permission_codes, ...codes])),
      }
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit(value)
  }

  return (
    <Modal title={role ? `Manage ${role.name}` : 'Create role'} onClose={onClose}>
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-form__grid">
          <label className="field">
            <span>Role name</span>
            <div className="field__control"><input disabled={!canEdit} required minLength={2} value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} placeholder="Project Coordinator" /></div>
          </label>
          <label className="field">
            <span>Role code</span>
            <div className="field__control"><input disabled={Boolean(role) || !canEdit} required pattern="[a-z][a-z0-9_]{1,39}" value={value.code} onChange={(event) => setValue({ ...value, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="project_coordinator" /></div>
          </label>
        </div>
        <label className="field">
          <span>Description</span>
          <textarea disabled={!canEdit} value={value.description} onChange={(event) => setValue({ ...value, description: event.target.value })} maxLength={240} placeholder="Role description" />
        </label>

        <section className="permission-editor">
          <div className="permission-editor__heading">
            <div><strong>Visible tabs</strong><span>Select what this role sees in the menu</span></div>
          </div>
          <div className="permission-groups">
            <section className="permission-group">
              <h3>Menu</h3>
              {availableTabs.map((tab) => (
                <label key={tab.label}>
                  <input disabled={!canEdit} type="checkbox" checked={tab.codes.every((code) => value.permission_codes.includes(code))} onChange={() => toggleTab(tab.codes)} />
                  <span><strong>{tab.label}</strong></span>
                </label>
              ))}
            </section>
          </div>
        </section>

        <section className="permission-editor">
          <div className="permission-editor__heading">
            <div><strong>Allowed actions</strong><span>{value.permission_codes.length} total permissions selected</span></div>
            {canEdit && <button type="button" className="text-button" onClick={() => setValue({ ...value, permission_codes: permissions.map((permission) => permission.code) })}>Select all</button>}
          </div>
          <div className="permission-groups">
            {Object.entries(groups).map(([group, items]) => (
              <section className="permission-group" key={group}>
                <h3>{group}</h3>
                {items?.map((permission) => (
                  <label key={permission.id}>
                    <input disabled={!canEdit} type="checkbox" checked={value.permission_codes.includes(permission.code)} onChange={() => togglePermission(permission.code)} />
                    <span><strong>{permission.name}</strong></span>
                  </label>
                ))}
              </section>
            ))}
          </div>
        </section>

        <footer className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && <button type="submit" className="primary-button primary-button--compact" disabled={busy}>{busy ? 'Saving…' : role ? 'Save role' : 'Create role'}</button>}
        </footer>
      </form>
    </Modal>
  )
}
