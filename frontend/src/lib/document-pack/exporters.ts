import type { DocumentPackInput, DocumentPackTab, DocumentPackTemplate } from './types'
import { documentTabs } from './template'
import { amount } from './format'
import { documentPackFilePrefix, renderDocumentHtml, renderFullDocumentHtml } from './html'
import type { DocumentPackRenderAssets } from './signature'

export function downloadDocumentWord(input: DocumentPackInput, template: DocumentPackTemplate, selected: Exclude<DocumentPackTab, 'full'>, assets?: DocumentPackRenderAssets) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:11pt;color:#172033}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #ccd4df;padding:6px;text-align:left}h3,h4{color:#1a2e6b}.pack-doc__head,.pack-doc__signatures{display:flex;justify-content:space-between;gap:24px}.pack-doc__head span,.pack-doc__head small,.pack-doc__signatures span,.pack-doc__signatures small{display:block}.pack-doc__signature{width:46%}.pack-doc__signature-image{display:block;width:180px;height:48px;padding-bottom:4px;border-bottom:1px solid #9aa6b4;object-fit:contain;object-position:left center}.pack-doc__signature--vendor strong{display:block;margin-top:3px}.pack-doc__signed-status{margin-top:3px;color:#657488;font-size:8pt}</style></head><body>${renderDocumentHtml(selected, input, template, assets)}</body></html>`
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

export function printDocumentPack(input: DocumentPackInput, template: DocumentPackTemplate, selected: DocumentPackTab, assets?: DocumentPackRenderAssets) {
  const body = selected === 'full' ? renderFullDocumentHtml(input, template, assets) : renderDocumentHtml(selected, input, template, assets)
  const win = window.open('', '_blank', 'width=960,height=760')
  if (!win) return false
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Document Pack</title><style>body{margin:0;background:#eef1f6;font-family:Arial,sans-serif;color:#172033}.pack-doc{box-sizing:border-box;width:210mm;min-height:297mm;margin:10mm auto;padding:16mm;background:#fff;page-break-after:always}.pack-doc__head,.pack-doc__signatures{display:flex;justify-content:space-between;gap:24px}.pack-doc__head>div:last-child{text-align:right}.pack-doc__head span,.pack-doc__head small,.pack-doc__signatures span,.pack-doc__signatures small{display:block;color:#687385;margin-top:4px}.pack-doc__head{padding-bottom:12px;border-bottom:3px solid #e8b424}.pack-doc h3{margin:0;color:#1a2e6b}.pack-doc h4{margin:20px 0 8px;color:#1a2e6b;border-bottom:2px solid #e8b424;padding-bottom:5px}.pack-doc__table,.pack-doc__quote{width:100%;border-collapse:collapse}.pack-doc__table th,.pack-doc__table td,.pack-doc__quote th,.pack-doc__quote td{border:1px solid #dce2ec;padding:7px;text-align:left;font-size:12px}.pack-doc__table th{width:38%;background:#f0f4fb}.pack-doc__quote th{background:#1a2e6b;color:#fff}.pack-doc__quote .is-total td{font-weight:bold;background:#f5f7fb}.pack-doc__checks{line-height:1.8}.pack-doc__check-table{width:100%;border-collapse:collapse}.pack-doc__check-table th,.pack-doc__check-table td{border:1px solid #dce2ec;padding:6px;text-align:left;font-size:11px}.pack-doc__check-table th{width:70%;background:#f0f4fb}.pack-doc__two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pack-doc__two section{border:1px solid #dce2ec;padding:10px}.pack-doc__pre{white-space:pre-line}.pack-doc__subtitle{text-align:right;color:#687385;font-size:11px}.pack-doc__checks .is-approved{font-weight:bold;color:#1e6b3a}.pack-doc__note{padding:10px;background:#fff8e6;border-left:3px solid #e8b424}.pack-doc__signatures{margin-top:35px;padding-top:15px;border-top:1px solid #ccd4df}.pack-doc__signature{width:46%}.pack-doc__signature-image{display:block;width:180px;height:48px;padding-bottom:4px;border-bottom:1px solid #9aa6b4;object-fit:contain;object-position:left center}.pack-doc__signed-status{margin-top:3px;color:#657488;font-size:8pt}.pack-doc footer{margin-top:35px;padding-top:8px;border-top:1px solid #dce2ec;color:#7b8491;font-size:10px}@media print{body{background:#fff}.pack-doc{margin:0;box-shadow:none}@page{size:A4;margin:0}}</style></head><body>${body}</body></html>`)
  win.document.close()
  win.onload = () => window.setTimeout(() => win.print(), 250)
  return true
}
