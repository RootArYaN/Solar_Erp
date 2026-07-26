import { Archive, Download, FileCheck2, FileText, LoaderCircle, RefreshCw, RotateCcw, Save, Settings2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { downloadStoredFile, getStoredFiles, setStoredFileStatus, uploadStoredFile } from '../../api/files'
import { getDocumentTemplate, saveDocumentTemplate } from '../../api/operations'
import type { Customer, CustomerFlowSnapshot } from '../../contracts/domain-contracts'
import type { DocumentTemplate } from '../../erp-types'
import { getModuleAccess } from '../../lib/permissions'
import { createCustomerFlowRepository } from '../../lib/repositories/customer-flow-repository'
import type { Session, StoredFile } from '../../types'
import { Modal } from '../admin/Modal'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, WorkspaceHeader, WorkspacePage } from '../workspace'

const documentTypes = [
  ['aadhaar', 'Aadhaar card'], ['pan', 'PAN card'], ['photo', 'Passport-size photo'], ['electricity_bill', 'Electricity bill'], ['cancelled_cheque', 'Cancelled cheque'], ['bank_passbook', 'Bank passbook'], ['ownership_proof', 'Property ownership proof'], ['site_photo', 'Site photographs'], ['customer_signature', 'Customer signature'], ['loan_document', 'Loan documents'], ['discom_document', 'DISCOM documents'], ['installation_photo', 'Installation photographs'], ['dcr_document', 'DCR documents'], ['subsidy_document', 'Subsidy documents'], ['sales_bill', 'Sales bill'], ['completion_document', 'Completion document'],
] as const
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
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [files, setFiles] = useState<StoredFile[]>([])
  const [template, setTemplate] = useState<DocumentTemplate | null>(null)
  const [modal, setModal] = useState<'upload' | 'template' | null>(null)
  const [working, setWorking] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'documents')
  const { toast } = useToast()

  const loadCustomer = useCallback(async (customerId: string) => {
    if (!customerId) { setSnapshot(null); setFiles([]); return }
    const next = await repository.getSnapshot(customerId)
    setSnapshot(next)
    const stored = await getStoredFiles('customer_document', customerId)
    setFiles(stored.data)
  }, [repository])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [list, nextTemplate] = await Promise.all([repository.listCustomers(), getDocumentTemplate('customer_pack')])
      setCustomers(list.items); setTemplate(nextTemplate)
      const customerId = selectedId || list.items[0]?.id || ''
      setSelectedId(customerId)
      if (customerId) await loadCustomer(customerId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load customer documents') }
    finally { setLoading(false) }
  }, [loadCustomer, repository, selectedId])

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
      const type = String(values.get('document_type') || 'other')
      await uploadStoredFile({ file, ownerType: 'customer_document', ownerId: snapshot.customer.id, customerId: snapshot.customer.id, projectId: snapshot.project?.id })
      setModal(null); await loadCustomer(snapshot.customer.id); toast({ message: `${documentTypes.find(([value]) => value === type)?.[1] ?? 'Document'} uploaded`, variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not upload document', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function toggleArchive(file: StoredFile) {
    const nextStatus = file.status === 'archived' ? 'active' : 'archived'
    const action = nextStatus === 'active' ? 'unarchive' : 'archive'
    try {
      await setStoredFileStatus(file.id, nextStatus)
      if (snapshot) await loadCustomer(snapshot.customer.id)
      toast({ message: `Document ${action}d`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : `Could not ${action} document`, variant: 'error' })
    }
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

  return <WorkspacePage className="erp-page document-page">
    <WorkspaceHeader className="erp-page-head"><div><span>Customer documentation</span><h1>Documents</h1><p>Customer, quotation and project information is loaded automatically from the ERP.</p></div><div className="erp-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canEdit && <button className="secondary-button" onClick={() => setModal('template')}><Settings2 size={15} /> Company template</button>}{access.canCreate && selectedId && <button className="primary-button" onClick={() => setModal('upload')}><Upload size={15} /> Upload document</button>}</div></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}

    <section className="erp-panel document-customer-picker"><label><span>Customer</span><select value={selectedId} onChange={(event) => void select(event.target.value)}><option value="">Select customer</option>{customers.map((row) => <option key={row.id} value={row.id}>{row.display_name} · {row.record_number}</option>)}</select></label>{customer && <div><strong>{customer.display_name}</strong><span>{customer.consumer_number || 'No consumer number'} · {project?.record_number || 'No active project'}</span></div>}</section>

    {!snapshot ? <div className="document-page__body document-empty-surface"><EmptyState title="Select a customer" message="The document checklist and customer data pack will appear here." /></div> : <>
      <KpiGrid columns={4} className="erp-kpi-grid"><article><FileText /><span>Customer</span><strong>{customer?.display_name}</strong><small>{customer?.customer_type} · {customer?.electricity_provider || 'DISCOM not set'}</small></article><article><FileCheck2 /><span>Documents</span><strong>{activeFiles.length}</strong><small>{files.length - activeFiles.length ? `${files.length - activeFiles.length} archived` : 'Active uploaded files'}</small></article><article><FileText /><span>Project</span><strong>{project?.record_number || 'Not created'}</strong><small>{project ? `${project.capacity_kw} kW · ${project.payment_mode || 'Payment mode pending'}` : 'Quotation approval creates project'}</small></article><article><FileText /><span>Status</span><strong>{project?.documentation_status.replaceAll('_', ' ') || 'Customer registered'}</strong><small>{project?.registration_status.replaceAll('_', ' ') || 'Registration pending'}</small></article></KpiGrid>

      <div className="document-page__body document-scroll-body">

      <div className="erp-two-column document-workspace-grid"><section className="erp-panel document-data-pack"><header><div><span>Auto-filled information</span><h2>Customer data pack</h2></div></header><dl className="erp-detail-grid document-data-grid"><div><dt>Customer name</dt><dd>{customer?.display_name}</dd></div><div><dt>Phone</dt><dd>{customer?.contacts[0]?.phone || '—'}</dd></div><div><dt>Consumer number</dt><dd>{customer?.consumer_number || '—'}</dd></div><div><dt>Electricity provider</dt><dd>{customer?.electricity_provider || '—'}</dd></div><div className="document-data-grid__wide"><dt>Site address</dt><dd>{customer?.site_address || customer?.addresses[0]?.line_1 || '—'}</dd></div><div><dt>System capacity</dt><dd>{project ? `${project.capacity_kw} kW` : '—'}</dd></div><div><dt>Approved value</dt><dd>{project ? money.format(Number(project.approved_value || 0)) : '—'}</dd></div><div><dt>Payment mode</dt><dd>{project?.payment_mode || 'Pending'}</dd></div><div><dt>Assigned agent</dt><dd>{customer?.assigned_agent_id ? 'Assigned' : 'Not assigned'}</dd></div></dl><div className="document-template-preview"><strong>{templateSettings.company_name || session.company.name}</strong><span>{templateSettings.address || 'Company address not configured'}</span><small>{templateSettings.gstin ? `GSTIN ${templateSettings.gstin}` : 'GSTIN not configured'}</small></div></section>

      <section className="erp-panel"><header><div><span>Required files</span><h2>Document checklist</h2></div></header><div className="document-checklist">{documentTypes.map(([key, label]) => { const match = activeFiles.find((file) => file.name.toLowerCase().includes(key.replaceAll('_', ' ')) || file.owner_type.includes(key)); return <article key={key}><span className={`document-check ${match ? 'is-done' : ''}`}><FileCheck2 size={15} /></span><div><strong>{label}</strong><small>{match ? `Uploaded ${shortDate.format(new Date(match.created_at))}` : 'Pending upload'}</small></div></article> })}</div></section></div>

      <section className="erp-panel"><header><div><span>Stored securely</span><h2>Uploaded documents</h2></div></header>{files.length ? <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>File</th><th>Type</th><th>Project</th><th>Uploaded</th><th>Status</th><th /></tr></thead><tbody>{files.map((file) => { const isArchived = file.status === 'archived'; return <tr key={file.id}><td><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.size_bytes / 1024))} KB</small></td><td>{file.mime_type}</td><td>{file.project_id ? project?.record_number || 'Linked' : 'Customer level'}</td><td>{shortDate.format(new Date(file.created_at))}</td><td><span className={`soft-badge ${isArchived ? 'soft-badge--warning' : 'soft-badge--success'}`}>{file.status}</span></td><td><div className="erp-row-actions"><button className="secondary-button secondary-button--compact" onClick={() => void downloadStoredFile(file.id, file.name)}><Download size={14} /> Download</button>{access.canArchive && file.status !== 'deleted' && <button className="secondary-button secondary-button--compact" onClick={() => void toggleArchive(file)} aria-label={`${isArchived ? 'Unarchive' : 'Archive'} file`}>{isArchived ? <RotateCcw size={14} /> : <Archive size={14} />} {isArchived ? 'Unarchive' : 'Archive'}</button>}</div></td></tr> })}</tbody></table></div> : <EmptyState title="No documents uploaded" message="Upload the first customer document." />}</section>
      </div>
    </>}

    {modal === 'upload' && snapshot && <Modal title="Upload customer document" subtitle={`${snapshot.customer.display_name}${snapshot.project ? ` · ${snapshot.project.record_number}` : ''}`} onClose={() => setModal(null)}><form className="erp-form" onSubmit={upload}><div className="erp-form-grid"><label><span>Document type</span><select name="document_type">{documentTypes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="erp-form-wide"><span>File</span><input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>{working && <LoaderCircle className="spin" size={14} />} Upload</button></footer></form></Modal>}

    {modal === 'template' && template && <Modal title="Company document template" subtitle="Shared across authorized users and generated customer documents." onClose={() => setModal(null)}><form className="erp-form" onSubmit={saveTemplate}><div className="erp-form-grid"><label><span>Template name</span><input name="name" defaultValue={template.name} /></label><label><span>Company name</span><input name="company_name" defaultValue={templateSettings.company_name} /></label><label><span>Brand name</span><input name="brand_name" defaultValue={templateSettings.brand_name} /></label><label><span>GSTIN</span><input name="gstin" defaultValue={templateSettings.gstin} /></label><label><span>Phone</span><input name="phone" defaultValue={templateSettings.phone} /></label><label><span>Email</span><input name="email" defaultValue={templateSettings.email} /></label><label className="erp-form-wide"><span>Address</span><textarea name="address" defaultValue={templateSettings.address} /></label><label className="erp-form-wide"><span>Bank details</span><textarea name="bank_details" defaultValue={templateSettings.bank_details} /></label><label className="erp-form-wide"><span>Quotation notes</span><textarea name="quotation_notes" defaultValue={templateSettings.quotation_notes} /></label><label className="erp-form-wide"><span>Agreement wording</span><textarea name="agreement_wording" defaultValue={templateSettings.agreement_wording} /></label><label className="erp-form-wide"><span>Terms</span><textarea name="terms" defaultValue={templateSettings.terms} /></label><label className="erp-form-wide"><span>Footer</span><input name="footer" defaultValue={templateSettings.footer} /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}><Save size={14} /> Save template</button></footer></form></Modal>}
  </WorkspacePage>
}
