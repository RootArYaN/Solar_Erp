import { Plus, Trash2 } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'
import type { GenerateQuotationInput, QuotationLineInput, QuotationRequestSummary } from '../../types'
import { Modal } from '../admin/Modal'

function newLine(description = ''): QuotationLineInput {
  return { description, quantity: 1, unit: 'Lot', unit_price: 0, tax_rate: 5 }
}

export function QuotationBuilderDialog({ request, busy, onClose, onSubmit }: {
  request: QuotationRequestSummary
  busy: boolean
  onClose: () => void
  onSubmit: (value: GenerateQuotationInput) => Promise<void>
}) {
  const [title, setTitle] = useState(request.quotation?.title || `${request.proposed_capacity_kw} kW solar EPC · ${request.customer_name}`)
  const [validUntil, setValidUntil] = useState(() => {
    if (request.quotation?.valid_until) return request.quotation.valid_until.slice(0, 10)
    const date = new Date(); date.setDate(date.getDate() + 30); return date.toISOString().slice(0, 10)
  })
  const [lines, setLines] = useState<QuotationLineInput[]>(() => request.quotation?.lines.length
    ? request.quotation.lines.map(({ description, quantity, unit, unit_price, tax_rate }) => ({ description, quantity, unit, unit_price, tax_rate }))
    : [
      newLine('Solar modules, inverter and balance of system'),
      { ...newLine('Installation, testing and commissioning'), tax_rate: 18 },
    ])

  const totals = useMemo(() => lines.reduce((result, line) => {
    const base = Number(line.quantity || 0) * Number(line.unit_price || 0)
    return { subtotal: result.subtotal + base, tax: result.tax + base * Number(line.tax_rate || 0) / 100 }
  }, { subtotal: 0, tax: 0 }), [lines])

  function patchLine(index: number, patch: Partial<QuotationLineInput>) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSubmit({ title, valid_until: validUntil ? new Date(`${validUntil}T18:29:59Z`).toISOString() : null, lines })
  }

  return <Modal title={request.quotation ? "Revise quotation" : "Generate quotation"} className="quotation-builder-modal" onClose={onClose}>
    <form className="admin-form quotation-builder" onSubmit={submit}>
      <div className="workflow-customer-strip"><strong>{request.customer_name}</strong><span>{request.agent_name} · {request.proposed_capacity_kw} kW</span></div>
      <div className="admin-form__grid"><label className="field"><span>Quotation title</span><input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label></div>
      <div className="quotation-lines">
        {lines.map((line, index) => <div className="quotation-line" key={index}>
          <input required value={line.description} onChange={(event) => patchLine(index, { description: event.target.value })} placeholder="Line description" />
          <input required min="0.01" step="0.01" type="number" value={line.quantity} onChange={(event) => patchLine(index, { quantity: Number(event.target.value) })} aria-label="Quantity" />
          <input required value={line.unit} onChange={(event) => patchLine(index, { unit: event.target.value })} aria-label="Unit" />
          <input required min="0" step="0.01" type="number" value={line.unit_price} onChange={(event) => patchLine(index, { unit_price: Number(event.target.value) })} aria-label="Unit price" />
          <input required min="0" max="100" step="0.01" type="number" value={line.tax_rate} onChange={(event) => patchLine(index, { tax_rate: Number(event.target.value) })} aria-label="Tax rate" />
          <button type="button" className="icon-button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} disabled={lines.length === 1}><Trash2 size={15} /></button>
        </div>)}
      </div>
      <div className="quotation-builder-footer"><button type="button" className="secondary-button" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={14} /> Add line</button><div><span>Subtotal ₹{totals.subtotal.toLocaleString('en-IN')}</span><span>Tax ₹{totals.tax.toLocaleString('en-IN')}</span><strong>Total ₹{(totals.subtotal + totals.tax).toLocaleString('en-IN')}</strong></div></div>
      <footer className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button primary-button--compact" disabled={busy || lines.some((line) => !line.description.trim() || line.quantity <= 0)}>{busy ? 'Saving…' : 'Save for approval'}</button></footer>
    </form>
  </Modal>
}
