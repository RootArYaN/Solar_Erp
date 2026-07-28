export type DocumentPackTab = 'feasibility' | 'estimate' | 'agreement' | 'quotation' | 'full'

export type DocumentPackInput = {
  customerName: string
  customerNumber: string
  projectNumber: string
  quotationNumber: string
  address: string
  district: string
  consumerNumber: string
  customerCategory: string
  plantCapacity: string
  quotationAmount: string
  panelSize: string
  numberOfPanels: string
  panelBrand: string
  inverterBrand: string
  structureType: string
  cableBrand: string
  salesPerson: string
  agreementDate: string
  validityDays: string
  customerSignatureName: string
  notes: string
}

export type DocumentPackTemplate = {
  company_name: string
  brand_name: string
  address: string
  gstin: string
  phone: string
  email: string
  bank_details: string
  quotation_notes: string
  agreement_wording: string
  footer: string
  terms: string
}

export const documentTabs: Array<{ key: Exclude<DocumentPackTab, 'full'>; label: string; file: string }> = [
  { key: 'feasibility', label: 'Feasibility Report', file: '1_Feasibility_Report' },
  { key: 'estimate', label: 'Bank Estimate', file: '2_Bank_Estimate' },
  { key: 'agreement', label: 'Agreement', file: '3_Consumer_Vendor_Agreement' },
  { key: 'quotation', label: 'Quotation', file: '4_Solar_Quotation' },
]


const feasibilityChecks: Array<[string, string]> = [
  ['TYPE OF ROOF', 'CONCRETE SLAB'],
  ['AREA OF ROOF', '>500 sq. ft.'],
  ['SHADING ANALYSIS', 'SHADOW FREE AREA'],
  ['FEASIBLE FOR FASTENING', 'YES'],
  ['EXISTING METER DETAILS', 'SINGLE PHASE'],
  ['LAND SUITABILITY FOR EARTHING', 'YES'],
  ['MAX-MIN TEMPERATURE RANGE', '10°C TO 45°C'],
  ['GRID VOLTAGE', '250 V'],
  ['ACCESSIBILITY FOR WIRING', 'YES'],
  ['WORK FRIENDLY ENVIRONMENT FOR LABOUR', 'YES'],
  ['ACCESSIBLE ROOF', 'YES'],
  ['WHETHER ROOF HAS LEAKAGE', 'NO'],
  ['ORIENTATION & TILT OF ROOF', 'FLAT SURFACE'],
  ['WHETHER PREMISES HAS INVERTER INSTALLATION POINT', 'YES'],
  ['WHETHER PREMISES HAS BI-DIRECTIONAL NET METER SPACE', 'YES'],
  ['HAZARD IDENTIFICATION (PROXIMITY TO POWER LINES)', 'NO'],
  ['CONSUMER HAS ALL NECESSARY DOCUMENTS (GOVT. GUIDELINES)', 'YES'],
]

const bankComponentSpecs: Array<[string, string, string]> = [
  ['PV Module', 'Monocrystalline Half Cut Bi-Facial | Warranty: 25 years', 'Selected panel brand'],
  ['Inverter', 'On Grid Inverter | Warranty: 08 years', 'Selected inverter brand'],
  ['Protection System', 'DC & AC MCB and SPD', 'L&T / Equivalent'],
  ['Cable', 'Copper flexible for DC & AC | Aluminium LA 16 sqmm', 'POLYCAB / WACAB'],
  ['Structure', 'Hot-Dip ISI GI Pipe 60×40 & 40×40 mm', 'Hindustan / Stark'],
  ['PVC Pipe', 'Conduit Pipe ISI Standard', 'Standard'],
  ['J Bolt', '8 mm Stainless Steel', 'Standard'],
  ['Earthing Kit', 'Copper coated 1M rod + chemical bag + Lightning Arrester', 'Standard'],
]

const firstPartyActivities = [
  'Submit the online application at the National Portal, net-metering application, inspection request and relevant scheme documents.',
  'Provide secure storage of RTS plant material delivered at the premises until system handover.',
  'Provide roof access for installation, testing, operation and maintenance, and meter or inverter reading.',
  'Provide electricity during installation and water for cleaning the panels.',
  'Report any plant malfunction to the vendor during the warranty period.',
  'Pay according to the mutually agreed payment schedule, including approved additional site-specific work or customization.',
]

const secondPartyActivities = [
  'Follow all safety guidelines, state regulations and MNRE technical standards. Supply, installation and commissioning remain the vendor’s responsibility.',
  'Site Survey: Visit and survey the site, prepare the project report, and assess roof feasibility, roof strength and shadow-free area. Additional customization shall be separately estimated and approved.',
  'Design & Engineering: Prepare plant design, drawings and component selection according to DISCOM, SERC and MNRE requirements.',
  'Module and Inverter: Supply eligible modules and inverters conforming to applicable MNRE standards, quality-control orders and labelling requirements.',
  'Procurement & Supply: Procure the complete system according to applicable BIS, IS and IEC standards and subsidy-eligibility requirements.',
  'Installation & Civil Work: Complete required civil, structural and electrical work while following applicable safety and BIS standards.',
  'Documentation: Provide technical catalogues, warranty certificates, BIS certificates, test reports, serial numbers, layouts, SLD, structure drawings and cable details needed for portal submission.',
  'Project Completion Report: Assist the consumer with signed PCR documents and National Portal submission.',
  'Warranty: Provide system and component warranty documents. The complete system shall carry five-year vendor support from DISCOM commissioning, subject to the agreement and manufacturer terms.',
  'Net Meter & Grid Connectivity: Assist with net-meter procurement, testing, approval and plant grid connection.',
  'Testing and Commissioning: Remain present and provide assistance during DISCOM testing and commissioning.',
  'Operation & Maintenance: Provide five years of comprehensive operation and maintenance and educate the consumer on module cleaning and system care.',
  'Insurance: Material transfer and storage insurance before commissioning remains in the vendor scope where applicable.',
  'Applicable Standard: Supply components and services meeting standards notified by MNRE and the State DISCOM.',
  'Project Cost & Payment Terms: Record the mutually agreed plant cost and milestone payment schedule in the approved quotation and ERP workflow.',
  'Dispute: Consumer and vendor shall settle disputes mutually or according to law; MNRE and the Distribution Utility are not parties to the dispute.',
  'Subsidy Documents: Provide and help upload project documents required for National Portal subsidy processing.',
  'Plant Performance: Target a Performance Ratio of 75% at commissioning and support required testing under the applicable scheme and DISCOM procedure.',
]

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

