import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  IndianRupee,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
  WalletCards,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getProjectTimeline,
  getProjectTimelines,
  setProjectPaymentMode,
  updateProjectTimelineStep,
} from '../../lib/api'
import type { ProjectTimeline, ProjectTimelineListItem, ProjectTimelineStep } from '../../types'
import { EmptyState, ErrorState, LoadingSkeleton } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, WorkspacePage } from '../workspace'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

function formatDate(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : date.format(parsed)
}

function ProjectListItem({ item, active, onSelect }: { item: ProjectTimelineListItem; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`timeline-project-item ${active ? 'is-active' : ''}`} onClick={onSelect} aria-current={active ? 'true' : undefined}>
      <div className="timeline-project-avatar">{item.customer_name.slice(0, 1).toUpperCase()}</div>
      <span className="timeline-project-copy">
        <strong>{item.customer_name}</strong>
        <small>{item.project_number} · {item.current_step_name}</small>
        <span className="timeline-mini-progress"><i style={{ width: `${item.progress}%` }} /></span>
      </span>
      <ChevronRight size={15} />
    </button>
  )
}

function TimelineStepRow({ step }: { step: ProjectTimelineStep }) {
  const Icon = step.status === 'completed' ? Check : step.status === 'current' ? Clock3 : Circle
  return (
    <article className={`project-timeline-step project-timeline-step--${step.status}`}>
      <div className="project-timeline-marker"><Icon size={step.status === 'pending' ? 12 : 15} /></div>
      <div className="project-timeline-step-copy">
        <div className="project-timeline-step-title">
          <strong>{step.name}</strong>
          {step.status === 'current' && <span>Current</span>}
        </div>
        {step.status === 'completed' ? (
          <p>
            {formatDate(step.event_date || step.completed_at)}
            {step.completed_by && <> · {step.completed_by}</>}
          </p>
        ) : step.status === 'current' ? <p>Ready for admin update</p> : <p>Upcoming</p>}
        {step.note && <small>{step.note}</small>}
      </div>
    </article>
  )
}

