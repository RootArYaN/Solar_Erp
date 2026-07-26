import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LockKeyhole,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FieldErrors } from '../../contracts/api-contracts'
import type { Customer, CustomerFlowSnapshot, MaterialRequestLine } from '../../contracts/domain-contracts'
import { getModuleAccess } from '../../lib/permissions'
import { createCustomerFlowRepository } from '../../lib/repositories/customer-flow-repository'
import { validateMaterialRequestDraft } from '../../lib/validation/material-request'
import { useUnsavedChanges } from '../../lib/use-unsaved-changes'
import type { Session } from '../../types'
import { AlertDialog } from '../ui/AlertDialog'
import { DataFreshness, EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })

function decimalToNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatAddress(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(', ')
}

function currentRevision(snapshot: CustomerFlowSnapshot | null) {
  const quotation = snapshot?.quotations[0]
  return quotation?.revisions.find((revision) => revision.id === quotation.current_revision_id) ?? null
}

export function CustomerWorkspacePage({ session }: { session: Session }) {
  const repository = useMemo(() => createCustomerFlowRepository(session.access_token), [session.access_token])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [snapshot, setSnapshot] = useState<CustomerFlowSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [approvalComment, setApprovalComment] = useState('Approved for project conversion.')
  const [purpose, setPurpose] = useState('Initial project material allocation')
  const [neededBy, setNeededBy] = useState('')
  const [materialLines, setMaterialLines] = useState<MaterialRequestLine[]>([])
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [dirty, setDirty] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [stale, setStale] = useState(false)
  const nextCursor = useRef<string | null>(null)
  const { toast } = useToast()

  const customerAccess = getModuleAccess(session, 'customers')
  const siteAccess = getModuleAccess(session, 'sites')
  const quotationAccess = getModuleAccess(session, 'quotations')
  const projectAccess = getModuleAccess(session, 'projects')
  const requestAccess = getModuleAccess(session, 'materialRequests')
  const revision = currentRevision(snapshot)
  const quotation = snapshot?.quotations[0] ?? null
  const site = snapshot?.sites[0] ?? null

  async function loadCustomers() {
    setLoading(true)
    setError('')
    try {
      const page = await repository.listCustomers(null)
      setCustomers(page.items)
      nextCursor.current = page.next_cursor
      setSelectedId((current) => current || page.items[0]?.id || '')
      setStale(!navigator.onLine)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customers')
    } finally {
      setLoading(false)
    }
  }

  async function loadSnapshot(customerId: string) {
    if (!customerId) {
      setSnapshot(null)
      return
    }
    setDetailLoading(true)
    setError('')
    try {
      const next = await repository.getSnapshot(customerId)
      setSnapshot(next)
      setPurpose(next.material_request?.purpose ?? 'Initial project material allocation')
      setNeededBy(next.material_request?.needed_at_site_by ?? '')
      setMaterialLines(next.material_request?.lines ?? [])
      setDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load customer workflow')
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => { void loadCustomers() }, [])
  useEffect(() => { void loadSnapshot(selectedId) }, [selectedId])

  useEffect(() => {
    const onOnline = () => { setOffline(false); setStale(true) }
    const onOffline = () => { setOffline(true); setStale(true) }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useUnsavedChanges(dirty)

  const visibleCustomers = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return customers
    return customers.filter((customer) => `${customer.display_name} ${customer.legal_name} ${customer.record_number}`.toLowerCase().includes(term))
  }, [customers, search])

  async function approveQuotation() {
    if (!snapshot || !quotation) return
    setWorking(true)
    try {
      const next = await repository.approveQuotation(snapshot.customer.id, quotation.id, approvalComment.trim())
      setSnapshot(next)
      setCustomers((current) => current.map((customer) => customer.id === next.customer.id ? next.customer : customer))
      setPurpose(next.material_request?.purpose ?? 'Initial project material allocation')
      setNeededBy(next.material_request?.needed_at_site_by ?? '')
      setMaterialLines(next.material_request?.lines ?? [])
      toast({ message: next.project ? 'Quotation approved and linked project created' : 'Quotation approved', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not approve quotation', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  function addMaterialLine() {
    setMaterialLines((current) => [...current, { id: crypto.randomUUID(), item_id: null, description: '', requested_quantity: '1.00', unit: 'Nos', required_by: neededBy || null, note: '' }])
    setDirty(true)
  }

  function updateMaterialLine(id: string, patch: Partial<MaterialRequestLine>) {
    setMaterialLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line))
    setDirty(true)
  }

  function removeMaterialLine(id: string) {
    setMaterialLines((current) => current.filter((line) => line.id !== id))
    setFieldErrors({})
    setDirty(true)
  }

  async function saveMaterialDraft() {
    if (!snapshot) return
    const errors = validateMaterialRequestDraft(purpose, materialLines)
    setFieldErrors(errors)
    if (Object.keys(errors).length) return

    setWorking(true)
    try {
      setSnapshot(await repository.saveMaterialRequest(snapshot.customer.id, { purpose: purpose.trim(), needed_at_site_by: neededBy || null, lines: materialLines }))
      setDirty(false)
      toast({ message: 'Material-request draft saved', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not save material request', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  async function changeArchiveState() {
    if (!snapshot) return
    setWorking(true)
    try {
      const next = snapshot.customer.archived_at
        ? await repository.restoreCustomer(snapshot.customer.id)
        : await repository.archiveCustomer(snapshot.customer.id, 'Archived from customer workspace')
      setSnapshot(next)
      setCustomers((current) => current.map((customer) => customer.id === next.customer.id ? next.customer : customer))
      setArchiveOpen(false)
      toast({ message: next.customer.archived_at ? 'Customer archived' : 'Customer restored', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update archive status', variant: 'error' })
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="customer-flow-page">
      <DataFreshness offline={offline} stale={stale} updatedAt={snapshot?.customer.updated_at} />
      {(customerAccess.readOnly || quotationAccess.readOnly || projectAccess.readOnly || requestAccess.readOnly) && <ReadOnlyNotice />}

      {loading ? <LoadingSkeleton rows={7} /> : error && !snapshot ? <ErrorState message={error} onRetry={() => void loadCustomers()} /> : (
        <div className="customer-flow-layout">
          <aside className="customer-list-panel">
            <div className="customer-list-heading">
              <div><strong>Customers</strong><span>{visibleCustomers.length} records</span></div>
              <button className="customer-list-refresh" onClick={() => void loadSnapshot(selectedId)} disabled={detailLoading} aria-label="Refresh selected customer"><RefreshCw size={13} /><span>Refresh</span></button>
            </div>
            <div className="customer-list-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" /></div>
            <div className="customer-list-scroll">
              {visibleCustomers.map((customer) => (
                <button key={customer.id} className={selectedId === customer.id ? 'active' : ''} onClick={() => {
                  if (dirty && !window.confirm('Discard unsaved material-request changes?')) return
                  setSelectedId(customer.id)
                }}>
                  <div className="customer-list-avatar">{customer.display_name.slice(0, 1)}</div>
                  <span><strong>{customer.display_name}</strong><small>{customer.record_number}</small><em className={`customer-status customer-status--${customer.status}`}>{customer.status.replaceAll('_', ' ')}</em></span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {visibleCustomers.length === 0 && <EmptyState title="No customers" />}
            </div>
            {nextCursor.current && <button className="cursor-load-button">Load more customers</button>}
          </aside>

          <main className="customer-workspace">
            {detailLoading ? <LoadingSkeleton rows={9} /> : error ? <ErrorState message={error} onRetry={() => void loadSnapshot(selectedId)} /> : snapshot && (
              <>
                <section className="customer-detail-card">
                  <header className="customer-summary-header">
                    <div className="customer-detail-title">
                      <div>
                        <span>{snapshot.customer.record_number}</span>
                        <div className="customer-name-row"><h2>{snapshot.customer.display_name}</h2><em className={`customer-status customer-status--${snapshot.customer.status}`}>{snapshot.customer.status.replaceAll('_', ' ')}</em></div>
                        {snapshot.customer.legal_name !== snapshot.customer.display_name && <p>{snapshot.customer.legal_name}</p>}
                      </div>
                    </div>
                    {customerAccess.canArchive && <button className="customer-archive-button" onClick={() => setArchiveOpen(true)}>{snapshot.customer.archived_at ? <RotateCcw size={13} /> : <Archive size={13} />}{snapshot.customer.archived_at ? 'Restore' : 'Archive'}</button>}
                  </header>
                  <div className="customer-summary-details">
                    {snapshot.customer.contacts.map((contact) => <div className="customer-summary-detail" key={contact.id}><Phone size={13} /><div>{contact.full_name !== snapshot.customer.display_name && <strong>{contact.full_name}</strong>}<span>{[contact.designation, contact.phone, contact.email].filter(Boolean).join(' · ')}</span></div></div>)}
                    {snapshot.customer.addresses.map((address) => <div className="customer-summary-detail" key={address.id}><MapPin size={13} /><div><small>{address.label}</small><span>{formatAddress([address.line_1, address.line_2, address.city, address.state, address.postal_code])}</span></div></div>)}
                  </div>
                  {snapshot.customer.archived_at && <div className="archive-banner">Archived {new Date(snapshot.customer.archived_at).toLocaleString('en-IN')} · {snapshot.customer.archive_reason}</div>}
                </section>


                <section className="flow-stage-grid">
                  <article className={`flow-stage-card ${site ? 'flow-stage-card--complete' : ''}`}>
                    <header><div className="flow-stage-number">1</div><div><span>Site</span><strong>{site?.record_number ?? 'Not created'}</strong></div>{site && <CheckCircle2 className="flow-stage-check" size={17} />}</header>
                    {siteAccess.canView ? snapshot.sites.map((site) => <div className="flow-stage-body" key={site.id}><h3>{site.name}</h3><p>{formatAddress([site.address.line_1, site.address.line_2, site.address.city])}</p><dl><div><dt>Proposed</dt><dd>{site.proposed_capacity_kw} kW</dd></div><div><dt>Meter</dt><dd>{site.meter_type.replaceAll('_', ' ')}</dd></div><div><dt>Status</dt><dd>{site.status.replaceAll('_', ' ')}</dd></div></dl></div>) : <EmptyState title="Restricted" />}
                  </article>

                  <article className={`flow-stage-card ${revision?.status === 'approved' ? 'flow-stage-card--complete' : 'flow-stage-card--current'}`}>
                    <header><div className="flow-stage-number">2</div><div><span>Quotation</span><strong>{quotation?.record_number ?? 'Not created'}</strong></div>{revision?.status === 'approved' ? <CheckCircle2 className="flow-stage-check" size={17} /> : <Clock3 className="flow-stage-pending" size={17} />}</header>
                    {!quotationAccess.canView ? <EmptyState title="Restricted" /> : quotation && revision ? <div className="flow-stage-body"><div className="stage-title-row"><h3>Revision {revision.revision_number}</h3><span className={`stage-status stage-status--${revision.status}`}>{revision.status.replaceAll('_', ' ')}</span></div><p>{quotation.title}</p><dl><div><dt>Total</dt><dd>{currency.format(decimalToNumber(revision.grand_total))}</dd></div><div><dt>Version</dt><dd>v{revision.version}</dd></div></dl>{revision.status === 'approved' ? <div className="approval-success"><CheckCircle2 size={15} /><span>Approved</span></div> : <div className="stage-approval-controls"><label className="compact-field"><span>Approval note</span><input value={approvalComment} onChange={(event) => setApprovalComment(event.target.value)} disabled={!quotationAccess.canApprove} /></label>{quotationAccess.canApprove && <button className="primary-button primary-button--compact stage-action" onClick={() => void approveQuotation()} disabled={working}><CheckCircle2 size={15} /> Approve quotation</button>}</div>}</div> : <EmptyState title="No quotation" />}
                  </article>

                  <article className={`flow-stage-card ${snapshot.project ? 'flow-stage-card--complete' : ''}`}>
                    <header><div className="flow-stage-number">3</div><div><span>Project</span><strong>{snapshot.project?.record_number ?? 'Not created'}</strong></div>{snapshot.project ? <CheckCircle2 className="flow-stage-check" size={17} /> : <LockKeyhole className="flow-stage-locked" size={16} />}</header>
                    {!projectAccess.canView ? <EmptyState title="Restricted" /> : snapshot.project ? <div className="flow-stage-body"><h3>{snapshot.project.name}</h3><dl><div><dt>Status</dt><dd>{snapshot.project.status}</dd></div><div><dt>Capacity</dt><dd>{snapshot.project.capacity_kw} kW</dd></div><div><dt>Approved value</dt><dd>{currency.format(decimalToNumber(snapshot.project.approved_value))}</dd></div></dl><div className="workflow-link-note"><CheckCircle2 size={13} /> Linked to {quotation?.record_number}</div></div> : <div className="flow-stage-body flow-stage-body--locked"><div className="locked-stage-message"><LockKeyhole size={18} /><div><strong>{revision?.status === 'approved' ? 'Creating linked project' : 'Quotation approval required'}</strong><span>{revision?.status === 'approved' ? 'Refresh if the project does not appear.' : 'Approval automatically creates the project record.'}</span></div></div></div>}
                  </article>
                </section>

                <section className={`material-request-card ${snapshot.project ? 'material-request-card--enabled' : ''}`}>
                  <header><div><span>Next step</span><h2>Material request</h2>{snapshot.material_request?.record_number && <p>{snapshot.material_request.record_number}</p>}</div>{dirty && <small>Unsaved changes</small>}</header>
                  {!requestAccess.canView ? <EmptyState title="Restricted" /> : !snapshot.project ? <EmptyState title="Project required" /> : <>
                    <div className="material-request-meta">
                      <label><span>Purpose</span><input value={purpose} onChange={(event) => { setPurpose(event.target.value); setDirty(true) }} disabled={!requestAccess.canEdit && !requestAccess.canCreate} />{fieldErrors.purpose?.map((message) => <small className="field-error" key={message}>{message}</small>)}</label>
                      <label><span>Needed at site by</span><input type="date" value={neededBy} onChange={(event) => { setNeededBy(event.target.value); setDirty(true) }} disabled={!requestAccess.canEdit && !requestAccess.canCreate} /></label>
                    </div>
                    <div className="material-lines">
                      {materialLines.map((line, index) => (
                        <div className="material-line" key={line.id}>
                          <input value={line.description} onChange={(event) => updateMaterialLine(line.id, { description: event.target.value })} placeholder="Material description" disabled={!requestAccess.canEdit && !requestAccess.canCreate} />
                          <input value={line.requested_quantity} inputMode="decimal" onChange={(event) => updateMaterialLine(line.id, { requested_quantity: event.target.value })} aria-label="Requested quantity" disabled={!requestAccess.canEdit && !requestAccess.canCreate} />
                          <input value={line.unit} onChange={(event) => updateMaterialLine(line.id, { unit: event.target.value })} aria-label="Unit" disabled={!requestAccess.canEdit && !requestAccess.canCreate} />
                          <button
                            className="material-line-delete"
                            type="button"
                            onClick={() => removeMaterialLine(line.id)}
                            disabled={materialLines.length === 1 || (!requestAccess.canEdit && !requestAccess.canCreate)}
                            aria-label={`Delete material row ${index + 1}`}
                            title={materialLines.length === 1 ? 'At least one material row is required' : 'Delete row'}
                          >
                            <Trash2 size={14} />
                          </button>
                          <small className="field-error">{fieldErrors[`lines.${index}.description`]?.[0] ?? fieldErrors[`lines.${index}.requested_quantity`]?.[0]}</small>
                        </div>
                      ))}
                      {materialLines.length === 0 && <EmptyState title="No material lines" />}
                    </div>
                    <footer><button className="secondary-button" onClick={addMaterialLine} disabled={!requestAccess.canCreate && !requestAccess.canEdit}><Plus size={14} /> Add line</button><button className="primary-button primary-button--compact" onClick={() => void saveMaterialDraft()} disabled={working || (!requestAccess.canCreate && !requestAccess.canEdit)}><Send size={14} /> Save draft</button></footer>
                  </>}
                </section>
              </>
            )}
          </main>
        </div>
      )}

      <AlertDialog
        open={archiveOpen}
        title={snapshot?.customer.archived_at ? 'Restore customer?' : 'Archive customer?'}
        confirmLabel={snapshot?.customer.archived_at ? 'Restore customer' : 'Archive customer'}
        variant="warning"
        icon={snapshot?.customer.archived_at ? 'reset' : 'warning'}
        loading={working}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={changeArchiveState}
      />
    </section>
  )
}