function amount(value: string) {
  return Number(String(value || '').replace(/[^0-9.-]/g, '')) || 0
}

function esc(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function plainAscii(value: unknown) {
  return String(value ?? '')
    .replaceAll('₹', 'INR ')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
}

function printable(value: unknown) {
  return plainAscii(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function wrap(value: unknown, width = 76) {
  const words = plainAscii(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length > width && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['-']
}

function wrapMultiline(value: unknown, width = 76) {
  return String(value ?? '').split(/\r?\n/).flatMap((line) => wrap(line, width))
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'customer'
}

function expiryDate(dateValue: string, daysValue: string) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date()
  date.setDate(date.getDate() + (Number(daysValue) || 15))
  return date.toLocaleDateString('en-IN')
}

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

function companyHeader(template: DocumentPackTemplate, title: string, input: DocumentPackInput) {
  return `<header class="pack-doc__head"><div><strong>${esc(template.company_name || template.brand_name || 'Shree Enterprise')}</strong><span>${esc(template.address)}</span><small>${esc([template.phone, template.email, template.gstin && `GSTIN ${template.gstin}`].filter(Boolean).join(' · '))}</small></div><div><h3>${esc(title)}</h3><span>${esc(input.projectNumber || input.customerNumber)}</span><small>${new Date().toLocaleDateString('en-IN')}</small></div></header>`
}

function kv(rows: Array<[string, unknown]>) {
  return `<table class="pack-doc__table"><tbody>${rows.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value || '—')}</td></tr>`).join('')}</tbody></table>`
}

function signature(input: DocumentPackInput, template: DocumentPackTemplate) {
  return `<div class="pack-doc__signatures"><div><span>Customer</span><strong>${esc(input.customerSignatureName || input.customerName)}</strong><small>Signature: ____________________</small></div><div><span>Vendor</span><strong>${esc(template.company_name || 'Shree Enterprise')}</strong><small>Authorized signatory</small></div></div>`
}

export function renderDocumentHtml(tab: Exclude<DocumentPackTab, 'full'>, input: DocumentPackInput, template: DocumentPackTemplate) {
  const total = amount(input.quotationAmount)
  const installation = Math.min(total, 40000)
  const systemGross = Math.max(0, total - installation)
  const systemTaxable = systemGross / 1.05
  const systemTax = systemGross - systemTaxable
  const installTaxable = installation / 1.18
  const installTax = installation - installTaxable
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

  if (tab === 'feasibility') return `<article class="pack-doc">${companyHeader(template, 'Vendor Feasibility Report', input)}<p class="pack-doc__subtitle">Residential Rooftop Solar Installation</p><h4>Project & Consumer Details</h4>${common}${kv([
    ['OEM / Panel Brand', input.panelBrand],
    ['Channel Partner', template.company_name || 'Shree Enterprise'],
    ['EPC Contractor Address', template.address],
    ['EPC Bank Details', template.bank_details],
    ['Vendor Registered in MNRE Portal?', 'YES'],
    ['Feasibility Status', 'FEASIBLE — YES'],
    ['Project Cost (All Inclusive)', money.format(total)],
  ])}<h4>Feasibility Assessment</h4><p><strong>Site Surveyor:</strong> ${esc(input.salesPerson || 'Assigned Agent')} &nbsp; <strong>Designation:</strong> ENGINEER / AGENT</p><table class="pack-doc__check-table"><tbody>${feasibilityChecks.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('')}</tbody></table><p class="pack-doc__note">Site layout images: Upload 2–4 site photographs to the PM Surya Ghar portal or the customer document checklist.</p>${signature(input, template)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  if (tab === 'estimate') return `<article class="pack-doc">${companyHeader(template, 'Estimate for Solar Rooftop', input)}<div class="pack-doc__two"><section><h4>Bill To</h4><p><strong>${esc(input.customerName)}</strong><br>${esc(input.address)}</p></section><section><h4>Project Specs</h4><p><strong>Capacity:</strong> ${esc(input.plantCapacity)} kW · <strong>Panels:</strong> ${esc(input.numberOfPanels)}<br><strong>Panel:</strong> ${esc(input.panelSize)} WP – ${esc(input.panelBrand)}<br><strong>Inverter:</strong> ${esc(input.inverterBrand)}</p></section></div><h4>Line Items</h4><table class="pack-doc__quote"><thead><tr><th>#</th><th>Description</th><th>KW</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>Grid Connected Rooftop Solar System</td><td>${esc(input.plantCapacity)}</td><td>${money.format(total)}</td></tr><tr><td>2</td><td>GUVNL subsidy as per applicable norms</td><td>1.00</td><td>Subject to portal eligibility</td></tr><tr><td>3</td><td>DISCOM meter and stamp charges</td><td>1.00</td><td>As applicable</td></tr><tr><td>4</td><td>Fabrication / additional customization</td><td>1.00</td><td>As approved</td></tr><tr class="is-total"><td colspan="3">TOTAL ERP-APPROVED PROJECT VALUE</td><td>${money.format(total)}</td></tr></tbody></table><p class="pack-doc__note"><strong>T&C:</strong> Three-phase meter or site-specific DISCOM charges, additional structure height and non-standard civil work are charged only after approval.</p><h4>Component Specifications</h4><table class="pack-doc__quote"><thead><tr><th>Component</th><th>Description</th><th>Make / Brand</th></tr></thead><tbody>${bankComponentSpecs.map(([component, description, make]) => `<tr><td>${esc(component)}</td><td>${esc(description)}</td><td>${esc(component === 'PV Module' ? input.panelBrand : component === 'Inverter' ? input.inverterBrand : make)}</td></tr>`).join('')}</tbody></table><h4>Banking Details</h4><p class="pack-doc__pre">${esc(template.bank_details || 'Configure bank details in the shared company document template.')}</p><p><strong>Estimate date:</strong> ${esc(input.agreementDate || new Date().toLocaleDateString('en-IN'))} · <strong>Valid until:</strong> ${esc(expiryDate(input.agreementDate, input.validityDays))}</p>${signature(input, template)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  if (tab === 'agreement') return `<article class="pack-doc">${companyHeader(template, 'Consumer–Vendor Agreement', input)}<p class="pack-doc__subtitle">Annexure 2 · PM – Surya Ghar: Muft Bijli Yojana</p><p>This agreement is executed on <strong>${esc(input.agreementDate || new Date().toLocaleDateString('en-IN'))}</strong> for design, supply, installation, commissioning and five-year comprehensive maintenance of the RTS project/system along with warranty.</p><div class="pack-doc__two"><section><h4>First Party (Consumer)</h4><p><strong>${esc(input.customerName)}</strong><br>${esc(input.address)}</p></section><section><h4>Second Party (Vendor)</h4><p><strong>${esc(template.company_name || 'Shree Enterprise')}</strong><br>${esc(template.address)}</p></section></div><h4>The First Party Undertakes to Perform</h4><ol>${firstPartyActivities.map((item) => `<li>${esc(item)}</li>`).join('')}</ol><h4>The Second Party Undertakes to Perform</h4><ol>${secondPartyActivities.map((item) => `<li>${esc(item)}</li>`).join('')}</ol>${template.agreement_wording ? `<h4>Company Agreement Wording</h4><p>${esc(template.agreement_wording)}</p>` : ''}${template.terms ? `<h4>Additional Terms</h4><p>${esc(template.terms)}</p>` : ''}<p class="pack-doc__note"><strong>Disclaimer:</strong> This agreement is between vendor and consumer. Any dispute related to it shall not involve MNRE or the Distribution Utility except where required by law or applicable scheme procedure.</p>${signature(input, template)}<footer>${esc(template.footer || 'Computer-generated ERP document.')}</footer></article>`

  return `<article class="pack-doc">${companyHeader(template, 'QUOTE', input)}<h4>Customer</h4>${kv([
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
  ])}<h4>Quotation Sheet</h4><table class="pack-doc__quote"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th>Taxable</th><th>GST</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>Solar Power Generating System (${esc(input.plantCapacity)} kW, ${esc(input.numberOfPanels)} × ${esc(input.panelSize)} WP – ${esc(input.panelBrand)})</td><td>854140</td><td>${money.format(systemTaxable)}</td><td>5% · ${money.format(systemTax)}</td><td>${money.format(systemGross)}</td></tr><tr><td>2</td><td>Installation &amp; Commissioning of Solar Power Plant (On Grid) – ${esc(input.inverterBrand)} Inverter</td><td>998711</td><td>${money.format(installTaxable)}</td><td>18% · ${money.format(installTax)}</td><td>${money.format(installation)}</td></tr><tr class="is-total"><td colspan="5">TOTAL</td><td>${money.format(total)}</td></tr></tbody></table><h4>Bank Details</h4><p class="pack-doc__pre">${esc(template.bank_details || 'Configure bank details in the shared company document template.')}</p><p class="pack-doc__note">${esc(template.quotation_notes || input.notes || 'Thank you for your business.')}</p>${signature(input, template)}<footer>${esc(template.footer || 'Thank you for your business.')}</footer></article>`
}

export function renderFullDocumentHtml(input: DocumentPackInput, template: DocumentPackTemplate) {
  return documentTabs.map((item) => renderDocumentHtml(item.key, input, template)).join('')
}

type PdfAlign = 'left' | 'center' | 'right'
type PdfCell = { text: string; bold?: boolean; fill?: string; color?: string; align?: PdfAlign }
type PdfPageCanvas = { commands: string[]; documentTitle: string }

const PDF_WIDTH = 595
const PDF_HEIGHT = 842
const PDF_MARGIN_X = 42
const PDF_CONTENT_WIDTH = PDF_WIDTH - (PDF_MARGIN_X * 2)
const PDF_BOTTOM_TOP = 790
const PDF_NAVY = '#1a2e6b'
const PDF_GOLD = '#e1aa22'
const PDF_INK = '#172033'
const PDF_MUTED = '#687385'
const PDF_BORDER = '#d5dde7'
const PDF_LIGHT_BLUE = '#f0f4fa'
const PDF_LIGHT_GOLD = '#fff8e8'
const PDF_GREEN = '#1d6c3c'

function pdfRgb(hex: string) {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16) / 255
  const green = parseInt(value.slice(2, 4), 16) / 255
  const blue = parseInt(value.slice(4, 6), 16) / 255
  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)}`
}

function estimatedTextWidth(value: unknown, fontSize: number, bold = false) {
  let units = 0
  for (const char of plainAscii(value)) {
    if (' ilI.,:;!|\''.includes(char)) units += 0.25
    else if ('MW@%#'.includes(char)) units += 0.82
    else if (/[A-Z0-9]/.test(char)) units += 0.58
    else units += 0.49
  }
  return units * fontSize * (bold ? 1.035 : 1)
}

function wrapPdfText(value: unknown, maxWidth: number, fontSize: number, bold = false) {
  const source = plainAscii(value).replace(/\s+/g, ' ').trim()
  if (!source) return ['-']
  const words = source.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && estimatedTextWidth(next, fontSize, bold) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

class DocumentPackPdfLayout {
  private pages: PdfPageCanvas[] = []
  private page: PdfPageCanvas | null = null
  private cursorTop = 100
  private currentTitle = ''
  private currentSubtitle = ''

  constructor(private input: DocumentPackInput, private template: DocumentPackTemplate) {}

  private command(value: string) {
    this.page?.commands.push(value)
  }

  private topToPdfY(top: number, fontSize = 0) {
    return PDF_HEIGHT - top - fontSize
  }

  private setFill(hex: string) {
    this.command(`${pdfRgb(hex)} rg`)
  }

  private setStroke(hex: string) {
    this.command(`${pdfRgb(hex)} RG`)
  }

  private rectangle(x: number, top: number, width: number, height: number, fill?: string, stroke = PDF_BORDER, strokeWidth = 0.6) {
    if (fill) this.setFill(fill)
    if (stroke) this.setStroke(stroke)
    this.command(`${strokeWidth} w ${x.toFixed(2)} ${(PDF_HEIGHT - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`)
  }

  private line(x1: number, top1: number, x2: number, top2: number, color = PDF_BORDER, width = 0.6) {
    this.setStroke(color)
    this.command(`${width} w ${x1.toFixed(2)} ${(PDF_HEIGHT - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PDF_HEIGHT - top2).toFixed(2)} l S`)
  }

  private text(x: number, top: number, value: unknown, size = 9, bold = false, color = PDF_INK, align: PdfAlign = 'left', boxWidth = 0) {
    const content = printable(value)
    const width = estimatedTextWidth(content, size, bold)
    const effectiveX = align === 'right' ? x + boxWidth - width : align === 'center' ? x + ((boxWidth - width) / 2) : x
    this.command(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${pdfRgb(color)} rg ${effectiveX.toFixed(2)} ${this.topToPdfY(top, size).toFixed(2)} Td (${content}) Tj ET`)
  }

  private newPage(continued = false) {
    this.page = { commands: [], documentTitle: this.currentTitle }
    this.pages.push(this.page)
    const company = this.template.company_name || this.template.brand_name || 'Shree Enterprise'
    const contact = [this.template.phone, this.template.email, this.template.gstin && `GSTIN ${this.template.gstin}`].filter(Boolean).join(' - ')
    this.text(PDF_MARGIN_X, 29, company, 18, true, PDF_NAVY)
    if (this.template.address) this.text(PDF_MARGIN_X, 51, this.template.address, 7.6, false, PDF_MUTED)
    if (contact) this.text(PDF_MARGIN_X, 64, contact, 7.2, false, PDF_MUTED)
    const title = continued ? `${this.currentTitle} (Continued)` : this.currentTitle
    const titleLines = wrapPdfText(title, 225, title.length > 34 ? 10.5 : 13.5, true)
    titleLines.slice(0, 2).forEach((line, index) => this.text(328, 30 + (index * 14), line, title.length > 34 ? 10.5 : 13.5, true, PDF_NAVY, 'right', 225))
    this.text(328, 62, this.input.projectNumber || this.input.customerNumber, 7.5, false, PDF_MUTED, 'right', 225)
    this.text(328, 74, new Date().toLocaleDateString('en-IN'), 7.2, false, PDF_MUTED, 'right', 225)
    this.rectangle(PDF_MARGIN_X, 84, PDF_CONTENT_WIDTH, 2.7, PDF_GOLD, PDF_GOLD, 0)
    this.cursorTop = 101
    if (!continued && this.currentSubtitle) {
      this.text(PDF_MARGIN_X, this.cursorTop, this.currentSubtitle, 8, false, PDF_MUTED, 'right', PDF_CONTENT_WIDTH)
      this.cursorTop += 18
    }
  }

  beginDocument(title: string, subtitle = '') {
    this.currentTitle = title
    this.currentSubtitle = subtitle
    this.newPage(false)
  }

  private ensure(height: number) {
    if (this.cursorTop + height <= PDF_BOTTOM_TOP) return
    this.newPage(true)
  }

  gap(points = 7) {
    this.cursorTop += points
  }

  section(title: string) {
    this.ensure(27)
    this.text(PDF_MARGIN_X, this.cursorTop, title.toUpperCase(), 9.2, true, PDF_NAVY)
    this.cursorTop += 15
    this.rectangle(PDF_MARGIN_X, this.cursorTop, PDF_CONTENT_WIDTH, 1.6, PDF_GOLD, PDF_GOLD, 0)
    this.cursorTop += 8
  }

  paragraph(value: unknown, options: { bold?: boolean; color?: string; indent?: number; fontSize?: number; align?: PdfAlign } = {}) {
    const size = options.fontSize ?? 8.8
    const x = PDF_MARGIN_X + (options.indent ?? 0)
    const width = PDF_CONTENT_WIDTH - (options.indent ?? 0)
    const lines = String(value ?? '').split(/\r?\n/).flatMap((line) => wrapPdfText(line, width, size, Boolean(options.bold)))
    const lineHeight = size * 1.35
    this.ensure((lines.length * lineHeight) + 6)
    for (const line of lines) {
      this.text(x, this.cursorTop, line, size, Boolean(options.bold), options.color ?? PDF_INK, options.align ?? 'left', width)
      this.cursorTop += lineHeight
    }
    this.cursorTop += 4
  }

  note(value: unknown) {
    const size = 8.1
    const lines = wrapPdfText(value, PDF_CONTENT_WIDTH - 24, size)
    const height = Math.max(30, (lines.length * 11) + 14)
    this.ensure(height + 6)
    this.rectangle(PDF_MARGIN_X, this.cursorTop, PDF_CONTENT_WIDTH, height, PDF_LIGHT_GOLD, '#ecd59f', 0.5)
    this.rectangle(PDF_MARGIN_X, this.cursorTop, 3.2, height, PDF_GOLD, PDF_GOLD, 0)
    lines.forEach((line, index) => this.text(PDF_MARGIN_X + 12, this.cursorTop + 8 + (index * 11), line, size, false, '#535e6b'))
    this.cursorTop += height + 7
  }

  twoBoxes(boxes: Array<{ title: string; lines: string[] }>) {
    const boxWidth = (PDF_CONTENT_WIDTH - 12) / 2
    const size = 8.2
    const wrapped = boxes.map((box) => box.lines.flatMap((line) => wrapPdfText(line, boxWidth - 20, size, line === box.lines[0])))
    const height = Math.max(...wrapped.map((lines) => lines.length)) * 11 + 34
    this.ensure(height + 8)
    boxes.slice(0, 2).forEach((box, index) => {
      const x = PDF_MARGIN_X + (index * (boxWidth + 12))
      this.rectangle(x, this.cursorTop, boxWidth, height, '#fbfcfe', PDF_BORDER, 0.6)
      this.text(x + 9, this.cursorTop + 9, box.title.toUpperCase(), 8, true, PDF_NAVY)
      this.rectangle(x + 9, this.cursorTop + 23, boxWidth - 18, 1.3, PDF_GOLD, PDF_GOLD, 0)
      let top = this.cursorTop + 31
      wrapped[index].forEach((line, lineIndex) => {
        this.text(x + 9, top, line, size, lineIndex === 0, PDF_INK)
        top += 11
      })
    })
    this.cursorTop += height + 8
  }

  table(headers: PdfCell[] | null, rows: PdfCell[][], widths: number[], options: { fontSize?: number; padding?: number; headerFontSize?: number } = {}) {
    const size = options.fontSize ?? 7.8
    const padding = options.padding ?? 5
    const headerSize = options.headerFontSize ?? size
    const lineHeight = size * 1.3
    const headerLineHeight = headerSize * 1.3

    const drawRow = (cells: PdfCell[], isHeader: boolean) => {
      const rowLines = cells.map((cell, index) => wrapPdfText(cell.text, widths[index] - (padding * 2), isHeader ? headerSize : size, Boolean(cell.bold || isHeader)))
      const rowHeight = Math.max(...rowLines.map((lines) => lines.length)) * (isHeader ? headerLineHeight : lineHeight) + (padding * 2)
      if (!isHeader && this.cursorTop + rowHeight > PDF_BOTTOM_TOP) {
        this.newPage(true)
        if (headers) drawRow(headers, true)
      }
      let x = PDF_MARGIN_X
      cells.forEach((cell, index) => {
        const fill = cell.fill ?? (isHeader ? PDF_NAVY : '#ffffff')
        const color = cell.color ?? (isHeader ? '#ffffff' : PDF_INK)
        this.rectangle(x, this.cursorTop, widths[index], rowHeight, fill, PDF_BORDER, 0.45)
        rowLines[index].forEach((line, lineIndex) => {
          this.text(x + padding, this.cursorTop + padding + (lineIndex * (isHeader ? headerLineHeight : lineHeight)), line, isHeader ? headerSize : size, Boolean(cell.bold || isHeader), color, cell.align ?? 'left', widths[index] - (padding * 2))
        })
        x += widths[index]
      })
      this.cursorTop += rowHeight
    }

    if (headers) {
      const headerLines = headers.map((cell, index) => wrapPdfText(cell.text, widths[index] - (padding * 2), headerSize, true))
      const estimatedHeaderHeight = Math.max(...headerLines.map((lines) => lines.length)) * headerLineHeight + (padding * 2)
      this.ensure(estimatedHeaderHeight + 18)
      drawRow(headers, true)
    }
    for (const row of rows) drawRow(row, false)
    this.cursorTop += 7
  }

  kvTable(rows: Array<[string, unknown]>) {
    this.table(null, rows.map(([label, value]) => [
      { text: label, bold: true, fill: PDF_LIGHT_BLUE, color: '#203b67' },
      { text: String(value || '-') },
    ]), [190, PDF_CONTENT_WIDTH - 190], { fontSize: 8, padding: 5.5 })
  }

  numberedList(items: string[]) {
    const size = 8.25
    const numberWidth = 20
    for (let index = 0; index < items.length; index += 1) {
      const lines = wrapPdfText(items[index], PDF_CONTENT_WIDTH - numberWidth - 4, size)
      const height = Math.max(15, lines.length * 10.8) + 3
      this.ensure(height)
      this.text(PDF_MARGIN_X, this.cursorTop, `${index + 1}.`, size, true, PDF_NAVY)
      lines.forEach((line, lineIndex) => this.text(PDF_MARGIN_X + numberWidth, this.cursorTop + (lineIndex * 10.8), line, size, false, PDF_INK))
      this.cursorTop += height
    }
    this.cursorTop += 3
  }

  signatures() {
    const height = 74
    this.ensure(height)
    this.line(PDF_MARGIN_X, this.cursorTop, PDF_MARGIN_X + PDF_CONTENT_WIDTH, this.cursorTop, PDF_BORDER, 0.8)
    const columnWidth = (PDF_CONTENT_WIDTH - 42) / 2
    const vendorX = PDF_MARGIN_X + columnWidth + 42
    this.text(PDF_MARGIN_X, this.cursorTop + 14, 'Customer', 7.6, false, PDF_MUTED)
    this.text(PDF_MARGIN_X, this.cursorTop + 31, this.input.customerSignatureName || this.input.customerName, 9, true, PDF_INK)
    this.text(PDF_MARGIN_X, this.cursorTop + 48, 'Signature: ____________________', 7.6, false, PDF_MUTED)
    this.text(vendorX, this.cursorTop + 14, 'Vendor', 7.6, false, PDF_MUTED)
    this.text(vendorX, this.cursorTop + 31, this.template.company_name || 'Shree Enterprise', 9, true, PDF_INK)
    this.text(vendorX, this.cursorTop + 48, 'Authorized signatory', 7.6, false, PDF_MUTED)
    this.cursorTop += height
  }

  finish() {
    const footer = this.template.footer || 'Computer-generated ERP document.'
    const totalPages = this.pages.length
    this.pages.forEach((page, index) => {
      this.page = page
      this.line(PDF_MARGIN_X, 804, PDF_MARGIN_X + PDF_CONTENT_WIDTH, 804, PDF_BORDER, 0.55)
      this.text(PDF_MARGIN_X, 812, footer, 6.8, false, PDF_MUTED)
      this.text(PDF_MARGIN_X, 812, `Page ${index + 1} of ${totalPages}`, 6.8, false, PDF_MUTED, 'right', PDF_CONTENT_WIDTH)
    })
    return this.pages.map((page) => page.commands.join('\n'))
  }
}

function pdfMoney(value: number) {
  return `INR ${number.format(value)}`
}

function buildDocumentPackPdfStreams(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all') {
  const total = amount(input.quotationAmount)
  const installation = Math.min(total, 40000)
  const systemGross = Math.max(0, total - installation)
  const systemTaxable = systemGross / 1.05
  const systemTax = systemGross - systemTaxable
  const installTaxable = installation / 1.18
  const installTax = installation - installTaxable
  const layout = new DocumentPackPdfLayout(input, template)
  const shouldRender = (tab: Exclude<DocumentPackTab, 'full'>) => selected === 'all' || selected === tab
  const commonRows: Array<[string, unknown]> = [
    ['Name of Consumer', input.customerName],
    ['Consumer No.', input.consumerNumber],
    ['Discom ID (District)', input.district],
    ['Address of Installation', input.address],
    ['Project Number', input.projectNumber],
    ['Quotation Number', input.quotationNumber],
    ['RTS Capacity Applied', `${input.plantCapacity} kW`],
    ['Actual RTS Capacity to be Installed', `${input.plantCapacity} kW`],
  ]

  if (shouldRender('feasibility')) {
    layout.beginDocument('Vendor Feasibility Report', 'Residential Rooftop Solar Installation')
    layout.section('Project & Consumer Details')
    layout.kvTable(commonRows)
    layout.kvTable([
      ['OEM / Panel Brand', input.panelBrand],
      ['Channel Partner', template.company_name || 'Shree Enterprise'],
      ['EPC Contractor Address', template.address],
      ['EPC Bank Details', template.bank_details],
      ['Vendor Registered in MNRE Portal?', 'YES'],
      ['Feasibility Status', 'FEASIBLE - YES'],
      ['Project Cost (All Inclusive)', pdfMoney(total)],
    ])
    layout.section('Feasibility Assessment')
    layout.paragraph(`Site Surveyor: ${input.salesPerson || 'Assigned Agent'}    Designation: ENGINEER / AGENT`, { bold: true })
    layout.table(null, feasibilityChecks.map(([label, value]) => [
      { text: label, bold: true, fill: PDF_LIGHT_BLUE, color: '#203b67' },
      { text: value, bold: true, color: PDF_GREEN, align: 'center' },
    ]), [360, PDF_CONTENT_WIDTH - 360], { fontSize: 7.7, padding: 4.5 })
    layout.note('Site layout images: Upload 2-4 site photographs to the PM Surya Ghar portal or the customer document checklist.')
    layout.signatures()
  }

  if (shouldRender('estimate')) {
    layout.beginDocument('Estimate for Solar Rooftop')
    layout.twoBoxes([
      { title: 'Bill To', lines: [input.customerName, input.address] },
      { title: 'Project Specs', lines: [`Capacity: ${input.plantCapacity} kW - Panels: ${input.numberOfPanels}`, `Panel: ${input.panelSize} WP - ${input.panelBrand}`, `Inverter: ${input.inverterBrand}`] },
    ])
    layout.section('Line Items')
    layout.table(
      [{ text: '#' }, { text: 'Description' }, { text: 'KW' }, { text: 'Amount' }],
      [
        [{ text: '1', align: 'center' }, { text: 'Grid Connected Rooftop Solar System' }, { text: input.plantCapacity, align: 'center' }, { text: pdfMoney(total), align: 'right' }],
        [{ text: '2', align: 'center' }, { text: 'GUVNL subsidy as per applicable norms' }, { text: '1.00', align: 'center' }, { text: 'Subject to portal eligibility', align: 'right' }],
        [{ text: '3', align: 'center' }, { text: 'DISCOM meter and stamp charges' }, { text: '1.00', align: 'center' }, { text: 'As applicable', align: 'right' }],
        [{ text: '4', align: 'center' }, { text: 'Fabrication / additional customization' }, { text: '1.00', align: 'center' }, { text: 'As approved', align: 'right' }],
        [{ text: '', fill: PDF_NAVY }, { text: 'TOTAL ERP-APPROVED PROJECT VALUE', bold: true, fill: PDF_NAVY, color: '#ffffff' }, { text: '', fill: PDF_NAVY }, { text: pdfMoney(total), bold: true, fill: PDF_NAVY, color: '#ffffff', align: 'right' }],
      ],
      [28, 286, 52, PDF_CONTENT_WIDTH - 366],
      { fontSize: 7.5, padding: 4.5 },
    )
    layout.note('T&C: Three-phase meter or site-specific DISCOM charges, additional structure height and non-standard civil work are charged only after approval.')
    layout.section('Component Specifications')
    layout.table(
      [{ text: 'Component' }, { text: 'Description' }, { text: 'Make / Brand' }],
      bankComponentSpecs.map(([component, description, make]) => [
        { text: component, bold: true },
        { text: description },
        { text: component === 'PV Module' ? input.panelBrand : component === 'Inverter' ? input.inverterBrand : make },
      ]),
      [110, 255, PDF_CONTENT_WIDTH - 365],
      { fontSize: 7.25, padding: 4.2 },
    )
    layout.section('Banking Details')
    layout.paragraph(template.bank_details || 'Configure bank details in the shared company document template.', { fontSize: 8.2 })
    layout.paragraph(`Estimate date: ${input.agreementDate || new Date().toLocaleDateString('en-IN')}    Valid until: ${expiryDate(input.agreementDate, input.validityDays)}`, { bold: true, fontSize: 8.2 })
    layout.signatures()
  }

  if (shouldRender('agreement')) {
    layout.beginDocument('Consumer-Vendor Agreement', 'Annexure 2 - PM Surya Ghar: Muft Bijli Yojana')
    layout.paragraph(`This agreement is executed on ${input.agreementDate || new Date().toLocaleDateString('en-IN')} for design, supply, installation, commissioning and five-year comprehensive maintenance of the RTS project/system along with warranty.`)
    layout.twoBoxes([
      { title: 'First Party (Consumer)', lines: [input.customerName, input.address] },
      { title: 'Second Party (Vendor)', lines: [template.company_name || 'Shree Enterprise', template.address] },
    ])
    layout.section('The First Party Undertakes to Perform')
    layout.numberedList(firstPartyActivities)
    layout.section('The Second Party Undertakes to Perform')
    layout.numberedList(secondPartyActivities)
    if (template.agreement_wording) {
      layout.section('Company Agreement Wording')
      layout.paragraph(template.agreement_wording)
    }
    if (template.terms) {
      layout.section('Additional Terms')
      layout.paragraph(template.terms)
    }
    layout.note('Disclaimer: This agreement is between vendor and consumer. Any dispute related to it shall not involve MNRE or the Distribution Utility except where required by law or applicable scheme procedure.')
    layout.signatures()
  }

  if (shouldRender('quotation')) {
    layout.beginDocument('Solar Quotation')
    layout.section('Customer')
    layout.kvTable([
      ['Name', input.customerName],
      ['Address', input.address],
      ['Quote Number', input.quotationNumber],
      ['Estimate Date', input.agreementDate],
      ['Expiry Date', expiryDate(input.agreementDate, input.validityDays)],
      ['Sales Person', input.salesPerson],
    ])
    layout.section('System Configuration')
    layout.kvTable([
      ['Plant Capacity', `${input.plantCapacity} kW`],
      ['Number of Panels', input.numberOfPanels],
      ['Panel', `${input.panelSize} WP - ${input.panelBrand}`],
      ['Inverter', input.inverterBrand],
      ['Structure', input.structureType],
      ['AC & DC Cables', input.cableBrand],
    ])
    layout.section('Quotation Sheet')
    layout.table(
      [{ text: '#' }, { text: 'Description' }, { text: 'HSN/SAC' }, { text: 'Taxable' }, { text: 'GST' }, { text: 'Amount' }],
      [
        [
          { text: '1', align: 'center' },
          { text: `Solar Power Generating System (${input.plantCapacity} kW, ${input.numberOfPanels} x ${input.panelSize} WP - ${input.panelBrand})` },
          { text: '854140', align: 'center' },
          { text: pdfMoney(systemTaxable), align: 'right' },
          { text: `5% - ${pdfMoney(systemTax)}`, align: 'right' },
          { text: pdfMoney(systemGross), align: 'right' },
        ],
        [
          { text: '2', align: 'center' },
          { text: `Installation & Commissioning of Solar Power Plant (On Grid) - ${input.inverterBrand} Inverter` },
          { text: '998711', align: 'center' },
          { text: pdfMoney(installTaxable), align: 'right' },
          { text: `18% - ${pdfMoney(installTax)}`, align: 'right' },
          { text: pdfMoney(installation), align: 'right' },
        ],
        [
          { text: '', fill: PDF_NAVY },
          { text: 'TOTAL', bold: true, fill: PDF_NAVY, color: '#ffffff' },
          { text: '', fill: PDF_NAVY },
          { text: '', fill: PDF_NAVY },
          { text: '', fill: PDF_NAVY },
          { text: pdfMoney(total), bold: true, fill: PDF_NAVY, color: '#ffffff', align: 'right' },
        ],
      ],
      [22, 214, 50, 76, 76, PDF_CONTENT_WIDTH - 438],
      { fontSize: 6.8, padding: 3.7, headerFontSize: 6.7 },
    )
    layout.section('Bank Details')
    layout.paragraph(template.bank_details || 'Configure bank details in the shared company document template.', { fontSize: 8.2 })
    layout.note(template.quotation_notes || input.notes || 'Thank you for your business.')
    layout.signatures()
  }

  return layout.finish()
}

function buildFormattedPdf(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all') {
  const streams = buildDocumentPackPdfStreams(input, template, selected)
  const objects: string[] = []
  const pageIds = streams.map((_, index) => 6 + (index * 2))
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  streams.forEach((stream, index) => {
    const contentId = 5 + (index * 2)
    const pageId = contentId + 1
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
  })
  let pdf = '%PDF-1.4\n%ERP-DOCUMENT-PACK\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

export async function createDocumentPackPdf(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all' = 'all') {
  return buildFormattedPdf(input, template, selected)
}

export async function downloadDocumentPackPdf(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all', version?: number) {
  const blob = await createDocumentPackPdf(input, template, selected)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const part = selected === 'all' ? 'Merged_Document_Pack' : documentTabs.find((item) => item.key === selected)?.file || selected
  anchor.href = url
  anchor.download = `${documentPackFilePrefix(input, version)}_${part}.pdf`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function downloadDocumentWord(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'>) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11pt;color:#172033}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #ccd4df;padding:6px;text-align:left}h3,h4{color:#1a2e6b}.pack-doc__head,.pack-doc__signatures{display:flex;justify-content:space-between}.pack-doc__head span,.pack-doc__head small,.pack-doc__signatures span,.pack-doc__signatures small{display:block}</style></head><body>${renderDocumentHtml(selected, input, template)}</body></html>`
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${documentPackFilePrefix(input)}_${documentTabs.find((item) => item.key === selected)?.file}.doc`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadQuotationCsv(input: DocumentPackInput) {
  const total = amount(input.quotationAmount)
  const install = Math.min(total, 40000)
  const rows = [
    ['Quote Number', input.quotationNumber],
    ['Customer', input.customerName],
    ['Address', input.address],
    ['Project', input.projectNumber],
    [],
    ['#', 'Description', 'HSN/SAC', 'Amount'],
    ['1', `Solar Power Generating System (${input.plantCapacity} kW, ${input.numberOfPanels} x ${input.panelSize} WP - ${input.panelBrand})`, '854140', String(total - install)],
    ['2', `Installation and Commissioning - ${input.inverterBrand}`, '998711', String(install)],
    ['', 'TOTAL', '', String(total)],
  ]
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${documentPackFilePrefix(input)}_4_Solar_Quotation.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function printDocumentPack(input: DocumentPackInput, template: DocumentPackTemplate, selected: DocumentPackTab) {
  const body = selected === 'full' ? renderFullDocumentHtml(input, template) : renderDocumentHtml(selected, input, template)
  const win = window.open('', '_blank', 'width=960,height=760')
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Document Pack</title><style>body{margin:0;background:#eef1f6;font-family:Arial,sans-serif;color:#172033}.pack-doc{box-sizing:border-box;width:210mm;min-height:297mm;margin:10mm auto;padding:16mm;background:#fff;page-break-after:always}.pack-doc__head,.pack-doc__signatures{display:flex;justify-content:space-between;gap:24px}.pack-doc__head>div:last-child{text-align:right}.pack-doc__head span,.pack-doc__head small,.pack-doc__signatures span,.pack-doc__signatures small{display:block;color:#687385;margin-top:4px}.pack-doc__head{padding-bottom:12px;border-bottom:3px solid #e8b424}.pack-doc h3{margin:0;color:#1a2e6b}.pack-doc h4{margin:20px 0 8px;color:#1a2e6b;border-bottom:2px solid #e8b424;padding-bottom:5px}.pack-doc__table,.pack-doc__quote{width:100%;border-collapse:collapse}.pack-doc__table th,.pack-doc__table td,.pack-doc__quote th,.pack-doc__quote td{border:1px solid #dce2ec;padding:7px;text-align:left;font-size:12px}.pack-doc__table th{width:38%;background:#f0f4fb}.pack-doc__quote th{background:#1a2e6b;color:#fff}.pack-doc__quote .is-total td{font-weight:bold;background:#f5f7fb}.pack-doc__checks{line-height:1.8}.pack-doc__check-table{width:100%;border-collapse:collapse}.pack-doc__check-table th,.pack-doc__check-table td{border:1px solid #dce2ec;padding:6px;text-align:left;font-size:11px}.pack-doc__check-table th{width:70%;background:#f0f4fb}.pack-doc__two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pack-doc__two section{border:1px solid #dce2ec;padding:10px}.pack-doc__pre{white-space:pre-line}.pack-doc__subtitle{text-align:right;color:#687385;font-size:11px}.pack-doc__checks .is-approved{font-weight:bold;color:#1e6b3a}.pack-doc__note{padding:10px;background:#fff8e6;border-left:3px solid #e8b424}.pack-doc__signatures{margin-top:35px;padding-top:15px;border-top:1px solid #ccd4df}.pack-doc footer{margin-top:35px;padding-top:8px;border-top:1px solid #dce2ec;color:#7b8491;font-size:10px}@media print{body{background:#fff}.pack-doc{margin:0;box-shadow:none}@page{size:A4;margin:0}}</style></head><body>${body}</body></html>`)
  win.document.close()
  win.onload = () => window.setTimeout(() => win.print(), 250)
  return true
}
