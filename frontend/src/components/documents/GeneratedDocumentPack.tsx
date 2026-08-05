import {
  CheckCircle2,
  Download,
  Eye,
  Files,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Printer,
  Save,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { CustomerFlowSnapshot } from '../../contracts/domain-contracts'
import type { DocumentTemplate, GeneratedDocumentPack } from '../../erp-types'
import type { StoredFile } from '../../types'
import { downloadStoredFile } from '../../api/files'
import { downloadMergedDocumentPack } from '../../api/operations'
import {
  documentTabs,
  downloadDocumentWord,
  downloadQuotationCsv,
  printDocumentPack,
  renderDocumentHtml,
  renderFullDocumentHtml,
  normalizeDocumentPackTemplate,
  validateDocumentPack,
  type DocumentPackInput,
  type DocumentPackTab,
  type DocumentPackTemplate,
} from '../../lib/document-pack'

function templateSettings(template: DocumentTemplate | null): DocumentPackTemplate {
  return normalizeDocumentPackTemplate(template?.settings)
}

function todayInput() {
  const date = new Date()
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function defaults(snapshot: CustomerFlowSnapshot, pack: GeneratedDocumentPack | null, agentName: string): DocumentPackInput {
  const { customer, project } = snapshot
  const quotation = project ? snapshot.quotations.find((row) => row.id === project.quotation_id) : null
  const existing = pack?.input_snapshot ?? {}
  const capacity = Number(project?.capacity_kw || 0)
  const panelSize = String(existing.panelSize ?? '540')
  const suggestedPanels = capacity > 0 ? Math.ceil((capacity * 1000) / (Number(panelSize) || 540)) : 0
  const base: DocumentPackInput = {
    customerName: customer.display_name,
    customerNumber: customer.record_number,
    projectNumber: project?.record_number || '',
    quotationNumber: quotation?.record_number || '',
    address: customer.site_address || customer.addresses[0]?.line_1 || '',
    district: customer.district || customer.addresses[0]?.district || '',
    consumerNumber: customer.consumer_number || '',
    customerCategory: customer.customer_type,
    plantCapacity: String(project?.capacity_kw || ''),
    quotationAmount: String(project?.approved_value || ''),
    panelSize,
    numberOfPanels: String(existing.numberOfPanels ?? (suggestedPanels || '')),
    panelBrand: '',
    inverterBrand: '',
    structureType: 'Hot Dip GI Structure',
    cableBrand: 'WACAB / Equivalent',
    salesPerson: agentName,
    agreementDate: todayInput(),
    validityDays: '15',
    notes: '',
  }
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, String(existing[key] ?? value)])) as DocumentPackInput
}

function statusLabel(value: GeneratedDocumentPack['status'] | undefined) {
  if (!value) return 'Not saved'
  return value === 'final' ? 'Final and locked' : value === 'generated' ? 'Generated' : 'Draft'
}

