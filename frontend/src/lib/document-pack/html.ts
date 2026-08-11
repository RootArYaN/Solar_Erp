import type { DocumentPackInput, DocumentPackTab, DocumentPackTemplate } from './types'
import { DEFAULT_DOCUMENT_COMPANY_NAME, documentTabs, firstPartyActivities, secondPartyActivities, templateChecks, templateComponentSpecs, templateLines } from './template'
import { amount, esc, expiryDate, money, safeName } from './format'
import { isSignatureDataUrl, type DocumentPackRenderAssets } from './signature'

export function documentPackFilePrefix(input: DocumentPackInput, version?: number) {
  return `${safeName(input.customerName)}_${safeName(input.projectNumber || input.customerNumber)}${version ? `_v${version}` : ''}`
}

export function validateDocumentPack(input: DocumentPackInput) {
  const missing: string[] = []
  if (!input.customerName.trim()) missing.push('customer name')
  if (!input.address.trim()) missing.push('installation address')
  if (!input.consumerNumber.trim()) missing.push('consumer number')
  if (!(Number(input.plantCapacity) > 0)) missing.push('plant capacity')
  if (!(amount(input.quotationAmount) > 0)) missing.push('approved quotation amount')
  if (!(Number(input.panelSize) > 0)) missing.push('panel wattage')
  if (!(Number(input.numberOfPanels) > 0)) missing.push('number of panels')
  if (!input.panelBrand.trim()) missing.push('panel brand')
  if (!input.inverterBrand.trim()) missing.push('inverter brand')
  return missing
}

export function companyHeader(template: DocumentPackTemplate, title: string, input: DocumentPackInput) {
  return `<header class="pack-doc__head"><div><strong>${esc(template.company_name || template.brand_name || DEFAULT_DOCUMENT_COMPANY_NAME)}</strong><span>${esc(template.address)}</span><small>${esc([template.phone, template.email, template.gstin && `GSTIN ${template.gstin}`].filter(Boolean).join(' · '))}</small></div><div><h3>${esc(title)}</h3><span>${esc(input.projectNumber || input.customerNumber)}</span><small>${new Date().toLocaleDateString('en-IN')}</small></div></header>`
}

