import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Session } from '../../types'
import { ProtectedRoute } from './ProtectedRoute'

const base: Session = {
  access_token: 'token', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z',
  user: { id: 'u1', username: 'user', email: 'user@example.com', full_name: 'User', is_super_admin: false }, company: { id: 'c1', name: 'Company', code: 'CO' }, role: 'viewer', permissions: [],
}

describe('ProtectedRoute', () => {
  it('renders the route only when the required permission exists', () => {
    render(<MemoryRouter initialEntries={['/app/customers']}><Routes><Route path="/app" element={<div>Home</div>} /><Route path="/app/customers" element={<ProtectedRoute session={{ ...base, permissions: ['customers.view'] }} permissions={['customers.view']}><div>Customers</div></ProtectedRoute>} /></Routes></MemoryRouter>)
    expect(screen.getByText('Customers')).toBeInTheDocument()
  })

  it('redirects a user without permission', () => {
    render(<MemoryRouter initialEntries={['/app/customers']}><Routes><Route path="/app" element={<div>Home</div>} /><Route path="/app/customers" element={<ProtectedRoute session={base} permissions={['customers.view']}><div>Customers</div></ProtectedRoute>} /></Routes></MemoryRouter>)
    expect(screen.getByText('Home')).toBeInTheDocument()
  })
})
