import type { Session } from '../types'

export const PERMISSIONS = {
  dashboard: { view: 'dashboard.view' },
  customers: { view: 'customers.view', create: 'customers.create', edit: 'customers.edit' },
  sites: { view: 'sites.view', create: 'sites.create', edit: 'sites.edit' },
  quotations: { view: 'quotations.view', create: 'quotations.create', edit: 'quotations.edit', approve: 'quotations.approve' },
  projects: { view: 'projects.view', create: 'projects.create', edit: 'projects.edit', manage: 'projects.manage' },
  materialRequests: { view: 'material_requests.view', create: 'material_requests.create', edit: 'material_requests.edit', approve: 'material_requests.approve' },
  inventory: { view: 'inventory.view', create: 'inventory.create', edit: 'inventory.edit', approve: 'inventory.approve', manage: 'inventory.manage' },
  pricing: { view: 'pricing.view', create: 'pricing.create', edit: 'pricing.edit', approve: 'pricing.approve' },
  documents: { view: 'documents.view', create: 'documents.create', edit: 'documents.edit', approve: 'documents.approve', manage: 'documents.manage' },
  finance: { view: 'finance.view', manage: 'finance.manage' },
  posters: { view: 'posters.view', create: 'posters.create', edit: 'posters.edit' },
  agents: { view: 'agents.view', edit: 'agents.manage', submitTransaction: 'agents.transactions.submit', approveTransaction: 'agents.transactions.approve' },
  users: { view: 'users.view', edit: 'users.manage' },
  roles: { view: 'roles.view', edit: 'roles.manage' },
  security: { view: 'security.sessions.view', edit: 'security.sessions.manage' },
  events: { view: 'events.view' },
  tasks: { view: 'tasks.view', create: 'tasks.create', assign: 'tasks.assign', manage: 'tasks.manage' },
} as const

export type ModulePermissionKey = keyof typeof PERMISSIONS

type PermissionGroup = Record<string, string>

export type ModuleAccess = {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canApprove: boolean
  readOnly: boolean
}

function isPrivileged(session: Session): boolean {
  return session.user.is_super_admin
}

export function hasPermission(session: Session, permission: string): boolean {
  return isPrivileged(session) || session.permissions.includes(permission)
}

export function hasEveryPermission(session: Session, permissions: readonly string[]): boolean {
  return permissions.every((permission) => hasPermission(session, permission))
}

export function hasAnyPermission(session: Session, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasPermission(session, permission))
}

export function getModuleAccess(session: Session, module: ModulePermissionKey): ModuleAccess {
  const group = PERMISSIONS[module] as PermissionGroup
  const canView = hasPermission(session, group.view)
  const canManage = Boolean(group.manage && hasPermission(session, group.manage))
  const canCreate = canManage || Boolean(group.create && hasPermission(session, group.create))
  const canEdit = canManage || Boolean(group.edit && hasPermission(session, group.edit))
  const canApprove = canManage || Boolean(group.approve && hasPermission(session, group.approve))
  return { canView, canCreate, canEdit, canApprove, readOnly: canView && !canCreate && !canEdit && !canApprove }
}
