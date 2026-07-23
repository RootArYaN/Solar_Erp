export type Session = {
  access_token: string
  token_type: 'bearer'
  expires_at: string
  user: {
    id: string
    email: string
    full_name: string
  }
  company: {
    id: string
    name: string
    code: string
  }
  roles: string[]
  permissions: string[]
}

export type ManagedUser = {
  id: string
  membership_id: string
  email: string
  full_name: string
  is_active: boolean
  is_super_admin: boolean
  roles: string[]
  created_at: string
}

export type Permission = {
  id: string
  code: string
  name: string
  description: string
}

export type Role = {
  id: string
  name: string
  code: string
  description: string
  is_system: boolean
  permissions: string[]
  member_count: number
}

export type CreateUserInput = {
  full_name: string
  email: string
  password: string
  role_codes: string[]
  is_active: boolean
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, 'password'>>

export type CreateRoleInput = {
  name: string
  code: string
  description: string
  permission_codes: string[]
}

export type UpdateRoleInput = Omit<CreateRoleInput, 'code'>
