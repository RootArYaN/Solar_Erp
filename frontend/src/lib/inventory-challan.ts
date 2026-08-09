import type { InventoryMovement } from '../erp-types'
import {
  buildPdfBlobFromStreams,
  DocumentPackPdfLayout,
  PDF_CONTENT_WIDTH,
} from './document-pack/pdf'
import { defaultDocumentPackTemplate } from './document-pack/template'
import type { DocumentPackInput, DocumentPackTemplate } from './document-pack/types'

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

function displayDate(value: string | null | undefined, includeTime = false) {
  if (!value) return '-'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : (includeTime ? dateTime : date).format(parsed)
}

function place(row: InventoryMovement, side: 'source' | 'destination') {
  return side === 'source'
    ? row.source_location_name || row.source_location_manual || '-'
    : row.destination_location_name || row.destination_location_manual || '-'
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
}

function layoutInput(row: InventoryMovement): DocumentPackInput {
  return {
    customerName: row.partner_name || row.customer_name || '',
    customerNumber: '',
    projectNumber: row.reference_number,
    quotationNumber: '',
    address: '',
    district: '',
    consumerNumber: '',
    customerCategory: '',
    plantCapacity: '',
    quotationAmount: '',
    panelSize: '',
    numberOfPanels: '',
    panelBrand: '',
    inverterBrand: '',
    structureType: '',
    cableBrand: '',
    salesPerson: '',
    agreementDate: row.challan_date || '',
    validityDays: '',
    notes: row.note || '',
  }
}

function layoutTemplate(companyName: string): DocumentPackTemplate {
  return {
    ...defaultDocumentPackTemplate,
    company_name: companyName || 'Shree EnterPrise',
    brand_name: companyName || 'PerfectSolar',
    footer: 'Computer-generated inventory challan.',
  }
}

export function inventoryChallanFileName(referenceNumber: string) {
  return `${safeFilePart(referenceNumber) || 'inventory-challan'}.pdf`
}

export function createInventoryChallanPdf(rows: InventoryMovement[], companyName: string, preparedBy = '') {
  if (!rows.length) return null
  const first = rows[0]
  const layout = new DocumentPackPdfLayout(layoutInput(first), layoutTemplate(companyName))
  const movementLabel = first.movement_type.replaceAll('_', ' ')

  layout.beginDocument('Inventory Challan', `${movementLabel.toUpperCase()} · ${first.reference_number}`)
  layout.section('Challan details')
  layout.kvTable([
    ['Challan number', first.reference_number],
    ['Challan date', displayDate(first.challan_date || first.created_at)],
    ['Movement', movementLabel],
    ['Status', first.status],
    ['From', place(first, 'source')],
    ['To', place(first, 'destination')],
    ['Party / supplier', first.partner_name || first.customer_name || '-'],
    ['Project / customer', [first.project_number, first.customer_name].filter(Boolean).join(' · ') || '-'],
  ])

  layout.section('Items')
  layout.table(
    [{ text: '#' }, { text: 'Item' }, { text: 'From' }, { text: 'To' }, { text: 'Quantity' }],
    rows.map((row, index) => [
      { text: String(index + 1), align: 'center' },
      { text: `${row.item_name}${row.item_sku ? ` (${row.item_sku})` : ''}` },
      { text: place(row, 'source') },
      { text: place(row, 'destination') },
      { text: `${number.format(row.quantity)}${row.item_unit ? ` ${row.item_unit}` : ''}`, bold: true, align: 'right' },
    ]),
    [24, 165, 110, 110, PDF_CONTENT_WIDTH - 409],
    { fontSize: 7.5, padding: 4.5 },
  )
  layout.paragraph(`Total: ${number.format(rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0))} across ${rows.length} ${rows.length === 1 ? 'line' : 'lines'}.`, { bold: true, align: 'right' })

  layout.section('Transport details')
  layout.kvTable([
    ['Transporter', first.transporter_name || '-'],
    ['Vehicle number', first.vehicle_number || '-'],
    ['Driver', [first.driver_name, first.driver_phone].filter(Boolean).join(' · ') || '-'],
    ['E-way bill number', first.eway_bill_number || '-'],
    ['Generated', displayDate(first.created_at, true)],
    ['Prepared by', preparedBy || 'System user'],
  ])
  if (first.note) layout.note(first.note)

  layout.section('Acknowledgement')
  layout.twoBoxes([
    { title: 'Issued by', lines: [companyName || 'Company', 'Name / signature: ____________________'] },
    { title: 'Received by', lines: [first.partner_name || first.customer_name || 'Receiver', 'Name / signature: ____________________'] },
  ])

  return buildPdfBlobFromStreams(layout.finish(), 'ERP-INVENTORY-CHALLAN')
}

export function downloadInventoryChallanPdf(rows: InventoryMovement[], companyName: string, preparedBy = '') {
  const blob = createInventoryChallanPdf(rows, companyName, preparedBy)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = inventoryChallanFileName(rows[0].reference_number)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
