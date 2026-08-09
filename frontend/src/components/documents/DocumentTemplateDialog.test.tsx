import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DocumentTemplate } from '../../erp-types'
import { normalizeDocumentPackTemplate } from '../../lib/document-pack'
import { DocumentTemplateDialog } from './DocumentTemplateDialog'

const template: DocumentTemplate = {
  id: 'template-1',
  template_type: 'customer_pack',
  name: 'Company Document Template',
  settings: {},
  is_active: true,
  updated_at: '2026-08-09T10:00:00Z',
}

describe('DocumentTemplateDialog', () => {
  it('submits values from the fixed modal footer', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <DocumentTemplateDialog
        template={template}
        settings={normalizeDocumentPackTemplate({ company_name: 'Solar ERP' })}
        working={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    const saveButton = screen.getByRole('button', { name: 'Save template' })
    expect(saveButton.closest('.modal-card__body')).toBeNull()
    await user.click(saveButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Company Document Template',
      company_name: 'Solar ERP',
    })
  })

  it('shows validation and save failures inside the dialog', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Template service is unavailable'))
    render(
      <DocumentTemplateDialog
        template={template}
        settings={normalizeDocumentPackTemplate({ email: '' })}
        working={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    await user.type(screen.getByLabelText('Email'), 'invalid-email')
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid company email address')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Email'))
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Template service is unavailable'))
  })
})
