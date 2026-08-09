import { CheckCircle2, Download, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  downloadQuotationPdf,
  formatQuotationMoney,
  type QuotationDocumentData,
} from '../../lib/quotation-document'
import { loadCustomerSignature, type PdfSignatureImage } from '../../lib/document-pack'
import { Modal } from '../admin/Modal'

const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function QuotationPreviewDialog({
  quotation,
  customerName,
  companyName = '',
  phone = '',
  email = '',
  address = '',
  siteAddress = '',
  capacityKw,
  notes = '',
  agentName = '',
  customerId = '',
  onClose,
}: QuotationDocumentData & { onClose: () => void }) {
  const [customerSignature, setCustomerSignature] = useState<{ dataUrl: string; pdf: PdfSignatureImage } | null>(null)
  const [signatureLoading, setSignatureLoading] = useState(false)
  const approved = quotation.status === 'approved'
  const canDownload = approved && Boolean(customerSignature)
  const displayLines = quotation.lines.length > 0 ? quotation.lines : [{
    description: quotation.title,
    quantity: 1,
    unit: 'Lot',
    unit_price: quotation.subtotal,
    tax_rate: quotation.subtotal > 0 ? (quotation.tax_total / quotation.subtotal) * 100 : 0,
    line_total: quotation.grand_total,
  }]

  useEffect(() => {
    let active = true
    setCustomerSignature(null)
    if (!approved || !customerId) return () => { active = false }
    setSignatureLoading(true)
    void loadCustomerSignature(customerId).then((loaded) => {
      if (!loaded) return
      if (active) setCustomerSignature({ dataUrl: loaded.dataUrl, pdf: loaded.pdf })
    }).catch(() => {
      if (active) setCustomerSignature(null)
    }).finally(() => {
      if (active) setSignatureLoading(false)
    })
    return () => {
      active = false
    }
  }, [approved, customerId])

  function download() {
    if (!customerSignature) return
    void downloadQuotationPdf({ quotation, customerName, companyName, phone, email, address, siteAddress, capacityKw, notes, agentName, customerId, customerSignature: customerSignature.pdf })
  }

  return <Modal
    title="Quotation preview"
    subtitle={`${quotation.quotation_number} · ${statusLabel(quotation.status)}`}
    className="quotation-preview-modal"
    onClose={onClose}
  >
    <div className="quotation-preview-shell">
      <article className="quotation-document">
        <header className="quotation-document__header">
          <div className="quotation-document__brand">
            <span className="quotation-document__mark"><FileText size={20} /></span>
            <div><strong>Shree Enterprise</strong><small>Perfect Solar Quotation</small></div>
          </div>
          <span className={`quotation-document__status quotation-document__status--${quotation.status}`}>
            {quotation.status === 'approved' && <CheckCircle2 size={14} />}
            {statusLabel(quotation.status)}
          </span>
        </header>

        <div className="quotation-document__meta">
          <section><small>Quotation</small><strong>{quotation.quotation_number}</strong></section>
          <section><small>Created</small><strong>{dateFormatter.format(new Date(quotation.created_at))}</strong></section>
          <section><small>Valid until</small><strong>{quotation.valid_until ? dateFormatter.format(new Date(quotation.valid_until)) : 'Not specified'}</strong></section>
        </div>

        <div className="quotation-document__customer">
          <div><small>Prepared for</small><h3>{customerName}</h3><p>{companyName || 'Individual customer'}</p></div>
          <div className="quotation-document__contact">
            {phone && <span>{phone}</span>}
            {email && <span>{email}</span>}
            {(siteAddress || address) && <span>{siteAddress || address}</span>}
          </div>
        </div>

        <div className="quotation-document__title">
          <div><small>Proposal</small><h2>{quotation.title}</h2></div>
          {capacityKw !== undefined && <strong>{capacityKw} kW</strong>}
        </div>

        <div className="quotation-document__table-wrap">
          <table className="quotation-document__table">
            <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Tax</th><th>Amount</th></tr></thead>
            <tbody>
              {displayLines.map((line, index) => <tr key={`${line.description}-${index}`}>
                <td><strong>{line.description}</strong><small>{line.unit}</small></td>
                <td>{line.quantity}</td>
                <td>{formatQuotationMoney(line.unit_price)}</td>
                <td>{line.tax_rate}%</td>
                <td><strong>{formatQuotationMoney(line.line_total)}</strong></td>
              </tr>)}
            </tbody>
          </table>
        </div>

        <div className="quotation-document__footer">
          <div className="quotation-document__note">
            {notes && <><small>Note</small><p>{notes}</p></>}
            {agentName && <span>Agent: {agentName}</span>}
            {quotation.approved_at && <span>Approved on {dateFormatter.format(new Date(quotation.approved_at))}</span>}
          </div>
          <dl className="quotation-document__totals">
            <div><dt>Subtotal</dt><dd>{formatQuotationMoney(quotation.subtotal)}</dd></div>
            <div><dt>Tax</dt><dd>{formatQuotationMoney(quotation.tax_total)}</dd></div>
            <div><dt>Grand total</dt><dd>{formatQuotationMoney(quotation.grand_total)}</dd></div>
          </dl>
        </div>

        {approved && <div className="quotation-document__signatures">
          <div className="quotation-document__signature quotation-document__signature--customer">
            <small>Customer signature</small>
            {customerSignature
              ? <img className="quotation-document__signature-image" src={customerSignature.dataUrl} alt={`Uploaded signature of ${customerName}`} />
              : <span className="quotation-document__signature-missing">{signatureLoading ? 'Loading uploaded signature…' : 'Upload a customer signature image to enable download.'}</span>}
            <span>Uploaded customer signature</span>
          </div>
          <div className="quotation-document__signature">
            <small>Approved representative</small>
            <strong>{agentName || 'Authorized signatory'}</strong>
            <span>{quotation.approved_at ? `Approved ${dateFormatter.format(new Date(quotation.approved_at))}` : 'Approved through ERP workflow'}</span>
          </div>
        </div>}
      </article>
    </div>

    <footer className="quotation-preview-actions">
      <span>{canDownload ? 'Approved quotation and uploaded signature are ready for download.' : approved ? 'Upload a customer signature image to enable download.' : 'Download unlocks after approval.'}</span>
      <div>
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        {canDownload && <button type="button" className="primary-button primary-button--compact" onClick={download}><Download size={15} /> Download PDF</button>}
      </div>
    </footer>
  </Modal>
}
