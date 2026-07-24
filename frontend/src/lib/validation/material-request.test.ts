import { describe, expect, it } from 'vitest'
import { validateMaterialRequestDraft } from './material-request'

describe('material request validation', () => {
  it('returns field-level errors for empty descriptions and invalid decimal quantities', () => {
    const errors = validateMaterialRequestDraft('', [{ id: '1', item_id: null, description: '', requested_quantity: '0', unit: 'Nos', required_by: null, note: '' }])
    expect(errors.purpose).toEqual(['Purpose is required'])
    expect(errors['lines.0.description']).toBeDefined()
    expect(errors['lines.0.requested_quantity']).toBeDefined()
  })
})
