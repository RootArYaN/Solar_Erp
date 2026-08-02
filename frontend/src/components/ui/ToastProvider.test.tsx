import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './ToastProvider'

function ToastTrigger() {
  const { toast } = useToast()
  return <button onClick={() => toast({ message: 'Saved successfully', variant: 'success' })}>Show toast</button>
}

function ErrorToastTrigger() {
  const { toast } = useToast()
  return <button onClick={() => toast({ message: 'TypeError: Failed to fetch /api/v1/users', variant: 'error' })}>Show error</button>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ToastProvider', () => {
  it('shows and dismisses a toast when randomUUID is unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', {
      getRandomValues<T extends ArrayBufferView>(value: T): T {
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(7)
        return value
      },
    })
    render(<ToastProvider><ToastTrigger /></ToastProvider>)

    await user.click(screen.getByRole('button', { name: 'Show toast' }))

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Saved successfully')
    expect(status.parentElement).toBe(document.body.querySelector('.toast-viewport'))
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('turns technical errors into simple guidance', async () => {
    const user = userEvent.setup()
    render(<ToastProvider><ErrorToastTrigger /></ToastProvider>)

    await user.click(screen.getByRole('button', { name: 'Show error' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Action failed')
    expect(alert).toHaveTextContent('Could not connect to the server. Check your connection and try again.')
    expect(alert).not.toHaveTextContent('/api/v1/users')
  })
})
