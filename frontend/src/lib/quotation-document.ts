import type { WorkflowQuotation } from '../types'

export type QuotationDocumentData = {
  quotation: WorkflowQuotation
  customerName: string
  companyName?: string
  phone?: string
  email?: string
  address?: string
  siteAddress?: string
  capacityKw?: number
  notes?: string
  agentName?: string
}

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

export function formatQuotationMoney(value: number) {
  return money.format(Number(value || 0))
}

export function quotationFileName(quotationNumber: string) {
  const safeNumber = quotationNumber.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  return `${safeNumber || 'quotation'}.pdf`
}

function pdfText(value: unknown) {
  return String(value ?? '')
    .replaceAll('₹', 'INR ')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function shortText(value: string, maxLength: number) {
  const clean = pdfText(value).replace(/\s+/g, ' ').trim()
  return clean.length <= maxLength ? clean : `${clean.slice(0, Math.max(0, maxLength - 3))}...`
}

function number(value: number) {
  return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function buildPdf(data: QuotationDocumentData) {
  const { quotation } = data
  const lines = quotation.lines.length > 0 ? quotation.lines : [{
    description: quotation.title,
    quantity: 1,
    unit: 'Lot',
    unit_price: quotation.subtotal,
    tax_rate: quotation.subtotal > 0 ? (quotation.tax_total / quotation.subtotal) * 100 : 0,
    line_total: quotation.grand_total,
  }]

  const chunks: typeof lines[] = []
  let cursor = 0
  while (cursor < lines.length) {
    const size = chunks.length === 0 ? 12 : 18
    chunks.push(lines.slice(cursor, cursor + size))
    cursor += size
  }
  if (chunks.length === 0) chunks.push([])

  const pageStreams = chunks.map((pageLines, pageIndex) => {
    const firstPage = pageIndex === 0
    const finalPage = pageIndex === chunks.length - 1
    const commands: string[] = []
    const text = (x: number, y: number, size: number, value: unknown, bold = false) => {
      commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`)
    }
    const line = (x1: number, y1: number, x2: number, y2: number, width = 0.7) => {
      commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`)
    }
    const rect = (x: number, y: number, width: number, height: number, fillGray?: number) => {
      if (fillGray !== undefined) commands.push(`${fillGray} g ${x} ${y} ${width} ${height} re f 0 g`)
      commands.push(`0.7 w ${x} ${y} ${width} ${height} re S`)
    }

    text(42, 796, 20, 'SHREE ENTERPRISE', true)
    text(42, 780, 9, 'Solar EPC quotation')
    text(438, 796, 10, quotation.status === 'approved' ? 'APPROVED' : quotation.status.toUpperCase(), true)
    line(42, 770, 553, 770, 1.2)

    let tableTop = 742
    if (firstPage) {
      text(42, 744, 15, quotation.title, true)
      text(42, 722, 9, `Quotation: ${quotation.quotation_number}`, true)
      text(305, 722, 9, `Created: ${date.format(new Date(quotation.created_at))}`)
      text(42, 706, 9, `Customer: ${data.customerName}`, true)
      text(305, 706, 9, `Capacity: ${number(data.capacityKw || 0)} kW`)
      if (data.companyName) text(42, 690, 9, `Company: ${shortText(data.companyName, 42)}`)
      if (data.phone || data.email) text(305, 690, 9, shortText([data.phone, data.email].filter(Boolean).join(' | '), 42))
      if (data.address || data.siteAddress) text(42, 674, 9, `Site: ${shortText(data.siteAddress || data.address || '', 86)}`)
      if (quotation.valid_until) text(305, 658, 9, `Valid until: ${date.format(new Date(quotation.valid_until))}`)
      tableTop = 630
    }

    const left = 42
    const widths = [260, 52, 74, 55, 70]
    const totalWidth = widths.reduce((sum, value) => sum + value, 0)
    rect(left, tableTop, totalWidth, 24, 0.94)
    const headers = ['Description', 'Qty', 'Rate', 'Tax', 'Amount']
    let x = left
    headers.forEach((header, index) => {
      text(x + 6, tableTop + 8, 8, header, true)
      x += widths[index]
      if (index < widths.length - 1) line(x, tableTop, x, tableTop + 24)
    })

    let y = tableTop - 24
    pageLines.forEach((item) => {
      rect(left, y, totalWidth, 24)
      const values = [
        shortText(item.description, 48),
        `${number(item.quantity)} ${shortText(item.unit, 8)}`,
        `INR ${number(item.unit_price)}`,
        `${number(item.tax_rate)}%`,
        `INR ${number(item.line_total)}`,
      ]
      let cellX = left
      values.forEach((value, index) => {
        text(cellX + 6, y + 8, index === 0 ? 7.8 : 7.3, value, index === 4)
        cellX += widths[index]
        if (index < widths.length - 1) line(cellX, y, cellX, y + 24)
      })
      y -= 24
    })

    if (finalPage) {
      const totalsY = Math.max(108, y - 18)
      text(350, totalsY + 42, 9, 'Subtotal')
      text(465, totalsY + 42, 9, `INR ${number(quotation.subtotal)}`, true)
      text(350, totalsY + 26, 9, 'Tax')
      text(465, totalsY + 26, 9, `INR ${number(quotation.tax_total)}`, true)
      line(350, totalsY + 18, 553, totalsY + 18)
      text(350, totalsY, 11, 'Grand total', true)
      text(465, totalsY, 11, `INR ${number(quotation.grand_total)}`, true)
      if (quotation.approved_at) text(42, totalsY, 8, `Approved: ${date.format(new Date(quotation.approved_at))}`)
      if (data.agentName) text(42, totalsY - 14, 8, `Agent: ${shortText(data.agentName, 55)}`)
      if (data.notes) text(42, totalsY - 28, 7.5, `Note: ${shortText(data.notes, 78)}`)
    }

    text(42, 28, 7.5, 'Computer-generated quotation. Approval is controlled by the ERP workflow.')
    text(514, 28, 7.5, `${pageIndex + 1}/${chunks.length}`)
    return commands.join('\n')
  })

  const objects: string[] = []
  const pageIds = pageStreams.map((_, index) => 6 + (index * 2))
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  pageStreams.forEach((stream, index) => {
    const contentId = 5 + (index * 2)
    const pageId = contentId + 1
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
  })

  let pdf = '%PDF-1.4\n%ERPQ\n'
  const offsets = [0]
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return pdf
}

export function downloadQuotationPdf(data: QuotationDocumentData) {
  if (data.quotation.status !== 'approved') return false
  const blob = new Blob([buildPdf(data)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = quotationFileName(data.quotation.quotation_number)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
