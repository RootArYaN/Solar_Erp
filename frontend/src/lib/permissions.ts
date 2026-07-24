import type { Session } from '../types'

export const PERMISSIONS = {
  dashboard: { view: 'dashboard.view' },
  customers: {
    view: 'customers.view',
    create: 'customers.create',
    edit: 'customers.edit',
    archive: 'customers.archive',
  },
  sites: {
    view: 'sites.view',
    create: 'sites.create',
    edit: 'sites.edit',
    archive: 'sites.archive',
  },
  quotations: {
    view: 'quotations.view',
    create: 'quotations.create',
    edit: 'quotations.edit',
    archive: 'quotations.archive',
    approve: 'quotations.approve',
  },
  projects: {
    view: 'projects.view',
    create: 'projects.create',
    edit: 'projects.edit',
    archive: 'projects.archive',
  },
  materialRequests: {
    view: 'material_requests.view',
    create: 'material_requests.create',
    edit: 'material_requests.edit',
    archive: 'material_requests.archive',
    approve: 'material_requests.approve',
  },
  inventory: {
    view: 'inventory.view',
    create: 'inventory.create',
    edit: 'inventory.edit',
    archive: 'inventory.archive',
    approve: 'inventory.approve',
  },
  pricing: {
    view: 'pricing.view',
    create: 'pricing.create',
    edit: 'pricing.edit',
    archive: 'pricing.archive',
    approve: 'pricing.approve',
  },
  documents: {
    view: 'documents.view',
    create: 'documents.create',
    edit: 'documents.edit',
    archive: 'documents.archive',
    approve: 'documents.approve',
  },
  posters: {
    view: 'posters.view',
    create: 'posters.create',
    edit: 'posters.edit',
    archive: 'posters.archive',
  },
  agents: { view: 'agents.view', edit: 'agents.manage' },
  users: { view: 'users.view', edit: 'users.manage' },
  roles: { view: 'roles.view', edit: 'roles.manage' },
  security: { view: 'security.sessions.view', edit: 'security.sessions.manage' },
} as const

export type ModulePermissionKey = keyof typeof PERMISSIONS

type PermissionGroup = Record<string, string>

export type ModuleAccess = {
  canView: boolean
  canCreate: boolean
  canEdit: boolean
  canArchive: boolean
  canApprove: boolean
  readOnly: boolean
}

function isPrivileged(session: Session): boolean {
  return session.role === 'super_admin'
}

export function hasPermission(session: Session, permission: string): boolean {
  return isPrivileged(session) || session.permissions.includes(permission)
}

export function hasEveryPermission(session: Session, permissions: string[]): boolean {
  return permissions.every((permission) => hasPermission(session, permission))
}

export function getModuleAccess(session: Session, module: ModulePermissionKey): ModuleAccess {
  const group = PERMISSIONS[module] as PermissionGroup
  const canView = hasPermission(session, group.view)
  const canCreate = Boolean(group.create && hasPermission(session, group.create))
  const canEdit = Boolean(group.edit && hasPermission(session, group.edit))
  const canArchive = Boolean(group.archive && hasPermission(session, group.archive))
  const canApprove = Boolean(group.approve && hasPermission(session, group.approve))
  return { canView, canCreate, canEdit, canArchive, canApprove, readOnly: canView && !canCreate && !canEdit && !canArchive && !canApprove }
}
