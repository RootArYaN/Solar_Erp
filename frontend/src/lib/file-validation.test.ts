import { describe, expect, it } from 'vitest'
import { validateUpload } from './file-validation'

describe('validateUpload', () => {
  const rule = { maxBytes: 1024, allowedMimeTypes: ['image/png', 'application/pdf'] }

  it('accepts allowed files inside the limit', () => {
    expect(validateUpload(new File(['ok'], 'proof.png', { type: 'image/png' }), rule)).toEqual({ valid: true })
  })

  it('rejects sensitive uploads with unsupported type or excessive size', () => {
    expect(validateUpload(new File(['text'], 'aadhaar.txt', { type: 'text/plain' }), rule).valid).toBe(false)
    expect(validateUpload(new File(['x'.repeat(2048)], 'bank-proof.pdf', { type: 'application/pdf' }), rule).valid).toBe(false)
  })
})
