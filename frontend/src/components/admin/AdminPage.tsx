import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  createRole,
  createUser,
  deleteRole,
  getPermissions,
  getRoles,
  getUsers,
  resetUserPassword,
  updateRole,
  updateUser,
} from '../../lib/api'
import type { ManagedUser, Permission, Role, Session } from '../../types'
import { RoleDialog } from './RoleDialog'
import { UserDialog } from './UserDialog'

type Tab = 'users' | 'roles'

const roleLabels: Record<string, string> = {
  customer: 'Customer',
  agent: 'Agent',
  accounts_admin: 'Accounts Admin',
  company_admin: 'Company Admin',
  super_admin: 'Super Admin',
}

export function AdminPage({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState<ManagedUser | null | undefined>(undefined)
  const [editingRole, setEditingRole] = useState<Role | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const canManageUsers = session.permissions.includes('users.manage')
  const canManageRoles = session.permissions.includes('roles.manage')
  const isSuperAdmin = session.roles.includes('super_admin')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [nextUsers, nextRoles, nextPermissions] = await Promise.all([
        getUsers(session.access_token),
        getRoles(session.access_token),
        getPermissions(session.access_token),
      ])
      setUsers(nextUsers)
      setRoles(nextRoles)
      setPermissions(nextPermissions)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load administration data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((user) => `${user.full_name} ${user.email} ${user.roles.join(' ')}`.toLowerCase().includes(term))
  }, [search, users])

  async function saveUser(value: { full_name: string; email: string; password: string; role_codes: string[]; is_active: boolean }) {
    setBusy(true)
    setError('')
    try {
      if (editingUser) {
        await updateUser(session.access_token, editingUser.membership_id, {
          full_name: value.full_name,
          email: value.email,
          role_codes: value.role_codes,
          is_active: value.is_active,
        })
        if (value.password) await resetUserPassword(session.access_token, editingUser.membership_id, value.password)
      } else {
        await createUser(session.access_token, value)
      }
      setEditingUser(undefined)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save user')
    } finally {
      setBusy(false)
    }
  }

  async function toggleUser(user: ManagedUser) {
    setBusy(true)
    setError('')
    try {
      await updateUser(session.access_token, user.membership_id, { is_active: !user.is_active })
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update user')
    } finally {
      setBusy(false)
    }
  }

  async function saveRole(value: { name: string; code: string; description: string; permission_codes: string[] }) {
    setBusy(true)
    setError('')
    try {
      if (editingRole) {
        await updateRole(session.access_token, editingRole.id, {
          name: value.name,
          description: value.description,
          permission_codes: value.permission_codes,
        })
      } else {
        await createRole(session.access_token, value)
      }
      setEditingRole(undefined)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save role')
    } finally {
      setBusy(false)
    }
  }

  async function removeRole(role: Role) {
    if (!window.confirm(`Delete the ${role.name} role?`)) return
    setBusy(true)
    setError('')
    try {
      await deleteRole(session.access_token, role.id)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete role')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-page">
      <header className="page-heading">
        <div>
          <div className="eyebrow">Identity & access</div>
          <h1>Users and roles</h1>
          <p>Control who can enter {session.company.name} and which ERP actions they can perform.</p>
        </div>
        {tab === 'users' && canManageUsers && <button className="primary-button primary-button--compact" onClick={() => setEditingUser(null)}><Plus size={17} /> Create user</button>}
        {tab === 'roles' && canManageRoles && <button className="primary-button primary-button--compact" onClick={() => setEditingRole(null)}><Plus size={17} /> Create role</button>}
      </header>

      <div className="admin-stats">
        <article><Users size={19} /><span>Company users</span><strong>{users.length}</strong></article>
        <article><UserCheck size={19} /><span>Active users</span><strong>{users.filter((user) => user.is_active).length}</strong></article>
        <article><ShieldCheck size={19} /><span>Available roles</span><strong>{roles.length}</strong></article>
      </div>

      <nav className="segmented-tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles & permissions</button>
      </nav>

      {error && <div className="admin-alert">{error}</div>}

      {tab === 'users' ? (
        <section className="data-panel">
          <div className="data-panel__toolbar">
            <div className="search-control"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users, email or role" /></div>
            <span>{filteredUsers.length} user{filteredUsers.length === 1 ? '' : 's'}</span>
          </div>

          {loading ? <div className="empty-state">Loading company users…</div> : filteredUsers.length === 0 ? <div className="empty-state">No users match this search.</div> : (
            <div className="user-table-wrap">
              <table className="user-table">
                <thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Created</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.membership_id}>
                      <td><div className="user-identity"><div className="avatar avatar--small">{user.full_name.slice(0, 1).toUpperCase()}</div><span><strong>{user.full_name}</strong><small>{user.email}</small></span></div></td>
                      <td><div className="badge-list">{user.roles.map((role) => <span className={`role-badge role-badge--${role}`} key={role}>{roleLabels[role] ?? role.replaceAll('_', ' ')}</span>)}</div></td>
                      <td><span className={`status-badge ${user.is_active ? 'status-badge--active' : ''}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(user.created_at))}</td>
                      <td><div className="row-actions">
                        {canManageUsers && <button className="icon-button" onClick={() => setEditingUser(user)} aria-label={`Edit ${user.full_name}`}><Pencil size={16} /></button>}
                        {canManageUsers && user.id !== session.user.id && <button className="icon-button" disabled={busy} onClick={() => void toggleUser(user)} aria-label={user.is_active ? 'Deactivate user' : 'Activate user'}>{user.is_active ? <UserX size={16} /> : <UserCheck size={16} />}</button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="role-grid">
          {roles.map((role) => {
            const canEditRole = canManageRoles && !['company_admin', 'super_admin'].includes(role.code)
            return (
              <article className="role-card" key={role.id}>
                <div className="role-card__top"><div className="role-card__icon"><KeyRound size={19} /></div><span>{role.is_system ? 'System role' : 'Custom role'}</span></div>
                <h2>{role.name}</h2>
                <code>{role.code}</code>
                <p>{role.description}</p>
                <div className="role-card__meta"><span>{role.member_count} members</span><span>{role.permissions.length} permissions</span></div>
                <footer>
                  <button className="secondary-button" onClick={() => setEditingRole(role)}>{canEditRole ? 'Manage role' : 'View role'}</button>
                  {!role.is_system && canManageRoles && <button className="danger-icon-button" disabled={busy || role.member_count > 0} onClick={() => void removeRole(role)} aria-label={`Delete ${role.name}`}><Trash2 size={16} /></button>}
                </footer>
              </article>
            )
          })}
        </section>
      )}

      {editingUser !== undefined && (
        <UserDialog user={editingUser ?? undefined} roles={roles} allowSuperAdmin={isSuperAdmin} busy={busy} onClose={() => setEditingUser(undefined)} onSubmit={saveUser} />
      )}
      {editingRole !== undefined && (
        <RoleDialog role={editingRole ?? undefined} permissions={permissions} busy={busy} canEdit={canManageRoles && (!editingRole || !['company_admin', 'super_admin'].includes(editingRole.code))} onClose={() => setEditingRole(undefined)} onSubmit={saveRole} />
      )}
    </section>
  )
}
