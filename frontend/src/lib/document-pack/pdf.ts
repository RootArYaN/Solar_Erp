import type { DocumentPackInput, DocumentPackTab, DocumentPackTemplate } from './types'
import { documentTabs, firstPartyActivities, secondPartyActivities, templateChecks, templateComponentSpecs, templateLines } from './template'
import { amount, expiryDate, number, plainAscii, printable } from './format'
import { documentPackFilePrefix } from './html'

export type PdfAlign = 'left' | 'center' | 'right'

export type PdfCell = { text: string; bold?: boolean; fill?: string; color?: string; align?: PdfAlign }

export type PdfPageCanvas = { commands: string[]; documentTitle: string }

export const PDF_WIDTH = 595

export const PDF_HEIGHT = 842

export const PDF_MARGIN_X = 42

export const PDF_CONTENT_WIDTH = PDF_WIDTH - (PDF_MARGIN_X * 2)

export const PDF_BOTTOM_TOP = 790

export const PDF_NAVY = '#1a2e6b'

export const PDF_GOLD = '#e1aa22'

export const PDF_INK = '#172033'

export const PDF_MUTED = '#687385'

export const PDF_BORDER = '#d5dde7'

export const PDF_LIGHT_BLUE = '#f0f4fa'

export const PDF_LIGHT_GOLD = '#fff8e8'

export const PDF_GREEN = '#1d6c3c'

export function pdfRgb(hex: string) {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16) / 255
  const green = parseInt(value.slice(2, 4), 16) / 255
  const blue = parseInt(value.slice(4, 6), 16) / 255
  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)}`
}

export function estimatedTextWidth(value: unknown, fontSize: number, bold = false) {
  let units = 0
  for (const char of plainAscii(value)) {
    if (' ilI.,:;!|\''.includes(char)) units += 0.25
    else if ('MW@%#'.includes(char)) units += 0.82
    else if (/[A-Z0-9]/.test(char)) units += 0.58
    else units += 0.49
  }
  return units * fontSize * (bold ? 1.035 : 1)
}

export function wrapPdfText(value: unknown, maxWidth: number, fontSize: number, bold = false) {
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

export class DocumentPackPdfLayout {
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
    this.text(PDF_MARGIN_X, this.cursorTop + 14, this.template.customer_signature_label || 'Customer', 7.6, false, PDF_MUTED)
    this.text(PDF_MARGIN_X, this.cursorTop + 31, this.input.customerSignatureName || this.input.customerName, 9, true, PDF_INK)
    this.text(PDF_MARGIN_X, this.cursorTop + 48, this.template.customer_signature_line || 'Signature: ____________________', 7.6, false, PDF_MUTED)
    this.text(vendorX, this.cursorTop + 14, this.template.vendor_signature_label || 'Vendor', 7.6, false, PDF_MUTED)
    this.text(vendorX, this.cursorTop + 31, this.template.vendor_signatory_name || this.template.company_name || 'Shree Enterprise', 9, true, PDF_INK)
    this.text(vendorX, this.cursorTop + 48, this.template.vendor_signatory_title || 'Authorized signatory', 7.6, false, PDF_MUTED)
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

export function pdfMoney(value: number) {
  return `INR ${number.format(value)}`
}

export function buildDocumentPackPdfStreams(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all') {
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
    layout.beginDocument(template.feasibility_title || 'Vendor Feasibility Report', 'Residential Rooftop Solar Installation')
    layout.section('Project & Consumer Details')
    layout.kvTable(commonRows)
    layout.kvTable([
      ['OEM / Panel Brand', input.panelBrand],
      ['Channel Partner', template.company_name || 'Shree Enterprise'],
      ['EPC Contractor Address', template.address],
      ['EPC Bank Details', template.bank_details],
      ['Vendor Registered in MNRE Portal?', 'YES'],
      ['Feasibility Status', template.feasibility_status || 'FEASIBLE - YES'],
      ['Project Cost (All Inclusive)', pdfMoney(total)],
    ])
    layout.section('Feasibility Assessment')
    layout.paragraph(`Site Surveyor: ${input.salesPerson || 'Assigned Agent'}    Designation: ENGINEER / AGENT`, { bold: true })
    layout.table(null, configuredFeasibilityChecks.map(([label, value]) => [
      { text: label, bold: true, fill: PDF_LIGHT_BLUE, color: '#203b67' },
      { text: value, bold: true, color: PDF_GREEN, align: 'center' },
    ]), [360, PDF_CONTENT_WIDTH - 360], { fontSize: 7.7, padding: 4.5 })
    layout.note(template.feasibility_note)
    layout.signatures()
  }

  if (shouldRender('estimate')) {
    layout.beginDocument(template.estimate_title || 'Estimate for Solar Rooftop')
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
    layout.note(template.estimate_note)
    layout.section('Component Specifications')
    layout.table(
      [{ text: 'Component' }, { text: 'Description' }, { text: 'Make / Brand' }],
      configuredComponentSpecs.map(([component, description, make]) => [
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
    layout.beginDocument(template.agreement_title || 'Consumer-Vendor Agreement', template.agreement_subtitle)
    layout.paragraph(`This agreement is executed on ${input.agreementDate || new Date().toLocaleDateString('en-IN')} for ${template.agreement_intro}.`)
    layout.twoBoxes([
      { title: 'First Party (Consumer)', lines: [input.customerName, input.address] },
      { title: 'Second Party (Vendor)', lines: [template.company_name || 'Shree Enterprise', template.address] },
    ])
    layout.section('The First Party Undertakes to Perform')
    layout.numberedList(configuredFirstPartyActivities)
    layout.section('The Second Party Undertakes to Perform')
    layout.numberedList(configuredSecondPartyActivities)
    if (template.agreement_wording) {
      layout.section('Company Agreement Wording')
      layout.paragraph(template.agreement_wording)
    }
    if (template.terms) {
      layout.section('Additional Terms')
      layout.paragraph(template.terms)
    }
    layout.note(`Disclaimer: ${template.agreement_disclaimer}`)
    layout.signatures()
  }

  if (shouldRender('quotation')) {
    layout.beginDocument(template.quotation_title || 'Solar Quotation')
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

export function buildFormattedPdf(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'> | 'all') {
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
