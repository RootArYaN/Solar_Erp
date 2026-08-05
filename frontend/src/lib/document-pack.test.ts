import { describe, expect, it } from 'vitest'
import {
  normalizeDocumentPackTemplate,
  renderDocumentHtml,
  type DocumentPackInput,
} from './document-pack'
import { buildFormattedPdf } from './document-pack/pdf'

const input: DocumentPackInput = {
  customerName: 'Asha Patel',
  customerNumber: 'CUS-001',
  projectNumber: 'PRJ-001',
  quotationNumber: 'QUO-001',
  address: 'Surat, Gujarat',
  district: 'Surat',
  consumerNumber: 'PGVCL-001',
  customerCategory: 'residential',
  plantCapacity: '3.4',
  quotationAmount: '318000',
  panelSize: '540',
  numberOfPanels: '7',
  panelBrand: 'Solar Brand',
  inverterBrand: 'Inverter Brand',
  structureType: 'GI',
  cableBrand: 'Cable Brand',
  salesPerson: 'Project Agent',
  agreementDate: '2026-07-28',
  validityDays: '15',
  notes: '',
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('document pack template content', () => {
  it('uses saved document wording, specifications, and signature settings', () => {
    const template = normalizeDocumentPackTemplate({
      company_name: 'Solar EPC',
      feasibility_title: 'Custom Feasibility',
      feasibility_status: 'APPROVED FOR INSTALLATION',
      feasibility_note: 'Custom feasibility note',
      feasibility_checks: 'Roof condition | READY',
      estimate_title: 'Custom Estimate',
      estimate_note: 'Custom estimate condition',
      component_specs: 'PV Module | Custom module specification | Custom make',
      agreement_title: 'Custom Agreement',
      agreement_subtitle: 'Custom annexure',
      agreement_intro: 'the custom project scope',
      first_party_activities: 'Customer custom activity',
      second_party_activities: 'Vendor custom activity',
      agreement_disclaimer: 'Custom agreement disclaimer',
      quotation_title: 'Custom Quotation',
      customer_signature_label: 'Consumer acceptance',
      vendor_signature_label: 'EPC approval',
      vendor_signature_image: 'data:image/png;base64,dmVuZG9yLXNpZ25hdHVyZQ==',
      vendor_signatory_name: 'Authorized Person',
      vendor_signatory_title: 'Managing Partner',
    })

    const feasibility = renderDocumentHtml('feasibility', input, template)
    expect(feasibility).toContain('Custom Feasibility')
    expect(feasibility).toContain('APPROVED FOR INSTALLATION')
    expect(feasibility).toContain('Roof condition')
    expect(feasibility).toContain('Consumer acceptance')
    expect(feasibility).toContain('Authorized Person')
    expect(feasibility).toContain('alt="Uploaded vendor signature"')
    expect(feasibility).toContain('data:image/png;base64,dmVuZG9yLXNpZ25hdHVyZQ==')

    const estimate = renderDocumentHtml('estimate', input, template)
    expect(estimate).toContain('Custom Estimate')
    expect(estimate).toContain('Custom module specification')

    const agreement = renderDocumentHtml('agreement', input, template)
    expect(agreement).toContain('Custom Agreement')
    expect(agreement).toContain('Customer custom activity')
    expect(agreement).toContain('Vendor custom activity')
    expect(agreement).toContain('Custom agreement disclaimer')

    expect(renderDocumentHtml('quotation', input, template)).toContain('Custom Quotation')
  })

  it('renders the uploaded customer signature image without generating a typed signature', () => {
    const template = normalizeDocumentPackTemplate({})
    const signatureUrl = 'data:image/png;base64,dXBsb2FkZWQtc2lnbmF0dXJl'
    const html = renderDocumentHtml('quotation', input, template, { customerSignatureUrl: signatureUrl })

    expect(html).toContain(`src="${signatureUrl}"`)
    expect(html).toContain('Uploaded customer signature')
    expect(html).not.toContain('Uploaded customer signature unavailable')
    expect(html).not.toContain('Electronically signed')
  })

  it('embeds the vendor signature image in generated PDFs', async () => {
    const template = normalizeDocumentPackTemplate({ vendor_signatory_name: 'Authorized Person' })
    const vendorSignature = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      width: 120,
      height: 40,
    }
    const source = await readBlob(buildFormattedPdf(input, template, 'quotation', undefined, vendorSignature))

    expect(source).toContain('/VendorSig')
    expect(source).toContain('/Subtype /Image')
    expect(source).toContain('Authorized Person')
  })
})