export function ProjectTimelinePage() {
  const [projects, setProjects] = useState<ProjectTimelineListItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [note, setNote] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [paymentMode, setPaymentMode] = useState<'cash' | 'loan'>('cash')
  const requestSequence = useRef(0)
  const { toast } = useToast()

  function applyLoadedTimeline(next: ProjectTimeline) {
    setTimeline(next)
    setPaymentMode(next.payment_mode || 'cash')
    setNote('')
    setEventDate('')
  }

  async function refreshPage(notify = false) {
    const requestId = ++requestSequence.current
    setLoading(true)
    setDetailLoading(true)
    setListError('')
    setDetailError('')
    try {
      const items = await getProjectTimelines()
      if (requestId !== requestSequence.current) return

      const nextSelectedId = items.some((item) => item.project_id === selectedId)
        ? selectedId
        : items[0]?.project_id ?? ''
      setProjects(items)
      setSelectedId(nextSelectedId)
      setLoading(false)

      if (!nextSelectedId) {
        setTimeline(null)
        setDetailLoading(false)
        if (notify) toast({ message: 'Projects refreshed', variant: 'success' })
        return
      }

      try {
        const next = await getProjectTimeline(nextSelectedId)
        if (requestId !== requestSequence.current) return
        applyLoadedTimeline(next)
        if (notify) toast({ message: 'Projects and timeline refreshed', variant: 'success' })
      } catch (reason) {
        if (requestId !== requestSequence.current) return
        setTimeline(null)
        const message = reason instanceof Error ? reason.message : 'Could not refresh the selected timeline'
        setDetailError(message)
        if (notify) toast({ message, variant: 'error' })
      } finally {
        if (requestId === requestSequence.current) setDetailLoading(false)
      }
    } catch (reason) {
      if (requestId !== requestSequence.current) return
      const message = reason instanceof Error ? reason.message : 'Could not load project timelines'
      setListError(message)
      setDetailLoading(false)
      if (notify) toast({ message, variant: 'error' })
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }

  async function loadTimeline(projectId: string) {
    const requestId = ++requestSequence.current
    setLoading(false)
    setSelectedId(projectId)
    if (!projectId) {
      setTimeline(null)
      setDetailError('')
      return
    }
    setDetailLoading(true)
    setDetailError('')
    try {
      const next = await getProjectTimeline(projectId)
      if (requestId !== requestSequence.current) return
      applyLoadedTimeline(next)
    } catch (reason) {
      if (requestId !== requestSequence.current) return
      setTimeline(null)
      setDetailError(reason instanceof Error ? reason.message : 'Could not load the selected timeline')
    } finally {
      if (requestId === requestSequence.current) setDetailLoading(false)
    }
  }

  useEffect(() => { void refreshPage() }, [])

  const visibleProjects = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return projects
    return projects.filter((item) => `${item.customer_name} ${item.project_number} ${item.project_name}`.toLowerCase().includes(term))
  }, [projects, search])

  const currentStep = timeline?.steps.find((step) => step.status === 'current') ?? null
  const previousStep = timeline?.steps.slice().reverse().find((step) => step.status === 'completed' && !step.locked) ?? null

  function applyTimeline(next: ProjectTimeline) {
    setTimeline(next)
    setProjects((items) => items.map((item) => item.project_id === next.project_id ? {
      project_id: next.project_id,
      customer_id: next.customer_id,
      project_number: next.project_number,
      project_name: next.project_name,
      customer_name: next.customer_name,
      customer_phone: next.customer_phone,
      project_status: next.project_status,
      payment_mode: next.payment_mode,
      current_step: next.current_step,
      current_step_name: next.current_step_name,
      progress: next.progress,
      updated_at: next.updated_at,
    } : item))
    setNote('')
    setEventDate('')
  }

  async function completeCurrentStep() {
    if (!timeline || !currentStep) return
    setSaving(true)
    try {
      const next = currentStep.key === 'payment_mode'
        ? await setProjectPaymentMode(timeline.project_id, paymentMode)
        : await updateProjectTimelineStep(timeline.project_id, currentStep.key, {
          action: 'complete',
          note,
          event_date: eventDate || null,
        })
      applyTimeline(next)
      toast({ message: `${currentStep.name} completed`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not update timeline', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function reopenPreviousStep() {
    if (!timeline || !previousStep) return
    setSaving(true)
    try {
      const next = await updateProjectTimelineStep(timeline.project_id, previousStep.key, {
        action: 'reopen',
        note: 'Reopened by admin',
      })
      applyTimeline(next)
      toast({ message: `${previousStep.name} reopened`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not reopen timeline step', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePage variant="split" className="project-timeline-page">
      {loading && !projects.length ? <LoadingSkeleton rows={8} /> : listError && !projects.length ? <ErrorState message={listError} onRetry={() => void refreshPage()} /> : !projects.length ? (
        <EmptyState title="No projects yet" message="Approved quotations will appear here as project timelines." />
      ) : (
        <div className="project-timeline-layout">
          <aside className="timeline-projects-panel">
            <header>
              <div><ListChecks size={17} /><span><strong>Projects</strong><small>{projects.length} active timelines</small></span></div>
              <button type="button" onClick={() => void refreshPage(true)} disabled={loading || detailLoading} aria-label="Refresh projects and selected timeline"><RefreshCw className={loading || detailLoading ? 'spin' : ''} size={14} /></button>
            </header>
            <label className="timeline-project-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project" /></label>
            <div className="timeline-project-list">
              {visibleProjects.map((item) => <ProjectListItem key={item.project_id} item={item} active={item.project_id === selectedId} onSelect={() => void loadTimeline(item.project_id)} />)}
            </div>
          </aside>

          <main className="timeline-detail-panel">
            {detailLoading ? <LoadingSkeleton rows={8} /> : detailError ? <ErrorState message={detailError} onRetry={() => void loadTimeline(selectedId)} /> : !timeline ? <EmptyState title="Select a project" message="Choose a project to load its timeline." /> : (
              <>
                <header className="timeline-project-header">
                  <div className="timeline-project-heading">
                    <span className="timeline-project-icon"><UserRound size={20} /></span>
                    <div><small>{timeline.project_number}</small><h1>{timeline.customer_name}</h1><p>{timeline.project_name}</p></div>
                  </div>
                  <div className="timeline-header-status"><span>{timeline.current_step_name}</span><strong>{timeline.progress}%</strong></div>
                </header>

                <div className="timeline-progress-track"><i style={{ width: `${timeline.progress}%` }} /></div>

                <KpiGrid columns={4} phoneColumns={2} responsive className="timeline-summary-grid">
                  <article><WalletCards size={16} /><span><small>Payment mode</small><strong>{timeline.payment_mode ? timeline.payment_mode : 'Not selected'}</strong></span></article>
                  <article><IndianRupee size={16} /><span><small>Approved value</small><strong>{money.format(timeline.approved_value)}</strong></span></article>
                  <article><CheckCircle2 size={16} /><span><small>Plant capacity</small><strong>{timeline.capacity_kw} kW</strong></span></article>
                  <article><CalendarDays size={16} /><span><small>Last updated</small><strong>{formatDate(timeline.updated_at)}</strong></span></article>
                </KpiGrid>

                <div className={`timeline-content-grid ${timeline.can_manage ? '' : 'timeline-content-grid--read-only'}`}>
                  <section className="project-timeline-card">
                    <header><div><strong>Project timeline</strong><small>Complete project flow in one view</small></div><span>{timeline.steps.filter((step) => step.status === 'completed').length}/{timeline.steps.length}</span></header>
                    <div className="project-timeline-list">{timeline.steps.map((step) => <TimelineStepRow key={step.key} step={step} />)}</div>
                  </section>

                  {timeline.can_manage ? (
                    <aside className="timeline-admin-panel">
                      <div className="timeline-admin-label">Admin control</div>
                      {currentStep ? (
                        <>
                          <div className="timeline-admin-current"><small>Current step</small><strong>{currentStep.name}</strong><p>Update only the active milestone.</p></div>
                          {currentStep.key === 'payment_mode' ? (
                            <label className="timeline-field"><span>Payment mode</span><select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as 'cash' | 'loan')}><option value="cash">Cash</option><option value="loan">Loan</option></select></label>
                          ) : (
                            <>
                              <label className="timeline-field"><span>Step date</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
                              <label className="timeline-field"><span>Note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Optional short note" /></label>
                            </>
                          )}
                          <button className="timeline-primary-action" onClick={() => void completeCurrentStep()} disabled={saving}><CheckCircle2 size={16} />{saving ? 'Saving…' : currentStep.key === 'payment_mode' ? 'Confirm payment mode' : 'Complete step'}</button>
                          {previousStep && <button className="timeline-secondary-action" onClick={() => void reopenPreviousStep()} disabled={saving}><RotateCcw size={14} />Reopen previous step</button>}
                        </>
                      ) : <div className="timeline-admin-current"><strong>Timeline complete</strong><p>All milestones have been completed.</p></div>}
                    </aside>
                  ) : (
                    <aside className="timeline-view-panel"><CheckCircle2 size={19} /><strong>View-only timeline</strong><p>Project progress is updated by the administrator.</p></aside>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      )}
    </WorkspacePage>
  )
}
