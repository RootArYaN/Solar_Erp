import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AlertDialog } from './AlertDialog'

function Harness({ onConfirm = async () => undefined }: { onConfirm?: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return <>
    <button onClick={() => setOpen(true)}>Open alert</button>
    <AlertDialog
      open={open}
      title="Confirm action?"
      description="This action needs confirmation."
      onCancel={() => setOpen(false)}
      onConfirm={async () => {
        await onConfirm()
        setOpen(false)
      }}
    />
  </>
}

describe('AlertDialog', () => {
  it('opens in a body portal and restores focus after cancellation', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open alert' })

    await user.click(trigger)

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.parentElement).toBe(document.body.querySelector('.alert-dialog-layer'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('guards an asynchronous confirmation against duplicate clicks', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const onConfirm = vi.fn(() => pending)
    render(<Harness onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: 'Open alert' }))
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    await user.click(confirm)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Working…' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await act(async () => finish())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })
})
