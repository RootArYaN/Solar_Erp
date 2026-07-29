import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { TabButton, TabStrip } from './TabStrip'

function Harness() {
  const [tab, setTab] = useState('overview')
  return <>
    <TabStrip label="Record sections">
      <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
      <TabButton active={tab === 'documents'} onClick={() => setTab('documents')}>Documents</TabButton>
      <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity</TabButton>
    </TabStrip>
    <div role="tabpanel">{tab}</div>
  </>
}

describe('TabStrip', () => {
  it('moves and activates tabs with arrow keys', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    await user.keyboard('{ArrowRight}')

    const documents = screen.getByRole('tab', { name: 'Documents' })
    expect(documents).toHaveFocus()
    expect(documents).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('documents')

    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('activity')
  })
})
