import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'

function Harness() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open form</button>
    <Dialog
      open={open}
      title="Edit record"
      subtitle="Update the selected record."
      onClose={() => setOpen(false)}
      footer={<footer><button type="button" onClick={() => setOpen(false)}>Save</button></footer>}
    >
      <label>Name<input aria-label="Name" /></label>
      <button type="button">Secondary action</button>
    </Dialog>
  </>
}

describe('Dialog', () => {
  it('uses a portal, traps focus, closes with Escape and restores focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open form' })

    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Edit record' })
    expect(dialog.parentElement).toBe(document.body.querySelector('.modal-layer'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })
})

function NestedHarness() {
  const [parentOpen, setParentOpen] = useState(false)
  const [childOpen, setChildOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setParentOpen(true)}>Open parent</button>
    <Dialog open={parentOpen} title="Parent dialog" onClose={() => setParentOpen(false)}>
      <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
      <Dialog open={childOpen} title="Child dialog" role="alertdialog" onClose={() => setChildOpen(false)}>
        <p>Confirm the nested action.</p>
      </Dialog>
    </Dialog>
  </>
}

describe('nested Dialog stack', () => {
  it('allows only the topmost dialog to process Escape', async () => {
    const user = userEvent.setup()
    render(<NestedHarness />)
    await user.click(screen.getByRole('button', { name: 'Open parent' }))
    await user.click(screen.getByRole('button', { name: 'Open child' }))

    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument()
    expect(screen.getByRole('alertdialog', { name: 'Child dialog' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog', { name: 'Child dialog' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Parent dialog' })).not.toBeInTheDocument()
  })
})
