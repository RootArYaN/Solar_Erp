import { Download, FileCheck2, FileText, LoaderCircle, Save, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'
import { downloadStoredFile, getStoredFiles, removeStoredFile, uploadStoredFile } from '../../api/files'
import { finalizeGeneratedDocumentPack, getDocumentTemplate, getGeneratedDocumentPacks, saveDocumentTemplate, saveGeneratedDocumentPack } from '../../api/operations'
import type { Customer, CustomerFlowSnapshot } from '../../contracts/domain-contracts'
import type { DocumentTemplate, GeneratedDocumentPack } from '../../erp-types'
import { getModuleAccess, hasPermission, PERMISSIONS } from '../../lib/permissions'
import { createCustomerFlowRepository } from '../../lib/repositories/customer-flow-repository'
import { createDocumentPackPdf, documentPackFilePrefix, type DocumentPackInput } from '../../lib/document-pack'
import type { Session, StoredFile } from '../../types'
import { Modal } from '../admin/Modal'
import { GeneratedDocumentPackPanel } from './GeneratedDocumentPack'
import { AlertDialog } from '../ui/AlertDialog'
import { EmptyState, ErrorState, LoadingSkeleton } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, WorkspacePage } from '../workspace'

const documentTypes = [
  ['aadhaar', 'Aadhaar card'], ['pan', 'PAN card'], ['photo', 'Passport-size photo'], ['electricity_bill', 'Electricity bill'], ['cancelled_cheque', 'Cancelled cheque'], ['bank_passbook', 'Bank passbook'], ['ownership_proof', 'Property ownership proof'], ['site_photo', 'Site photographs'], ['customer_signature', 'Customer signature'], ['loan_document', 'Loan documents'], ['discom_document', 'DISCOM documents'], ['installation_photo', 'Installation photographs'], ['dcr_document', 'DCR documents'], ['subsidy_document', 'Subsidy documents'], ['sales_bill', 'Sales bill'], ['completion_document', 'Completion document'],
] as const
type DocumentTypeKey = (typeof documentTypes)[number][0]

const documentFileAliases: Record<DocumentTypeKey, readonly string[]> = {
  aadhaar: ['aadhaar', 'aadhar', 'adhar'],
  pan: ['pan card', 'pan'],
  photo: ['passport size photo', 'passport photo'],
  electricity_bill: ['electricity bill', 'power bill'],
  cancelled_cheque: ['cancelled cheque', 'canceled cheque'],
  bank_passbook: ['bank passbook', 'passbook'],
  ownership_proof: ['property ownership proof', 'ownership proof'],
  site_photo: ['site photographs', 'site photograph', 'site photos', 'site photo'],
  customer_signature: ['customer signature', 'signature'],
  loan_document: ['loan documents', 'loan document'],
  discom_document: ['discom documents', 'discom document'],
  installation_photo: ['installation photographs', 'installation photograph', 'installation photos', 'installation photo'],
  dcr_document: ['dcr documents', 'dcr document'],
  subsidy_document: ['subsidy documents', 'subsidy document'],
  sales_bill: ['sales bill'],
  completion_document: ['completion document'],
}

