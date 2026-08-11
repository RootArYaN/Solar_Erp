import type { InventoryMovement } from '../erp-types'
import {
  buildPdfBlobFromStreams,
  DocumentPackPdfLayout,
  PDF_CONTENT_WIDTH,
  type PdfCell,
} from './document-pack/pdf'
import { defaultDocumentPackTemplate } from './document-pack/template'
import type { DocumentPackInput, DocumentPackTemplate } from './document-pack/types'

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

function displayDate(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed)
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
    projectNumber: '',
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
    brand_name: companyName || 'Shree Enterprise',
    footer: 'Inventory challan · System generated',
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
  const routes = rows.map((row) => `${place(row, 'source')} → ${place(row, 'destination')}`)
  const sharedRoute = routes.every((route) => route === routes[0])

  layout.beginDocument('Inventory Challan', `${movementLabel.toUpperCase()} · ${first.reference_number}`)
  const detailRows: PdfCell[][] = [
    [
      { text: 'Challan', bold: true, fill: '#eef3f8' },
      { text: first.reference_number },
      { text: 'Date', bold: true, fill: '#eef3f8' },
      { text: displayDate(first.challan_date || first.created_at) },
    ],
    [
      { text: 'Movement', bold: true, fill: '#eef3f8' },
      { text: movementLabel },
      { text: 'Party', bold: true, fill: '#eef3f8' },
      { text: first.partner_name || first.customer_name || '-' },
    ],
  ]
  if (sharedRoute) {
    detailRows.push([
      { text: 'From', bold: true, fill: '#eef3f8' },
      { text: place(first, 'source') },
      { text: 'To', bold: true, fill: '#eef3f8' },
      { text: place(first, 'destination') },
    ])
  }
  layout.table(null, detailRows, [64, 170, 54, PDF_CONTENT_WIDTH - 288], { fontSize: 7.4, padding: 3.4 })

  const itemHeaders: PdfCell[] = sharedRoute
    ? [{ text: '#' }, { text: 'Item / SKU' }, { text: 'Quantity' }]
    : [{ text: '#' }, { text: 'Item / SKU' }, { text: 'Route' }, { text: 'Quantity' }]
  const itemRows = rows.map((row, index) => {
    const common: PdfCell[] = [
      { text: String(index + 1), align: 'center' },
      { text: `${row.item_name}${row.item_sku ? ` · ${row.item_sku}` : ''}` },
    ]
    if (!sharedRoute) common.push({ text: `${place(row, 'source')} → ${place(row, 'destination')}` })
    common.push({ text: `${number.format(row.quantity)}${row.item_unit ? ` ${row.item_unit}` : ''}`, bold: true, align: 'right' })
    return common
  })
  layout.table(
    itemHeaders,
    itemRows,
    sharedRoute ? [24, 380, PDF_CONTENT_WIDTH - 404] : [24, 205, 205, PDF_CONTENT_WIDTH - 434],
    { fontSize: 7, headerFontSize: 7, padding: 3.1 },
  )

  const transport = [
    first.transporter_name && `Transporter: ${first.transporter_name}`,
    first.vehicle_number && `Vehicle: ${first.vehicle_number}`,
    first.driver_name && `Driver: ${[first.driver_name, first.driver_phone].filter(Boolean).join(' · ')}`,
    first.eway_bill_number && `E-way bill: ${first.eway_bill_number}`,
  ].filter(Boolean).join('   |   ')
  if (transport) layout.paragraph(transport, { fontSize: 7.2 })
  if (first.note) layout.paragraph(`Note: ${first.note}`, { fontSize: 7.2 })

  layout.twoBoxes([
    { title: 'Issued by', lines: [[companyName || 'Company', preparedBy].filter(Boolean).join(' · '), 'Signature: ____________________'] },
    { title: 'Received by', lines: [first.partner_name || first.customer_name || 'Receiver', 'Signature: ____________________'] },
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