function approvedAmount(value: string) {
  if (!value.trim()) return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value || '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

function ApprovedField({ label, value, wide = false, mono = false }: {
  label: string
  value: ReactNode
  wide?: boolean
  mono?: boolean
}) {
  return <div className={`generated-pack-approved-field${wide ? ' is-wide' : ''}`}>
    <span>{label}</span>
    <strong className={mono ? 'is-mono' : ''}>{value || '—'}</strong>
  </div>
}

export function GeneratedDocumentPackPanel({
  snapshot,
  template,
  packs,
  selectedPack,
  agentName,
  canEdit,
  canApprove,
  working,
  packFiles,
  customerSignatureUrl,
  missingRequiredDocuments,
  onSelectPack,
  onSave,
  onFinalize,
}: {
  snapshot: CustomerFlowSnapshot
  template: DocumentTemplate | null
  packs: GeneratedDocumentPack[]
  selectedPack: GeneratedDocumentPack | null
  agentName: string
  canEdit: boolean
  canApprove: boolean
  working: boolean
  packFiles: StoredFile[]
  customerSignatureUrl: string
  missingRequiredDocuments: string[]
  onSelectPack: (pack: GeneratedDocumentPack) => void
  onSave: (input: DocumentPackInput, status: 'draft' | 'generated') => Promise<GeneratedDocumentPack | null>
  onFinalize: (pack: GeneratedDocumentPack) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<DocumentPackTab>('feasibility')
  const [validationError, setValidationError] = useState('')
  const [exportingPdf, setExportingPdf] = useState<'stored' | 'merged' | null>(null)
  const [previewZoom, setPreviewZoom] = useState(0.8)
  const [autoFitPreview, setAutoFitPreview] = useState(true)
  const previewViewportRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState<DocumentPackInput>(() => defaults(snapshot, selectedPack, agentName))
  const settings = useMemo(() => {
    const current = templateSettings(template)
    if (!selectedPack) return current
    return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, String(selectedPack.template_snapshot[key] ?? value)])) as DocumentPackTemplate
  }, [template, selectedPack])
  const locked = selectedPack?.status === 'final'
  const renderAssets = useMemo(() => ({
    customerSignatureUrl,
    vendorSignatureUrl: settings.vendor_signature_image,
  }), [customerSignatureUrl, settings.vendor_signature_image])

  useEffect(() => {
    setInput(defaults(snapshot, selectedPack, agentName))
    setActiveTab('feasibility')
    setValidationError('')
    setAutoFitPreview(true)
  }, [snapshot.customer.id, selectedPack?.id, agentName])

  useEffect(() => {
    const viewport = previewViewportRef.current
    if (!viewport || !autoFitPreview) return

    const fit = () => {
      const availableWidth = Math.max(240, viewport.clientWidth - 24)
      const nextZoom = Math.min(1, Math.max(0.35, availableWidth / 720))
      setPreviewZoom(Number(nextZoom.toFixed(2)))
    }

    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [autoFitPreview])

  function update<K extends keyof DocumentPackInput>(key: K, value: DocumentPackInput[K]) {
    setValidationError('')
    setInput((current) => ({ ...current, [key]: value }))
  }

  async function save(status: 'draft' | 'generated') {
    if (status === 'generated') {
      const missing = validateDocumentPack(input)
      if (missing.length) {
        setValidationError(`Complete ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' and the remaining required fields' : ''}.`)
        return
      }
      if (missingRequiredDocuments.length) {
        setValidationError(`Upload ${missingRequiredDocuments.join(' and ')} before generating the full pack.`)
        return
      }
    }
    setValidationError('')
    await onSave(input, status)
  }

  const preview = activeTab === 'full'
    ? renderFullDocumentHtml(input, settings, renderAssets)
    : renderDocumentHtml(activeTab, input, settings, renderAssets)
  const activeTabLabel = activeTab === 'full'
    ? 'Complete document pack'
    : documentTabs.find((tab) => tab.key === activeTab)?.label || 'Document preview'

  const storedPackFile = packFiles.find((file) => file.mime_type === 'application/pdf')

  async function downloadStoredPack() {
    if (!storedPackFile || exportingPdf) return
    setValidationError('')
    setExportingPdf('stored')
    try {
      await downloadStoredFile(storedPackFile.id, storedPackFile.name)
    } catch (reason) {
      setValidationError(reason instanceof Error ? reason.message : 'Could not download the stored full pack.')
    } finally {
      setExportingPdf(null)
    }
  }

  async function downloadMergedPack() {
    if (!selectedPack || !storedPackFile || exportingPdf) return
    setValidationError('')
    setExportingPdf('merged')
    try {
      await downloadMergedDocumentPack(
        selectedPack.id,
        `${storedPackFile.name.replace(/\.pdf$/i, '')}_With_Attachments.pdf`,
      )
    } catch (reason) {
      setValidationError(reason instanceof Error ? reason.message : 'Could not merge the full pack and customer attachments.')
    } finally {
      setExportingPdf(null)
    }
  }

  function changePreviewZoom(delta: number) {
    setAutoFitPreview(false)
    setPreviewZoom((current) => Math.min(1.15, Math.max(0.5, Number((current + delta).toFixed(2)))))
  }

  return <section className="erp-panel generated-pack-panel">

    <div className="generated-pack-toolbar">
      <div className="generated-pack-actions generated-pack-actions--workflow">
        {canEdit && <button type="button" className="secondary-button" disabled={working} onClick={() => void save('draft')}><Save size={14} /> {locked ? 'New draft' : 'Save draft'}</button>}
        {canEdit && <button type="button" className="primary-button" disabled={working} onClick={() => void save('generated')}>{working ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} {locked ? 'Regenerate full pack' : 'Generate full pack'}</button>}
        {canApprove && selectedPack?.status === 'generated' && <button type="button" className="secondary-button generated-pack-finalize" disabled={working} onClick={() => void onFinalize(selectedPack)}><LockKeyhole size={14} /> Finalize</button>}
      </div>
      <div className="generated-pack-actions generated-pack-actions--exports">
        {packs.length > 0 && <label className="generated-pack-version"><span>Version</span><select value={selectedPack?.id || ''} onChange={(event) => {
          const pack = packs.find((row) => row.id === event.target.value)
          if (pack) onSelectPack(pack)
        }}>{packs.map((pack) => <option key={pack.id} value={pack.id}>v{pack.version} · {statusLabel(pack.status)}</option>)}</select></label>}
        <button type="button" className="secondary-button" disabled={working || exportingPdf !== null || !storedPackFile} onClick={() => void downloadStoredPack()} title={storedPackFile ? `Download the stored full pack for version ${selectedPack?.version}` : 'Generate this version to create its full-pack PDF'}>{exportingPdf === 'stored' ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} {exportingPdf === 'stored' ? 'Downloading' : selectedPack ? `Download v${selectedPack.version}` : 'Download full pack'}</button>
        <button type="button" className="secondary-button" disabled={working || exportingPdf !== null || !storedPackFile} onClick={() => void downloadMergedPack()} title="Download one PDF containing the full pack and all uploaded customer documents">{exportingPdf === 'merged' ? <LoaderCircle className="spin" size={14} /> : <Files size={14} />} {exportingPdf === 'merged' ? 'Merging files' : 'Full pack + attachments'}</button>
        <button type="button" className="secondary-button" onClick={() => printDocumentPack(input, settings, activeTab, renderAssets)}><Printer size={14} /> Print</button>
        {activeTab !== 'full' && activeTab !== 'quotation' && <button type="button" className="secondary-button" onClick={() => downloadDocumentWord(input, settings, activeTab, renderAssets)}><FileText size={14} /> Word</button>}
        {activeTab === 'quotation' && <button type="button" className="secondary-button" onClick={() => downloadQuotationCsv(input)}><FileSpreadsheet size={14} /> Excel CSV</button>}
      </div>
    </div>

    {locked && <div className="generated-pack-lock"><CheckCircle2 size={16} /><span>This final version remains immutable. Editing and saving creates a new version without changing this record.</span></div>}
    {validationError && <div className="generated-pack-validation"><span>{validationError}</span></div>}

    <div className="generated-pack-workspace">
      <div className="generated-pack-form">
        <div className="generated-pack-approved-grid">
          <ApprovedField label="Customer name" value={input.customerName} />
          <ApprovedField label="Customer number" value={input.customerNumber} mono />
          <ApprovedField label="Project number" value={input.projectNumber} mono />
          <ApprovedField label="Quotation number" value={input.quotationNumber} mono />
          <ApprovedField label="Approved capacity" value={`${input.plantCapacity || '—'} kW`} />
          <ApprovedField label="Approved amount" value={approvedAmount(input.quotationAmount)} />
          <ApprovedField label="Installation address" value={input.address} wide />
          <ApprovedField label="Consumer number" value={input.consumerNumber} mono />
          <ApprovedField label="Customer category" value={input.customerCategory} />
        </div>

        <div className="generated-pack-form__section generated-pack-form__section--agent">
          <div><strong>Agent completion fields</strong></div>
          <span className="generated-pack-section-badge generated-pack-section-badge--required">Required</span>
        </div>
        <div className="generated-pack-fields erp-form-grid">
          <label><span>District</span><input value={input.district} placeholder="Installation district" onChange={(event) => update('district', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Panel wattage <small>WP</small></span><input type="number" inputMode="numeric" min="1" value={input.panelSize} onChange={(event) => update('panelSize', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Number of panels</span><input type="number" inputMode="numeric" min="1" value={input.numberOfPanels} onChange={(event) => update('numberOfPanels', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Panel brand</span><input value={input.panelBrand} placeholder="e.g. Adani Solar" onChange={(event) => update('panelBrand', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Inverter brand</span><input value={input.inverterBrand} placeholder="e.g. Solis" onChange={(event) => update('inverterBrand', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Structure</span><input value={input.structureType} onChange={(event) => update('structureType', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>AC &amp; DC cable</span><input value={input.cableBrand} onChange={(event) => update('cableBrand', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Sales person</span><input value={input.salesPerson} onChange={(event) => update('salesPerson', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Agreement date</span><input type="date" value={input.agreementDate} onChange={(event) => update('agreementDate', event.target.value)} readOnly={!canEdit} /></label>
          <label><span>Estimate validity <small>days</small></span><input type="number" inputMode="numeric" min="1" value={input.validityDays} onChange={(event) => update('validityDays', event.target.value)} readOnly={!canEdit} /></label>
          <label className="erp-form-wide"><span>Document note <small>optional</small></span><textarea value={input.notes} placeholder="Add a note shown in the quotation or document pack." onChange={(event) => update('notes', event.target.value)} readOnly={!canEdit} /></label>
        </div>
      </div>

      <div className="generated-pack-preview">
        <header className="generated-pack-preview__head">
          <div><span><Eye size={13} /> Live preview</span><strong>{activeTabLabel}</strong></div>
          <div className="generated-pack-zoom" aria-label="Preview zoom controls">
            <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => changePreviewZoom(-0.1)}><ZoomOut size={14} /></button>
            <span>{Math.round(previewZoom * 100)}%</span>
            <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => changePreviewZoom(0.1)}><ZoomIn size={14} /></button>
            <button type="button" className={autoFitPreview ? 'is-active' : ''} onClick={() => setAutoFitPreview(true)}>Fit</button>
          </div>
        </header>
        <nav className="generated-pack-tabs" aria-label="Document preview tabs">
          {documentTabs.map((tab) => <button type="button" key={tab.key} className={activeTab === tab.key ? 'is-active' : ''} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>)}
          <button type="button" className={activeTab === 'full' ? 'is-active' : ''} onClick={() => setActiveTab('full')}>Full pack</button>
        </nav>
        <div ref={previewViewportRef} className={`generated-pack-preview__scroll ${activeTab === 'full' ? 'is-full' : ''}`}>
          <div
            className="generated-pack-preview__canvas"
            style={{ '--generated-pack-zoom': previewZoom } as CSSProperties}
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </div>
      </div>
    </div>
  </section>
}
