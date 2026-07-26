import type { CreateRoleInput, CreateUserInput, ManagedUser, Permission, Role, UpdateRoleInput, UpdateUserInput } from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest } from './client'

export const getUsers = (token: string): Promise<ManagedUser[]> => apiRequest('/admin/users', { token })
export const createUser = (token: string, input: CreateUserInput): Promise<ManagedUser> => apiRequest('/admin/users', { method: 'POST', token, body: input, idempotencyKey: createClientId() })
export const updateUser = (token: string, id: string, input: UpdateUserInput): Promise<ManagedUser> => apiRequest(`/admin/users/${id}`, { method: 'PATCH', token, body: input })
export const resetUserPassword = (token: string, id: string, password: string): Promise<void> => apiRequest(`/admin/users/${id}/reset-password`, { method: 'POST', token, body: { new_password: password }, idempotencyKey: createClientId() })
export const getRoles = (token: string): Promise<Role[]> => apiRequest('/admin/roles', { token })
export const getPermissions = (token: string): Promise<Permission[]> => apiRequest('/admin/permissions', { token })
export const createRole = (token: string, input: CreateRoleInput): Promise<Role> => apiRequest('/admin/roles', { method: 'POST', token, body: input, idempotencyKey: createClientId() })
export const updateRole = (token: string, id: string, input: UpdateRoleInput): Promise<Role> => apiRequest(`/admin/roles/${id}`, { method: 'PATCH', token, body: input })
export const deleteRole = (token: string, id: string): Promise<void> => apiRequest(`/admin/roles/${id}`, { method: 'DELETE', token, idempotencyKey: createClientId() })
