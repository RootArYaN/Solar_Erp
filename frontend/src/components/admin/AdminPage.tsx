import { KeyRound, Pencil, Plus, Search, ShieldCheck, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { AlertDialog } from '../ui/AlertDialog'
import { useToast } from '../ui/ToastProvider'
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

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

export function AdminPage({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState<ManagedUser | null | undefined>(undefined)
  const [editingRole, setEditingRole] = useState<Role | null | undefined>(undefined)
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()
  const canManageUsers = session.permissions.includes('users.manage')
  const canManageRoles = session.permissions.includes('roles.manage')
  const isSuperAdmin = session.role === 'super_admin'

  const load = useCallback(async () => {
    setLoading(true)
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
      toast({ message: errorMessage(reason, 'Could not load administration data'), variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [session.access_token, toast])

  useEffect(() => { void load() }, [load])

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter((user) => `${user.full_name} ${user.username} ${user.email} ${user.role}`.toLowerCase().includes(term))
  }, [search, users])

  async function saveUser(value: { full_name: string; username: string; email: string; password: string; role_code: string; is_active: boolean }) {
    const isEditing = Boolean(editingUser)
    setBusy(true)
    try {
      if (editingUser) {
        await updateUser(session.access_token, editingUser.membership_id, {
          full_name: value.full_name,
          username: value.username,
          email: value.email,
          role_code: value.role_code,
          is_active: value.is_active,
        })
        if (value.password) await resetUserPassword(session.access_token, editingUser.membership_id, value.password)
      } else {
        await createUser(session.access_token, value)
      }
      setEditingUser(undefined)
      await load()
      toast({ message: isEditing ? 'User updated' : 'User created', variant: 'success' })
    } catch (reason) {
      toast({ message: errorMessage(reason, 'Could not save user'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function toggleUser(user: ManagedUser) {
    setBusy(true)
    try {
      const nextActive = !user.is_active
      await updateUser(session.access_token, user.membership_id, { is_active: nextActive })
      await load()
      toast({ message: `${user.full_name} ${nextActive ? 'activated' : 'deactivated'}`, variant: 'success' })
    } catch (reason) {
      toast({ message: errorMessage(reason, 'Could not update user'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function saveRole(value: { name: string; code: string; description: string; permission_codes: string[] }) {
    const isEditing = Boolean(editingRole)
    setBusy(true)
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
      toast({ message: isEditing ? 'Role updated' : 'Role created', variant: 'success' })
    } catch (reason) {
      toast({ message: errorMessage(reason, 'Could not save role'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function removeRole() {
    if (!roleToDelete) return
    setBusy(true)
    try {
      await deleteRole(session.access_token, roleToDelete.id)
      const deletedName = roleToDelete.name
      setRoleToDelete(null)
      await load()
      toast({ message: `${deletedName} deleted`, variant: 'success' })
    } catch (reason) {
      toast({ message: errorMessage(reason, 'Could not delete role'), variant: 'error' })
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
        </div>
        {tab === 'users' && canManageUsers && <button className="primary-button primary-button--compact" onClick={() => setEditingUser(null)}><Plus size={17} /> Create user</button>}
        {tab === 'roles' && canManageRoles && <button className="primary-button primary-button--compact" onClick={() => setEditingRole(null)}><Plus size={17} /> Create role</button>}
      </header>

      <div className="admin-stats">
        <article><Users size={19} /><span>Users</span><strong>{users.length}</strong></article>
        <article><UserCheck size={19} /><span>Active</span><strong>{users.filter((user) => user.is_active).length}</strong></article>
        <article><ShieldCheck size={19} /><span>Roles</span><strong>{roles.length}</strong></article>
      </div>

      <nav className="segmented-tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>Roles</button>
      </nav>

      {tab === 'users' ? (
        <section className="data-panel">
          <div className="data-panel__toolbar">
            <div className="search-control"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" /></div>
            <span>{filteredUsers.length}</span>
          </div>

          {loading ? <div className="empty-state">Loading…</div> : filteredUsers.length === 0 ? <div className="empty-state">No users found</div> : (
            <div className="user-table-wrap">
              <table className="user-table">
                <thead><tr><th>User</th><th>Roles</th><th>Status</th><th>Created</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.membership_id}>
                      <td><div className="user-identity"><div className="avatar avatar--small">{user.full_name.slice(0, 1).toUpperCase()}</div><span><strong>{user.full_name}</strong><small>@{user.username} · {user.email}</small></span></div></td>
                      <td><div className="badge-list"><span className={`role-badge role-badge--${user.role}`}>{roleLabels[user.role] ?? user.role.replaceAll('_', ' ')}</span></div></td>
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
                <div className="role-card__top"><div className="role-card__icon"><KeyRound size={19} /></div><span>{role.is_system ? 'System' : 'Custom'}</span></div>
                <h2>{role.name}</h2>
                <code>{role.code}</code>
                {role.description && <p>{role.description}</p>}
                <div className="role-card__meta"><span>{role.member_count} members</span><span>{role.permissions.length} permissions</span></div>
                <footer>
                  <button className="secondary-button" onClick={() => setEditingRole(role)}>{canEditRole ? 'Manage' : 'View'}</button>
                  {!role.is_system && canManageRoles && <button className="danger-icon-button" disabled={busy || role.member_count > 0} onClick={() => setRoleToDelete(role)} aria-label={`Delete ${role.name}`}><Trash2 size={16} /></button>}
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
      <AlertDialog
        open={Boolean(roleToDelete)}
        title={`Delete ${roleToDelete?.name ?? 'role'}?`}
        confirmLabel="Delete role"
        icon="delete"
        loading={busy}
        onCancel={() => setRoleToDelete(null)}
        onConfirm={removeRole}
      />
    </section>
  )
}
