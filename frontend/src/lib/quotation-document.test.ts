import { describe, expect, it } from 'vitest'
import type { WorkflowQuotation } from '../types'
import { createQuotationPdf } from './quotation-document'

const quotation: WorkflowQuotation = {
  id: 'quotation-1',
  quotation_number: 'QUO-2026-001',
  title: '3.4 kW rooftop solar system',
  subtotal: 300000,
  tax_total: 18000,
  grand_total: 318000,
  valid_until: '2026-08-18T00:00:00Z',
  status: 'approved',
  decision_comment: 'Approved by customer',
  created_at: '2026-08-03T00:00:00Z',
  approved_at: '2026-08-03T06:00:00Z',
  lines: [{
    description: 'Solar rooftop EPC package',
    quantity: 1,
    unit: 'Lot',
    unit_price: 300000,
    tax_rate: 6,
    line_total: 318000,
  }],
}

const customerSignature = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  width: 120,
  height: 40,
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('approved quotation PDF', () => {
  it('uses the formatted PDF layout and embeds the uploaded customer signature', async () => {
    const blob = createQuotationPdf({ quotation, customerName: 'Asha Patel', customerSignature })

    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('application/pdf')
    const source = await readBlob(blob as Blob)
    expect(source).toContain('%ERP-APPROVED-QUOTATION')
    expect(source).toContain('/Subtype /Image')
    expect(source).toContain('/Sig')
    expect(source).toContain('Approved Solar Quotation')
    expect(source).toContain('Asha Patel')
  })

  it('does not produce an approved document without the uploaded signature', () => {
    expect(createQuotationPdf({ quotation, customerName: 'Asha Patel' })).toBeNull()
    expect(createQuotationPdf({ quotation: { ...quotation, status: 'pending' }, customerName: 'Asha Patel', customerSignature })).toBeNull()
  })
})