export function kv(rows: Array<[string, unknown]>) {
  return `<table class="pack-doc__table"><tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value || '—')}</td></tr>`).join('')}</tbody></table>`
}

export function signature(input: DocumentPackInput, template: DocumentPackTemplate, assets?: DocumentPackRenderAssets) {
  const customerSignature = assets?.customerSignatureUrl
    ? `<img class="pack-doc__signature-image" src="${esc(assets.customerSignatureUrl)}" alt="Uploaded signature of ${esc(input.customerName)}">`
    : '<span class="pack-doc__signature-missing">Uploaded customer signature unavailable</span>'
  const vendorSignatureUrl = assets?.vendorSignatureUrl || template.vendor_signature_image
  const vendorSignature = isSignatureDataUrl(vendorSignatureUrl)
    ? `<img class="pack-doc__signature-image" src="${esc(vendorSignatureUrl)}" alt="Uploaded vendor signature">`
    : ''
  return `<div class="pack-doc__signatures"><div class="pack-doc__signature pack-doc__signature--customer"><span>${esc(template.customer_signature_label || 'Customer')}</span>${customerSignature}<small class="pack-doc__signed-status">Uploaded customer signature</small></div><div class="pack-doc__signature pack-doc__signature--vendor"><span>${esc(template.vendor_signature_label || 'Vendor')}</span>${vendorSignature}<strong>${esc(template.vendor_signatory_name || template.company_name || DEFAULT_DOCUMENT_COMPANY_NAME)}</strong><small>${esc(template.vendor_signatory_title || 'Authorized signatory')}</small></div></div>`
}

export function renderDocumentHtml(tab: Exclude<DocumentPackTab, 'full'>, input: DocumentPackInput, template: DocumentPackTemplate, assets?: DocumentPackRenderAssets) {
  const total = amount(input.quotationAmount)
  const installation = Math.min(total, 40000)
  const systemGross = Math.max(0, total - installation)
  const systemTaxable = systemGross / 1.05
  const systemTax = systemGross - systemTaxable
  const installTaxable = installation / 1.18
  const installTax = installation - installTaxable
  const configuredFeasibilityChecks = templateChecks(template.feasibility_checks)
  const configuredComponentSpecs = templateComponentSpecs(template.component_specs)
  const configuredFirstPartyActivities = templateLines(template.first_party_activities, firstPartyActivities)
  const configuredSecondPartyActivities = templateLines(template.second_party_activities, secondPartyActivities)
  const common = kv([
    ['Name of Consumer', input.customerName],
    ['Consumer No.', input.consumerNumber],
    ['Discom ID (District)', input.district],
    ['Address of Installation', input.address],
    ['Project Number', input.projectNumber],
    ['Quotation Number', input.quotationNumber],
    ['RTS Capacity Applied', `${input.plantCapacity} kW`],
    ['Actual RTS Capacity to be Installed', `${input.plantCapacity} kW`],
  ])

  if (tab === 'feasibility') return `<article class="pack-doc">${companyHeader(template, template.feasibility_title || 'Vendor Feasibility Report', input)}<p class="pack-doc__subtitle">Residential Rooftop Solar Installation</p><h4>Project & Consumer Details</h4>${common}${kv([
    ['OEM / Panel Brand', input.panelBrand],
    ['Channel Partner', template.company_name || DEFAULT_DOCUMENT_COMPANY_NAME],
    ['EPC Contractor Address', template.address],
    ['EPC Bank Details', template.bank_details],
    ['Vendor Registered in MNRE Portal?', 'YES'],
    ['Feasibility Status', template.feasibility_status || 'FEASIBLE — YES'],
    ['Project Cost (All Inclusive)', money.format(total)],
  ])}<h4>Feasibility Assessment</h4><p><strong>Site Surveyor:</strong> ${esc(input.salesPerson || 'Assigned Agent')} &nbsp; <strong>Designation:</strong> ENGINEER / AGENT</p><table class="pack-doc__check-table"><tbody>${configuredFeasibilityChecks.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table><p class="pack-doc__note">${esc(template.feasibility_note)}</p>${signature(input, template, assets)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  if (tab === 'estimate') return `<article class="pack-doc">${companyHeader(template, template.estimate_title || 'Estimate for Solar Rooftop', input)}<div class="pack-doc__two"><section><h4>Bill To</h4><p><strong>${esc(input.customerName)}</strong><br>${esc(input.address)}</p></section><section><h4>Project Specs</h4><p><strong>Capacity:</strong> ${esc(input.plantCapacity)} kW · <strong>Panels:</strong> ${esc(input.numberOfPanels)}<br><strong>Panel:</strong> ${esc(input.panelSize)} WP – ${esc(input.panelBrand)}<br><strong>Inverter:</strong> ${esc(input.inverterBrand)}</p></section></div><h4>Line Items</h4><table class="pack-doc__quote"><thead><tr><th>#</th><th>Description</th><th>KW</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>Grid Connected Rooftop Solar System</td><td>${esc(input.plantCapacity)}</td><td>${money.format(total)}</td></tr><tr><td>2</td><td>GUVNL subsidy as per applicable norms</td><td>1.00</td><td>Subject to portal eligibility</td></tr><tr><td>3</td><td>DISCOM meter and stamp charges</td><td>1.00</td><td>As applicable</td></tr><tr><td>4</td><td>Fabrication / additional customization</td><td>1.00</td><td>As approved</td></tr><tr class="is-total"><td colspan="3">TOTAL ERP-APPROVED PROJECT VALUE</td><td>${money.format(total)}</td></tr></tbody></table><p class="pack-doc__note">${esc(template.estimate_note)}</p><h4>Component Specifications</h4><table class="pack-doc__quote"><thead><tr><th>Component</th><th>Description</th><th>Make / Brand</th></tr></thead><tbody>${configuredComponentSpecs.map(([component, description, make]) => `<tr><td>${esc(component)}</td><td>${esc(description)}</td><td>${esc(component === 'PV Module' ? input.panelBrand : component === 'Inverter' ? input.inverterBrand : make)}</td></tr>`).join('')}</tbody></table><h4>Banking Details</h4><p class="pack-doc__pre">${esc(template.bank_details || 'Configure bank details in the shared company document template.')}</p><p><strong>Estimate date:</strong> ${esc(input.agreementDate || new Date().toLocaleDateString('en-IN'))} · <strong>Valid until:</strong> ${esc(expiryDate(input.agreementDate, input.validityDays))}</p>${signature(input, template, assets)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  if (tab === 'agreement') return `<article class="pack-doc">${companyHeader(template, template.agreement_title || 'Consumer–Vendor Agreement', input)}<p class="pack-doc__subtitle">${esc(template.agreement_subtitle)}</p><p>This agreement is executed on <strong>${esc(input.agreementDate || new Date().toLocaleDateString('en-IN'))}</strong> for ${esc(template.agreement_intro)}.</p><div class="pack-doc__two"><section><h4>First Party (Consumer)</h4><p><strong>${esc(input.customerName)}</strong><br>${esc(input.address)}</p></section><section><h4>Second Party (Vendor)</h4><p><strong>${esc(template.company_name || DEFAULT_DOCUMENT_COMPANY_NAME)}</strong><br>${esc(template.address)}</p></section></div><h4>The First Party Undertakes to Perform</h4><ol>${configuredFirstPartyActivities.map((item) => `<li>${esc(item)}</li>`).join('')}</ol><h4>The Second Party Undertakes to Perform</h4><ol>${configuredSecondPartyActivities.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>${template.agreement_wording ? `<h4>Company Agreement Wording</h4><p>${esc(template.agreement_wording)}</p>` : ''}${template.terms ? `<h4>Additional Terms</h4><p>${esc(template.terms)}</p>` : ''}<p class="pack-doc__note"><strong>Disclaimer:</strong> ${esc(template.agreement_disclaimer)}</p>${signature(input, template, assets)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  return `<article class="pack-doc">${companyHeader(template, template.quotation_title || 'Solar Quotation', input)}<h4>Customer</h4>${kv([
    ['Name', input.customerName],
    ['Address', input.address],
    ['Quote Number', input.quotationNumber],
    ['Estimate Date', input.agreementDate],
    ['Expiry Date', expiryDate(input.agreementDate, input.validityDays)],
    ['Sales Person', input.salesPerson],
  ])}<h4>System Configuration</h4>${kv([
    ['Plant Capacity', `${input.plantCapacity} kW`],
    ['Number of Panels', input.numberOfPanels],
    ['Panel', `${input.panelSize} WP – ${input.panelBrand}`],
    ['Inverter', input.inverterBrand],
    ['Structure', input.structureType],
    ['AC & DC Cables', input.cableBrand],
  ])}<h4>Quotation Sheet</h4><table class="pack-doc__quote"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th>Taxable</th><th>GST</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>Solar Power Generating System (${esc(input.plantCapacity)} kW, ${esc(input.numberOfPanels)} × ${esc(input.panelSize)} WP – ${esc(input.panelBrand)})</td><td>854140</td><td>${money.format(systemTaxable)}</td><td>5% · ${money.format(systemTax)}</td><td>${money.format(systemGross)}</td></tr><tr><td>2</td><td>Installation &amp; Commissioning of Solar Power Plant (On Grid) – ${esc(input.inverterBrand)} Inverter</td><td>998711</td><td>${money.format(installTaxable)}</td><td>18% · ${money.format(installTax)}</td><td>${money.format(installation)}</td></tr><tr class="is-total"><td colspan="5">TOTAL</td><td>${money.format(total)}</td></tr></tbody></table><h4>Bank Details</h4><p class="pack-doc__pre">${esc(template.bank_details || 'Configure bank details in the shared company document template.')}</p><p class="pack-doc__note">${esc(template.quotation_notes || input.notes || 'Thank you for your business.')}</p>${signature(input, template, assets)}<footer>${esc(template.footer || 'Thank you for your business.')}</footer></article>`
}

export function renderFullDocumentHtml(input: DocumentPackInput, template: DocumentPackTemplate, assets?: DocumentPackRenderAssets) {
  return documentTabs.map((item) => renderDocumentHtml(item.key, input, template, assets)).join('')
}
