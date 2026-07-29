import type { CreateRoleInput, CreateUserInput, ManagedUser, Permission, Role, UpdateRoleInput, UpdateUserInput } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment } from './client'

export const getUsers = (): Promise<ManagedUser[]> => apiRequest('/admin/users')
export const createUser = (input: CreateUserInput): Promise<ManagedUser> => apiRequest('/admin/users', { method: 'POST', body: input, idempotencyKey: createClientId() })
export const updateUser = (id: string, input: UpdateUserInput): Promise<ManagedUser> => apiRequest(`/admin/users/${apiSegment(id)}`, { method: 'PATCH', body: input })
export const resetUserPassword = (id: string, password: string): Promise<void> => apiRequest(`/admin/users/${apiSegment(id)}/reset-password`, { method: 'POST', body: { new_password: password }, idempotencyKey: createClientId() })
export const getRoles = (): Promise<Role[]> => apiRequest('/admin/roles')
export const getPermissions = (): Promise<Permission[]> => apiRequest('/admin/permissions')
export const createRole = (input: CreateRoleInput): Promise<Role> => apiRequest('/admin/roles', { method: 'POST', body: input, idempotencyKey: createClientId() })
export const updateRole = (id: string, input: UpdateRoleInput): Promise<Role> => apiRequest(`/admin/roles/${apiSegment(id)}`, { method: 'PATCH', body: input })
export const deleteRole = (id: string): Promise<void> => apiRequest(`/admin/roles/${apiSegment(id)}`, { method: 'DELETE', idempotencyKey: createClientId() })
