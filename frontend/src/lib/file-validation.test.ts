import { describe, expect, it } from 'vitest'
import { validateUpload, validateUploadFile } from './file-validation'

const rule = { maxBytes: 1024, allowedMimeTypes: ['image/png', 'application/pdf'], allowedExtensions: ['.png', '.pdf'] }

describe('validateUpload', () => {
  it('accepts files that match the configured metadata rules', () => {
    expect(validateUpload(new File(['ok'], 'proof.png', { type: 'image/png' }), rule)).toEqual({ valid: true })
  })

  it('rejects unsupported, oversized, and misleading names', () => {
    expect(validateUpload(new File(['text'], 'aadhaar.txt', { type: 'text/plain' }), rule).valid).toBe(false)
    expect(validateUpload(new File(['x'.repeat(2048)], 'bank-proof.pdf', { type: 'application/pdf' }), rule).valid).toBe(false)
    expect(validateUpload(new File(['text'], 'invoice.exe.pdf', { type: 'application/pdf' }), rule).valid).toBe(false)
    expect(validateUpload(new File(['text'], 'proof.pdf', { type: 'image/png' }), rule).valid).toBe(false)
  })

  it('checks the actual file signature before upload', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'proof.png', { type: 'image/png' })
    const fakePng = new File(['not-a-png'], 'proof.png', { type: 'image/png' })

    await expect(validateUploadFile(png, rule)).resolves.toEqual({ valid: true })
    await expect(validateUploadFile(fakePng, rule)).resolves.toMatchObject({ valid: false })
  })
})

describe('OOXML and file-read hardening', () => {
  const documentRule = {
    maxBytes: 1024 * 1024,
    allowedMimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    allowedExtensions: ['.docx', '.xlsx'],
  }

  it('requires subtype-specific OOXML entries', async () => {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const validDocx = new File([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      '[Content_Types].xml word/document.xml',
    ], 'contract.docx', { type: docxMime })
    const renamedWorkbook = new File([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      '[Content_Types].xml xl/workbook.xml',
    ], 'contract.docx', { type: docxMime })

    await expect(validateUploadFile(validDocx, documentRule)).resolves.toEqual({ valid: true })
    await expect(validateUploadFile(renamedWorkbook, documentRule)).resolves.toMatchObject({ valid: false })
  })

  it('returns a normal validation error when browser file reading fails', async () => {
    const file = new File(['content'], 'proof.pdf', { type: 'application/pdf' })
    const originalSlice = file.slice.bind(file)
    Object.defineProperty(file, 'slice', {
      configurable: true,
      value: () => ({ arrayBuffer: async () => { throw new Error('read failed') } }),
    })
    await expect(validateUploadFile(file, rule)).resolves.toEqual({ valid: false, message: 'proof.pdf could not be read safely' })
    Object.defineProperty(file, 'slice', { configurable: true, value: originalSlice })
  })
})
