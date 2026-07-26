import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './ToastProvider'

function ToastTrigger() {
  const { toast } = useToast()
  return <button onClick={() => toast({ message: 'Saved successfully', variant: 'success' })}>Show toast</button>
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

    expect(screen.getByRole('status')).toHaveTextContent('Saved successfully')
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