function normalizeDocumentText(value: string) {
  return value.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function matchesDocumentType(file: StoredFile, key: DocumentTypeKey) {
  const searchable = `${normalizeDocumentText(file.name)} ${normalizeDocumentText(file.owner_type)}`
  return documentFileAliases[key].some((alias) => {
    const normalizedAlias = normalizeDocumentText(alias)
    return searchable === normalizedAlias || searchable.startsWith(`${normalizedAlias} `) || searchable.includes(` ${normalizedAlias} `) || searchable.endsWith(` ${normalizedAlias}`)
  })
}

const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function settingsFrom(template: DocumentTemplate | null) {
  const source = template?.settings ?? {}
  return {
    company_name: String(source.company_name ?? ''), brand_name: String(source.brand_name ?? ''), address: String(source.address ?? ''), gstin: String(source.gstin ?? ''), phone: String(source.phone ?? ''), email: String(source.email ?? ''), bank_details: String(source.bank_details ?? ''), quotation_notes: String(source.quotation_notes ?? ''), agreement_wording: String(source.agreement_wording ?? ''), footer: String(source.footer ?? ''), terms: String(source.terms ?? ''),
  }
}

export function CustomerDataUploadPage({ session }: { session: Session }) {
  const repository = useMemo(() => createCustomerFlowRepository(session.access_token), [session.access_token])
  const [searchParams] = useSearchParams()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [files, setFiles] = useState<StoredFile[]>([])
  const [template, setTemplate] = useState<DocumentTemplate | null>(null)
  const [packs, setPacks] = useState<GeneratedDocumentPack[]>([])
  const [selectedPack, setSelectedPack] = useState<GeneratedDocumentPack | null>(null)
  const [packFiles, setPackFiles] = useState<StoredFile[]>([])
  const [modal, setModal] = useState<'upload' | 'template' | null>(null)
  const [uploadType, setUploadType] = useState<DocumentTypeKey>('aadhaar')
  const [fileToRemove, setFileToRemove] = useState<StoredFile | null>(null)
  const [working, setWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'documents')
  const canManageTemplate = hasPermission(session, PERMISSIONS.documents.manage)
  const { toast } = useToast()

  const loadCustomer = useCallback(async (customerId: string) => {
    if (!customerId) { setSnapshot(null); setFiles([]); setPacks([]); setSelectedPack(null); setPackFiles([]); return }
    const next = await repository.getSnapshot(customerId)
    setSnapshot(next)
    const [stored, generatedPacks] = await Promise.all([
      getStoredFiles('customer_document', customerId),
      next.project ? getGeneratedDocumentPacks(customerId) : Promise.resolve([]),
    ])
    setFiles(stored.data)
    setPacks(generatedPacks)
    const latestPack = generatedPacks[0] ?? null
    setSelectedPack(latestPack)
    setPackFiles(latestPack ? (await getStoredFiles('generated_document_pack', latestPack.id)).data : [])
  }, [repository])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [list, nextTemplate] = await Promise.all([repository.listCustomers(), getDocumentTemplate('customer_pack')])
      setCustomers(list.items); setTemplate(nextTemplate)
      const requestedId = searchParams.get('customer') || ''
      const customerId = selectedId || (list.items.some((item) => item.id === requestedId) ? requestedId : '') || list.items[0]?.id || ''
      setSelectedId(customerId)
      if (customerId) await loadCustomer(customerId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load customer documents') }
    finally { setLoading(false) }
  }, [loadCustomer, repository, searchParams, selectedId])

  useEffect(() => { void load() }, []) // load once; selection changes are handled separately

  async function select(customerId: string) {
    setSelectedId(customerId); setLoading(true)
    try { await loadCustomer(customerId) } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not load customer', variant: 'error' }) }
    finally { setLoading(false) }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!snapshot) return
    const form = event.currentTarget; const values = new FormData(form); const file = values.get('file')
    if (!(file instanceof File) || !file.size) return
    setWorking(true)
    try {
      const requestedType = String(values.get('document_type') || uploadType)
      const type = (documentTypes.some(([key]) => key === requestedType) ? requestedType : uploadType) as DocumentTypeKey
      const previousFile = files.find((stored) => stored.status === 'active' && matchesDocumentType(stored, type))
      await uploadStoredFile({ file, ownerType: `customer_document:${type}`, ownerId: snapshot.customer.id, customerId: snapshot.customer.id, projectId: snapshot.project?.id })
      if (previousFile && access.canArchive) await removeStoredFile(previousFile.id)
      setModal(null); await loadCustomer(snapshot.customer.id); toast({ message: `${documentTypes.find(([value]) => value === type)?.[1] ?? 'Document'} uploaded`, variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not upload document', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function removeFile() {
    if (!fileToRemove || !snapshot) return
    setWorking(true)
    try {
      await removeStoredFile(fileToRemove.id)
      setFileToRemove(null)
      await loadCustomer(snapshot.customer.id)
      toast({ message: 'Document removed', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not remove document', variant: 'error' })
    } finally { setWorking(false) }
  }

  function openUpload(type: DocumentTypeKey) {
    setUploadType(type)
    setModal('upload')
  }

  async function selectPack(pack: GeneratedDocumentPack) {
    setSelectedPack(pack)
    try { setPackFiles((await getStoredFiles('generated_document_pack', pack.id)).data) }
    catch { setPackFiles([]) }
  }

  async function savePack(input: DocumentPackInput, status: 'draft' | 'generated') {
    if (!snapshot?.project) return null
    setWorking(true)
    try {
      const pack = await saveGeneratedDocumentPack(snapshot.customer.id, { input_snapshot: input, status })
      if (status === 'generated') {
        const settings = settingsFrom(template)
        const blob = await createDocumentPackPdf(input, settings, 'all')
        const fileName = `${documentPackFilePrefix(input, pack.version)}_Merged_Document_Pack.pdf`
        await uploadStoredFile({
          file: new File([blob], fileName, { type: 'application/pdf' }),
          ownerType: 'generated_document_pack',
          ownerId: pack.id,
          customerId: snapshot.customer.id,
          projectId: snapshot.project.id,
        })
      }
      const nextPacks = await getGeneratedDocumentPacks(snapshot.customer.id)
      setPacks(nextPacks)
      const nextSelected = nextPacks.find((row) => row.id === pack.id) ?? nextPacks[0] ?? pack
      setSelectedPack(nextSelected)
      setPackFiles((await getStoredFiles('generated_document_pack', nextSelected.id)).data)
      toast({ message: status === 'generated' ? `Document pack v${pack.version} generated and stored` : 'Document pack draft saved', variant: 'success' })
      return pack
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not save document pack', variant: 'error' })
      return null
    } finally { setWorking(false) }
  }

  async function finalizePack(pack: GeneratedDocumentPack) {
    setWorking(true)
    try {
      const finalized = await finalizeGeneratedDocumentPack(pack.id)
      const next = packs.map((row) => row.id === finalized.id ? finalized : row)
      setPacks(next); setSelectedPack(finalized)
      setPackFiles((await getStoredFiles('generated_document_pack', finalized.id)).data)
      toast({ message: `Document pack v${finalized.version} finalized`, variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not finalize document pack', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true)
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries())
      setTemplate(await saveDocumentTemplate('customer_pack', { name: String(values.name || 'Company Document Template'), settings: Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'name')) }))
      setModal(null); toast({ message: 'Shared company document template saved', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not save template', variant: 'error' }) }
    finally { setWorking(false) }
  }

  if (loading && !customers.length) return <WorkspacePage className="erp-page document-page"><LoadingSkeleton rows={7} /></WorkspacePage>
  if (error && !customers.length) return <WorkspacePage className="erp-page document-page"><ErrorState message={error} onRetry={() => void load()} /></WorkspacePage>

  const customer = snapshot?.customer
  const project = snapshot?.project
  const templateSettings = settingsFrom(template)
  const activeFiles = files.filter((file) => file.status === 'active')
  const checklistEntries = documentTypes.map(([key, label]) => {
    const file = activeFiles.find((candidate) => matchesDocumentType(candidate, key))
    return { key, label, file }
  })

  function fileActions(key: DocumentTypeKey, label: string, file?: StoredFile) {
    return <div className="document-checklist__actions">
      <button type="button" onClick={() => openUpload(key)} disabled={!access.canCreate} aria-label={`${file ? 'Re-upload' : 'Upload'} ${label}`} title={`${file ? 'Re-upload' : 'Upload'} ${label}`}>
        <Upload size={14} />
      </button>
      <button type="button" onClick={() => file && void downloadStoredFile(file.id, file.name)} disabled={!file} aria-label={`Download ${label}`} title={file ? `Download ${file.name}` : `${label} has not been uploaded`}>
        <Download size={14} />
      </button>
      <button type="button" className="document-checklist__remove" onClick={() => file && setFileToRemove(file)} disabled={!file || !access.canArchive} aria-label={`Remove ${label}`} title={file ? `Remove ${file.name}` : `${label} has not been uploaded`}>
        <X size={15} />
      </button>
    </div>
  }

  return <WorkspacePage className="erp-page document-page">
    <KpiGrid columns={snapshot ? 5 : 1} className="erp-kpi-grid document-kpi-grid">
      <article className="document-customer-kpi">
        <label><span>Customer</span><select value={selectedId} onChange={(event) => void select(event.target.value)}><option value="">Select customer</option>{customers.map((row) => <option key={row.id} value={row.id}>{row.display_name} · {row.record_number}</option>)}</select></label>
        <small>{customer ? `${customer.consumer_number || 'No consumer number'} · ${project?.record_number || 'No active project'}` : 'Choose a customer workspace'}</small>
      </article>
      {snapshot && <>
        <article><FileText /><span>Customer</span><strong>{customer?.display_name}</strong><small>{customer?.customer_type} · {customer?.electricity_provider || 'DISCOM not set'}</small></article>
        <article><FileCheck2 /><span>Documents</span><strong>{activeFiles.length}</strong><small>Uploaded customer files</small></article>
        <article><FileText /><span>Project</span><strong>{project?.record_number || 'Not created'}</strong><small>{project ? `${project.capacity_kw} kW · ${project.payment_mode || 'Payment mode pending'}` : 'Quotation approval creates project'}</small></article>
        <article><FileText /><span>Status</span><strong>{project?.documentation_status.replaceAll('_', ' ') || 'Customer registered'}</strong><small>{project?.registration_status.replaceAll('_', ' ') || 'Registration pending'}</small></article>
      </>}
    </KpiGrid>

    {!snapshot ? <div className="document-page__body document-empty-surface"><EmptyState title="Select a customer" message="The document checklist and customer data pack will appear here." /></div> : <>
      <div className="document-page__body document-scroll-body">

      {project ? <GeneratedDocumentPackPanel
        snapshot={snapshot}
        template={template}
        packs={packs}
        selectedPack={selectedPack}
        agentName={session.user.full_name}
        canEdit={access.canCreate || access.canEdit}
        canApprove={access.canApprove}
        working={working}
        onSelectPack={(pack) => void selectPack(pack)}
        onSave={savePack}
        onFinalize={finalizePack}
      /> : <section className="erp-panel generated-pack-gate"><FileText size={20} /><div><strong>Document generator unlocks after approval</strong><span>The approved quotation must create a project before the agent can generate the customer pack.</span></div></section>}

      {selectedPack && packFiles.length > 0 && <section className="erp-panel generated-pack-files"><header><div><span>Official stored output</span><h2>Generated files · v{selectedPack.version}</h2></div></header><div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>File</th><th>Size</th><th>Stored</th><th /></tr></thead><tbody>{packFiles.map((file) => <tr key={file.id}><td><strong>{file.name}</strong><small>{selectedPack.status.replaceAll('_', ' ')}</small></td><td>{Math.max(1, Math.round(file.size_bytes / 1024))} KB</td><td>{shortDate.format(new Date(file.created_at))}</td><td><button className="secondary-button secondary-button--compact" onClick={() => void downloadStoredFile(file.id, file.name)}><Download size={14} /> Download stored PDF</button></td></tr>)}</tbody></table></div></section>}

      <div className="erp-two-column document-workspace-grid"><section className="erp-panel document-data-pack"><header><div><span>Auto-filled information</span><h2>Customer data pack</h2></div></header><dl className="erp-detail-grid document-data-grid"><div><dt>Customer name</dt><dd>{customer?.display_name}</dd></div><div><dt>Phone</dt><dd>{customer?.contacts[0]?.phone || '—'}</dd></div><div><dt>Consumer number</dt><dd>{customer?.consumer_number || '—'}</dd></div><div><dt>Electricity provider</dt><dd>{customer?.electricity_provider || '—'}</dd></div><div className="document-data-grid__wide"><dt>Site address</dt><dd>{customer?.site_address || customer?.addresses[0]?.line_1 || '—'}</dd></div><div><dt>System capacity</dt><dd>{project ? `${project.capacity_kw} kW` : '—'}</dd></div><div><dt>Approved value</dt><dd>{project ? money.format(Number(project.approved_value || 0)) : '—'}</dd></div><div><dt>Payment mode</dt><dd>{project?.payment_mode || 'Pending'}</dd></div><div><dt>Assigned agent</dt><dd>{customer?.assigned_agent_id ? 'Assigned' : 'Not assigned'}</dd></div></dl><div className="document-template-preview"><strong>{templateSettings.company_name || session.company.name}</strong><span>{templateSettings.address || 'Company address not configured'}</span><small>{templateSettings.gstin ? `GSTIN ${templateSettings.gstin}` : 'GSTIN not configured'}</small></div></section>

      <section className="erp-panel document-checklist-panel">
        <header><div><span>Required files</span><h2>Document checklist</h2></div></header>
        <div className="document-checklist">
          {checklistEntries.map(({ key, label, file }) => {
            return <article key={key}>
              <span className={`document-check ${file ? 'is-done' : ''}`}><FileCheck2 size={15} /></span>
              <div className="document-checklist__copy">
                <strong>{label}</strong>
                <small title={file?.name}>{file ? `Uploaded ${shortDate.format(new Date(file.created_at))} · ${file.name}` : 'Pending upload'}</small>
              </div>
              {fileActions(key, label, file)}
            </article>
          })}
        </div>
      </section></div>
      </div>
    </>}

    {modal === 'upload' && snapshot && <Modal title="Upload customer document" subtitle={`${snapshot.customer.display_name}${snapshot.project ? ` · ${snapshot.project.record_number}` : ''}`} onClose={() => setModal(null)}><form className="erp-form" onSubmit={upload}><div className="erp-form-grid"><label><span>Document type</span><select name="document_type" defaultValue={uploadType}>{documentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="erp-form-wide"><span>File</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>{working && <LoaderCircle className="spin" size={14} />} Upload</button></footer></form></Modal>}

    {modal === 'template' && template && <Modal title="Company document template" subtitle="Shared across authorized users and generated customer documents." onClose={() => setModal(null)}><form className="erp-form" onSubmit={saveTemplate}><div className="erp-form-grid"><label><span>Template name</span><input name="name" defaultValue={template.name} /></label><label><span>Company name</span><input name="company_name" defaultValue={templateSettings.company_name} /></label><label><span>Brand name</span><input name="brand_name" defaultValue={templateSettings.brand_name} /></label><label><span>GSTIN</span><input name="gstin" defaultValue={templateSettings.gstin} /></label><label><span>Phone</span><input name="phone" defaultValue={templateSettings.phone} /></label><label><span>Email</span><input name="email" defaultValue={templateSettings.email} /></label><label className="erp-form-wide"><span>Address</span><textarea name="address" defaultValue={templateSettings.address} /></label><label className="erp-form-wide"><span>Bank details</span><textarea name="bank_details" defaultValue={templateSettings.bank_details} /></label><label className="erp-form-wide"><span>Quotation notes</span><textarea name="quotation_notes" defaultValue={templateSettings.quotation_notes} /></label><label className="erp-form-wide"><span>Agreement wording</span><textarea name="agreement_wording" defaultValue={templateSettings.agreement_wording} /></label><label className="erp-form-wide"><span>Terms</span><textarea name="terms" defaultValue={templateSettings.terms} /></label><label className="erp-form-wide"><span>Footer</span><input name="footer" defaultValue={templateSettings.footer} /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}><Save size={14} /> Save template</button></footer></form></Modal>}
    <AlertDialog open={Boolean(fileToRemove)} title="Remove this document?" description={fileToRemove ? `${fileToRemove.name} will be removed from the customer checklist.` : undefined} confirmLabel="Remove document" icon="delete" loading={working} onCancel={() => setFileToRemove(null)} onConfirm={removeFile} />
  </WorkspacePage>
}
