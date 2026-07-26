import { Archive, CheckCircle2, Download, Eye, FileArchive, History, LoaderCircle, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  cleanArchive,
  createAgentTransactionArchive,
  createCustomerArchive,
  createProjectArchive,
  downloadArchive,
  getAgents,
  getArchive,
  getArchiveJob,
  getArchiveKpis,
  getArchives,
  getDocumentCustomerOptions,
  getAuditEvents,
  getProjectTimelines,
  purgeArchive,
  restoreArchive,
  verifyArchive,
} from '../../lib/api'
import { hasPermission, PERMISSIONS } from '../../lib/permissions'
import type { AgentListItem, ArchiveDetail, ArchiveJob, ArchiveKpis, ArchiveSummary, AuditEvent, DocumentCustomerOption, ProjectTimelineListItem, Session } from '../../types'
import { Modal } from '../admin/Modal'
import { KpiGrid, WorkspacePage, WorkspaceToolbar } from '../workspace'
import { useToast } from '../ui/ToastProvider'

type DetailTab = 'summary' | 'files' | 'events' | 'integrity'

const emptyKpis: ArchiveKpis = { archived_projects: 0, storage_used: 0, ready_for_cleanup: 0, failed_jobs: 0, last_cleanup: null }

export function DataArchivePage({ session }: { session: Session }) {
  const [rows, setRows] = useState<ArchiveSummary[]>([])
  const [kpis, setKpis] = useState(emptyKpis)
  const [projects, setProjects] = useState<ProjectTimelineListItem[]>([])
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [customers, setCustomers] = useState<DocumentCustomerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [activeJob, setActiveJob] = useState<ArchiveJob | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [detail, setDetail] = useState<ArchiveDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('summary')
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [projectId, setProjectId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [fromDate, setFromDate] = useState(() => startOfMonth())
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const { toast } = useToast()

  const canCreate = hasPermission(session, PERMISSIONS.archive.create)
  const canDownload = hasPermission(session, PERMISSIONS.archive.download)
  const canVerify = hasPermission(session, PERMISSIONS.archive.verify)
  const canClean = hasPermission(session, PERMISSIONS.archive.cleanup)
  const canRestore = hasPermission(session, PERMISSIONS.archive.restore)
  const canPurge = hasPermission(session, PERMISSIONS.archive.purge)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [archiveList, nextKpis, nextProjects, nextAgents, nextCustomers] = await Promise.all([
        getArchives({ page_size: 100, search: search || undefined, status: statusFilter || undefined, type: typeFilter || undefined }),
        getArchiveKpis(),
        canCreate ? getProjectTimelines(session.access_token).catch(() => []) : Promise.resolve([]),
        canCreate ? getAgents(session.access_token).catch(() => []) : Promise.resolve([]),
        canCreate ? getDocumentCustomerOptions().catch(() => []) : Promise.resolve([]),
      ])
      setRows(archiveList.data)
      setKpis(nextKpis)
      setProjects(nextProjects)
      setAgents(nextAgents)
      setCustomers(nextCustomers)
      setProjectId((current) => current || nextProjects.find((item) => item.project_status === 'completed')?.project_id || '')
      setCustomerId((current) => current || nextCustomers.find((item) => !item.project_id || item.project_status === 'completed')?.id || '')
      setAgentId((current) => current || nextAgents[0]?.membership_id || '')
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load archives', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [canCreate, search, session.access_token, statusFilter, toast, typeFilter])

  useEffect(() => { void load() }, [load])

  async function waitForJob(job: ArchiveJob) {
    setBusy(job.archive_id)
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const current = await getArchiveJob(job.id)
        setActiveJob(current)
        if (current.status === 'completed') {
          toast({ message: `Archive ${current.action} completed`, variant: 'success' })
          await load()
          return
        }
        if (current.status === 'failed') throw new Error(current.error || 'Archive job failed')
        await pause(1500)
      }
      toast({ message: 'The archive job is still running. Refresh later to check it.', variant: 'info' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Archive job failed', variant: 'error' })
      await load()
    } finally {
      setBusy('')
      setActiveJob(null)
    }
  }

  async function createProject(event: FormEvent) {
    event.preventDefault()
    if (!projectId) return
    try { await waitForJob(await createProjectArchive(projectId)) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not queue project archive', variant: 'error' }) }
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault()
    if (!customerId) return
    try { await waitForJob(await createCustomerArchive(customerId)) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not queue customer archive', variant: 'error' }) }
  }

  async function createTransactions(event: FormEvent) {
    event.preventDefault()
    if (!agentId) return
    try {
      await waitForJob(await createAgentTransactionArchive({ agent_membership_id: agentId, from_date: fromDate, to_date: toDate }))
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not queue transaction archive', variant: 'error' })
    }
  }

  async function openDetail(row: ArchiveSummary) {
    setBusy(row.id)
    try {
      const next = await getArchive(row.id)
      setDetail(next)
      setDetailTab('summary')
      setEvents([])
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not open archive', variant: 'error' })
    } finally { setBusy('') }
  }

  async function selectTab(tab: DetailTab) {
    setDetailTab(tab)
    if (tab !== 'events' || !detail || events.length) return
    try {
      const result = await getAuditEvents({ project_id: detail.project_id ?? undefined, customer_id: detail.customer_id ?? undefined, page_size: 100 })
      setEvents(result.data)
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load event history', variant: 'error' })
    }
  }

  async function action(row: ArchiveSummary, actionName: 'verify' | 'clean' | 'restore' | 'purge') {
    try {
      if (actionName === 'verify') return await waitForJob(await verifyArchive(row.id))
      if (actionName === 'clean') {
        const retentionActive = Boolean(row.keep_until && new Date(row.keep_until).getTime() > Date.now())
        let force = false
        if (retentionActive) {
          if (!session.user.is_super_admin) throw new Error(`Cleanup is available after ${formatDate(row.keep_until!)}`)
          force = window.confirm(`The retention date is ${formatDate(row.keep_until!)}. Override it and clean active data now?`)
          if (!force) return
        }
        return await waitForJob(await cleanArchive(row.id, force))
      }
      if (actionName === 'restore') return await waitForJob(await restoreArchive(row.id))
      const confirmation = window.prompt(`Type PURGE ${row.ref_id} to permanently remove this package.`)
      if (!confirmation) return
      const reason = window.prompt('Reason for permanent purge:')?.trim()
      if (!reason) return
      await waitForJob(await purgeArchive(row.id, confirmation, reason))
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Archive action failed', variant: 'error' })
    }
  }

  const completedProjects = useMemo(() => projects.filter((item) => item.project_status === 'completed'), [projects])

  return (
    <WorkspacePage className="archive-page page-section">
      {activeJob && <div className="archive-job-banner">
        <LoaderCircle className="spin" size={18} />
        <div><strong>{label(activeJob.action)} archive job</strong><span>{label(activeJob.status)} · {activeJob.progress}%</span></div>
        <progress max={100} value={activeJob.progress} aria-label={`Archive job ${activeJob.progress}% complete`} />
      </div>}

      <KpiGrid columns={5} className="archive-kpis">
        <Kpi label="Archived projects" value={String(kpis.archived_projects)} icon={<Archive size={18} />} />
        <Kpi label="Archive storage" value={formatBytes(kpis.storage_used)} icon={<FileArchive size={18} />} />
        <Kpi label="Ready for cleanup" value={String(kpis.ready_for_cleanup)} icon={<CheckCircle2 size={18} />} />
        <Kpi label="Failed jobs" value={String(kpis.failed_jobs)} icon={<ShieldCheck size={18} />} />
        <Kpi label="Last cleanup" value={kpis.last_cleanup ? formatDate(kpis.last_cleanup) : 'Not run'} icon={<History size={18} />} />
      </KpiGrid>

      {canCreate && <div className="archive-create-grid">
        <form className="archive-create-panel" onSubmit={createProject}>
          <div><strong>Archive project</strong><span>Completed projects only</span></div>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
            <option value="">Select completed project</option>
            {completedProjects.map((project) => <option key={project.project_id} value={project.project_id}>{project.project_number} · {project.customer_name}</option>)}
          </select>
          <button className="primary-button primary-button--compact" disabled={!projectId || Boolean(busy)}><Archive size={14} /> Create archive</button>
        </form>

        <form className="archive-create-panel" onSubmit={createCustomer}>
          <div><strong>Archive customer</strong><span>No active project or pending quote</span></div>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
            <option value="">Select eligible customer</option>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.customer_name}{customer.project_number ? ` · ${customer.project_number}` : ''}</option>)}
          </select>
          <button className="primary-button primary-button--compact" disabled={!customerId || Boolean(busy)}><Archive size={14} /> Create archive</button>
        </form>

        <form className="archive-create-panel archive-create-panel--transactions" onSubmit={createTransactions}>
          <div><strong>Archive agent transactions</strong><span>Approved entries in a date range</span></div>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
            <option value="">Select agent</option>
            {agents.map((agent) => <option key={agent.membership_id} value={agent.membership_id}>{agent.full_name}</option>)}
          </select>
          <div className="archive-date-row"><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div>
          <button className="primary-button primary-button--compact" disabled={!agentId || Boolean(busy)}><Archive size={14} /> Create archive</button>
        </form>
      </div>}

      <section className="archive-table-panel">
        <WorkspaceToolbar className="archive-toolbar">
          <input placeholder="Search archive" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option><option value="project">Project</option><option value="customer">Customer</option><option value="agent_transactions">Agent transactions</option></select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All status</option>{['queued', 'collecting', 'packing', 'verifying', 'ready', 'cleaned', 'failed', 'restored', 'purged'].map((status) => <option key={status} value={status}>{label(status)}</option>)}</select>
        </WorkspaceToolbar>

        <div className="table-scroll" data-scroll-surface="table">
          <table className="archive-table">
            <thead><tr><th>Archive</th><th>Type</th><th>Customer / Agent</th><th>Project</th><th>Created</th><th>Size</th><th>Status</th><th>Keep until</th><th>Actions</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="archive-empty"><LoaderCircle className="spin" size={20} /> Loading archives…</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9}><div className="archive-empty"><FileArchive size={22} /> No archives found</div></td></tr>}
              {!loading && rows.map((row) => <tr key={row.id}>
                <td><strong>{row.ref_id}</strong><small>{row.file_name || 'Package pending'}</small></td>
                <td>{label(row.type)}</td>
                <td>{row.customer_name || row.agent_name || '—'}</td>
                <td>{row.project_name || '—'}</td>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.size_bytes ? formatBytes(row.size_bytes) : '—'}</td>
                <td><span className={`archive-status archive-status--${row.status}`}>{label(row.status)}</span>{row.error && <small className="archive-error">{row.error}</small>}</td>
                <td>{row.keep_until ? formatDate(row.keep_until) : '—'}</td>
                <td><div className="archive-actions">
                  <button title="View" onClick={() => void openDetail(row)} disabled={busy === row.id}><Eye size={14} /></button>
                  {canDownload && ['ready', 'cleaned', 'restored'].includes(row.status) && <button title="Download ZIP" onClick={() => void downloadArchive(row.id, row.file_name)}><Download size={14} /></button>}
                  {canVerify && ['ready', 'cleaned', 'restored'].includes(row.status) && <button title="Verify" onClick={() => void action(row, 'verify')}><ShieldCheck size={14} /></button>}
                  {canClean && row.status === 'ready' && <button title="Clean active data" onClick={() => void action(row, 'clean')}><Trash2 size={14} /></button>}
                  {canRestore && ['ready', 'cleaned'].includes(row.status) && <button title="Restore" onClick={() => void action(row, 'restore')}><RotateCcw size={14} /></button>}
                  {canPurge && ['cleaned', 'restored'].includes(row.status) && <button title="Purge permanently" className="is-danger" onClick={() => void action(row, 'purge')}><Trash2 size={14} /></button>}
                </div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {detail && <Modal className="archive-detail-modal" title={detail.ref_id} subtitle={`${label(detail.type)} archive package`} onClose={() => setDetail(null)}>
        <div className="archive-detail-body">
          <div className="archive-detail-overview">
            <span className="archive-detail-overview__icon"><FileArchive size={19} /></span>
            <div>
              <small>{detail.type === 'agent_transactions' ? 'Agent' : 'Customer'}</small>
              <strong>{detail.customer_name || detail.agent_name || 'Archive package'}</strong>
              <span>{detail.project_name || detail.file_name || 'No project linked'}</span>
            </div>
            <span className={`archive-status archive-status--${detail.status}`}>{label(detail.status)}</span>
          </div>

          <div className="archive-detail-tabs" role="tablist" aria-label="Archive details" data-scroll-surface="horizontal">
            {(['summary', 'files', 'events', 'integrity'] as DetailTab[]).map((tab) => <button type="button" role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? 'is-active' : ''} key={tab} onClick={() => void selectTab(tab)}>
              {tab === 'summary' && <Eye size={13} />}
              {tab === 'files' && <FileArchive size={13} />}
              {tab === 'events' && <History size={13} />}
              {tab === 'integrity' && <ShieldCheck size={13} />}
              {label(tab)}
            </button>)}
          </div>

          <div className="archive-detail-pane">
            {detailTab === 'summary' && <div className="archive-detail-grid">
              <Detail label="Type" value={label(detail.type)} /><Detail label={detail.type === 'agent_transactions' ? 'Agent' : 'Customer'} value={detail.customer_name || detail.agent_name || '—'} /><Detail label="Project" value={detail.project_name || '—'} /><Detail label="Status" value={label(detail.status)} /><Detail label="Size" value={formatBytes(detail.size_bytes)} /><Detail label="Created" value={formatDate(detail.created_at)} /><Detail label="Keep until" value={detail.keep_until ? formatDate(detail.keep_until) : '—'} /><Detail label="Files" value={String(detail.files.length)} />
            </div>}
            {detailTab === 'files' && <div className="archive-file-list">{detail.files.length ? detail.files.map((file) => <article key={file.relative_path}><FileArchive size={16} /><div><strong>{file.name}</strong><span>{file.relative_path}</span></div><small>{formatBytes(file.size_bytes)}</small></article>) : <div className="archive-empty">No files in manifest</div>}</div>}
            {detailTab === 'events' && <div className="archive-event-list">{events.length ? events.map((event) => <article key={event.id}><span>{formatDateTime(event.created_at)}</span><strong>{label(event.event)}</strong><small>{event.user_role.replaceAll('_', ' ')}</small></article>) : <div className="archive-empty">No event history found</div>}</div>}
            {detailTab === 'integrity' && <div className="archive-integrity"><span><ShieldCheck size={22} /></span><strong>{detail.checksum ? 'SHA-256 checksum recorded' : 'Checksum pending'}</strong><code>{detail.checksum || '—'}</code><small>{detail.verified_at ? `Verified ${formatDateTime(detail.verified_at)}` : 'Not verified yet'}</small></div>}
          </div>
        </div>
      </Modal>}
    </WorkspacePage>
  )
}

function Kpi({ label: title, value, icon }: { label: string; value: string; icon: ReactNode }) { return <article className="archive-kpi"><span>{icon}</span><div><small>{title}</small><strong>{value}</strong></div></article> }
function Detail({ label: title, value }: { label: string; value: string }) { return <div><span>{title}</span><strong>{value}</strong></div> }
function label(value: string) { return value.replaceAll('_', ' ').replaceAll('.', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(2)} GB` }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function startOfMonth() { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10) }
function pause(ms: number) { return new Promise((resolve) => window.setTimeout(resolve, ms)) }
