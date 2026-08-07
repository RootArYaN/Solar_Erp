import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Edit3,
  ListTodo,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  createTask,
  deleteTask,
  getTaskMetrics,
  getTaskOptions,
  getTasks,
  updateMyTaskAssignment,
  updateTask,
  updateTaskAssignment,
} from '../../api/tasks'
import { getLastRequestId } from '../../api/client'
import { hasPermission, PERMISSIONS } from '../../lib/permissions'
import type {
  CreateTaskInput,
  Session,
  TaskAssignment,
  TaskContext,
  TaskItem,
  TaskMetrics,
  TaskOptions,
  TaskPriority,
  TaskScope,
  TaskStatus,
  UpdateTaskAssignmentInput,
} from '../../types'
import { AlertDialog } from '../ui/AlertDialog'
import { Dialog } from '../ui/Dialog'
import { EmptyState, ErrorState, LoadingSkeleton } from '../ui/PageState'
import { KpiCard } from '../ui/KpiCard'
import { KpiGrid, WorkspaceHeader, WorkspacePage, WorkspaceToolbar } from '../workspace'
import { useToast } from '../ui/ToastProvider'

const EMPTY_METRICS: TaskMetrics = {
  my_open: 0,
  my_overdue: 0,
  my_due_today: 0,
  my_completed: 0,
  team_open: 0,
  team_overdue: 0,
}

const EMPTY_OPTIONS: TaskOptions = { users: [], roles: [] }
const TASK_PAGE_SIZE = 50

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

const CONTEXT_LABELS: Record<TaskContext, string> = {
  general: 'General',
  customers: 'Customers',
  projects: 'Projects',
  finance: 'Finance',
  inventory: 'Inventory',
  documents: 'Documents',
}

function notifyShell(): void {
  window.dispatchEvent(new Event('solar-erp:notifications-changed'))
}

function localDateTimeValue(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function formatDueDate(value: string | null): string {
  if (!value) return 'No due date'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function taskMyAssignment(task: TaskItem, membershipId: string): TaskAssignment | undefined {
  return task.assignments.find((assignment) => assignment.membership_id === membershipId)
}

export function TaskPage({ session }: { session: Session }) {
  const { toast } = useToast()
  const canCreate = hasPermission(session, PERMISSIONS.tasks.create)
  const canAssign = hasPermission(session, PERMISSIONS.tasks.assign) || hasPermission(session, PERMISSIONS.tasks.manage)
  const [scope, setScope] = useState<TaskScope>('mine')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TaskStatus | ''>('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [assigneeId, setAssigneeId] = useState('')
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [loadedPages, setLoadedPages] = useState(1)
  const [metrics, setMetrics] = useState<TaskMetrics>(EMPTY_METRICS)
  const [options, setOptions] = useState<TaskOptions>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [editingTask, setEditingTask] = useState<TaskItem | 'new' | null>(null)
  const [progressTask, setProgressTask] = useState<TaskItem | null>(null)
  const [deletingTask, setDeletingTask] = useState<TaskItem | null>(null)
  const taskQueryVersionRef = useRef(0)

  const fetchTaskPage = useCallback((page: number, signal?: AbortSignal) => getTasks({
    scope,
    q: query,
    status,
    priority,
    assigneeId,
    page,
    pageSize: TASK_PAGE_SIZE,
  }, signal), [assigneeId, priority, query, scope, status])

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    const requestVersion = taskQueryVersionRef.current + 1
    taskQueryVersionRef.current = requestVersion
    setError('')
    setLoading(true)
    try {
      const taskList = await fetchTaskPage(1, signal)
      if (requestVersion !== taskQueryVersionRef.current) return
      setTasks(taskList.data)
      setTaskTotal(taskList.total)
      setLoadedPages(1)
    } catch (reason) {
      if (signal?.aborted || requestVersion !== taskQueryVersionRef.current) return
      setError(reason instanceof Error ? reason.message : 'Could not load tasks.')
    } finally {
      if (!signal?.aborted && requestVersion === taskQueryVersionRef.current) setLoading(false)
    }
  }, [fetchTaskPage])

  const loadTaskMeta = useCallback(async (signal?: AbortSignal, showError = false) => {
    try {
      const [nextMetrics, nextOptions] = await Promise.all([
        getTaskMetrics(signal),
        canAssign ? getTaskOptions(signal) : Promise.resolve(EMPTY_OPTIONS),
      ])
      setMetrics(nextMetrics)
      setOptions(nextOptions)
    } catch (reason) {
      if (signal?.aborted) return
      if (showError) {
        toast({ message: reason instanceof Error ? reason.message : 'Could not refresh task counters.', variant: 'error' })
      }
    }
  }, [canAssign, toast])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => void loadTasks(controller.signal), query ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadTasks, query])

  useEffect(() => {
    const controller = new AbortController()
    void loadTaskMeta(controller.signal)
    return () => controller.abort()
  }, [loadTaskMeta])

  useEffect(() => {
    if (!canAssign && scope === 'team') {
      setScope('mine')
      setAssigneeId('')
    }
  }, [canAssign, scope])

  const hasFilters = Boolean(query || status || priority || assigneeId)
  const activeMetric = scope === 'team' ? metrics.team_open : metrics.my_open

  const refresh = useCallback(async () => {
    await Promise.all([loadTasks(), loadTaskMeta(undefined, true)])
  }, [loadTaskMeta, loadTasks])

  const loadMore = useCallback(async () => {
    if (loadingMore || tasks.length >= taskTotal) return
    const requestVersion = taskQueryVersionRef.current
    setLoadingMore(true)
    try {
      const nextPage = loadedPages + 1
      const taskList = await fetchTaskPage(nextPage)
      if (requestVersion !== taskQueryVersionRef.current) return
      setTasks((current) => {
        const knownIds = new Set(current.map((task) => task.id))
        return [...current, ...taskList.data.filter((task) => !knownIds.has(task.id))]
      })
      setTaskTotal(taskList.total)
      setLoadedPages(nextPage)
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load more tasks.', variant: 'error' })
    } finally {
      setLoadingMore(false)
    }
  }, [fetchTaskPage, loadedPages, loadingMore, taskTotal, tasks.length, toast])

  async function runMutation(action: () => Promise<unknown>, successMessage: string) {
    setWorking(true)
    try {
      await action()
      toast({ message: successMessage, variant: 'success' })
      notifyShell()
      await Promise.all([loadTasks(), loadTaskMeta()])
      return true
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not save the task.', variant: 'error' })
      return false
    } finally {
      setWorking(false)
    }
  }

  async function saveTask(input: CreateTaskInput, task?: TaskItem) {
    const saved = await runMutation(
      () => task
        ? updateTask(task.id, { ...input, expected_version: task.version })
        : createTask(input),
      task ? 'Task updated' : 'Task created',
    )
    if (saved) setEditingTask(null)
  }

  async function quickStatus(task: TaskItem, nextStatus: TaskStatus) {
    const assignment = taskMyAssignment(task, session.membership_id)
    if (!assignment) {
      setProgressTask(task)
      return
    }
    await runMutation(
      () => updateMyTaskAssignment(task.id, {
        status: nextStatus,
        progress: nextStatus === 'done' ? 100 : nextStatus === 'in_progress' ? Math.max(assignment.progress, 10) : 0,
        expected_version: task.version,
      }),
      nextStatus === 'done' ? 'Task completed' : 'Task status updated',
    )
  }

  async function removeTask() {
    if (!deletingTask) return
    const removed = await runMutation(() => deleteTask(deletingTask.id, deletingTask.version), 'Task deleted')
    if (removed) {
      setDeletingTask(null)
      setProgressTask(null)
    }
  }

  function clearFilters() {
    setQuery('')
    setStatus('')
    setPriority('')
    setAssigneeId('')
  }

  return (
    <WorkspacePage className="tasks-page">
      <WorkspaceHeader
        eyebrow="Work planner"
        title="Tasks"
        actions={(
          <>
            <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading || loadingMore || working}>
              <RefreshCw size={14} className={loading ? 'is-spinning' : ''} /> Refresh
            </button>
            {canCreate && (
              <button type="button" className="primary-button" onClick={() => setEditingTask('new')} disabled={working}>
                <Plus size={15} /> Add task
              </button>
            )}
          </>
        )}
      />

      <KpiGrid className="tasks-kpi-grid" columns={4} phoneColumns={2} responsive>
        <KpiCard icon={<ListTodo size={16} />} label={scope === 'team' ? 'Team open' : 'My open'} value={activeMetric} note="Active workload" tone="navy" />
        <KpiCard icon={<AlertCircle size={16} />} label="Overdue" value={scope === 'team' ? metrics.team_overdue : metrics.my_overdue} note="Needs attention" tone="danger" />
        <KpiCard icon={<CalendarClock size={16} />} label="Due today" value={metrics.my_due_today} note="My immediate tasks" tone="accent" />
        <KpiCard icon={<CheckCircle2 size={16} />} label="Completed" value={metrics.my_completed} note="My completed tasks" tone="success" />
      </KpiGrid>

      <WorkspaceToolbar
        className="tasks-toolbar"
        controls={(
          <>
            <div className="tasks-scope" role="group" aria-label="Task scope">
              <button type="button" className={scope === 'mine' ? 'is-active' : ''} onClick={() => { setScope('mine'); setAssigneeId('') }}><UserRound size={14} /> My tasks</button>
              {canAssign && <button type="button" className={scope === 'team' ? 'is-active' : ''} onClick={() => setScope('team')}><UsersRound size={14} /> Team board</button>}
            </div>
            <label className="tasks-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />
            </label>
            <div className={`tasks-filter-grid ${scope === 'team' && canAssign ? 'tasks-filter-grid--team' : ''}`}>
              <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | '')} aria-label="Filter task status">
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority | '')} aria-label="Filter task priority">
                <option value="">All priorities</option>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              {scope === 'team' && canAssign && (
                <select className="tasks-assignee-filter" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} aria-label="Filter task assignee">
                  <option value="">All assignees</option>
                  {options.users.map((user) => <option key={user.membership_id} value={user.membership_id}>{user.full_name}</option>)}
                </select>
              )}
            </div>
          </>
        )}
        actions={hasFilters ? <button type="button" className="tasks-clear-filter" onClick={clearFilters}>Clear filters</button> : undefined}
      />

      <div className="tasks-scroll" data-scroll-surface="tasks">
        {loading ? (
          <LoadingSkeleton rows={7} />
        ) : error ? (
          <ErrorState message={error} requestId={getLastRequestId()} onRetry={() => void refresh()} />
        ) : tasks.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No tasks match these filters' : 'No tasks yet'}
            message={hasFilters ? 'Clear a filter or adjust the search.' : 'Create a focused task and track it from start to completion.'}
            action={canCreate && !hasFilters ? <button type="button" className="primary-button" onClick={() => setEditingTask('new')}><Plus size={14} /> Add task</button> : undefined}
          />
        ) : (
          <>
            <div className="task-list" aria-live="polite">
              {tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  membershipId={session.membership_id}
                  onOpen={() => setProgressTask(task)}
                  onEdit={() => setEditingTask(task)}
                  onDelete={() => setDeletingTask(task)}
                  onStatus={(nextStatus) => void quickStatus(task, nextStatus)}
                />
              ))}
            </div>
            {tasks.length < taskTotal && (
              <div className="tasks-load-more">
                <span>Showing {tasks.length} of {taskTotal}</span>
                <button type="button" className="secondary-button" onClick={() => void loadMore()} disabled={loadingMore || working}>
                  {loadingMore ? <Loader2 size={14} className="is-spinning" /> : <Plus size={14} />} Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {editingTask && (
        <TaskEditorDialog
          task={editingTask === 'new' ? undefined : editingTask}
          session={session}
          options={options}
          canAssign={canAssign}
          working={working}
          onClose={() => setEditingTask(null)}
          onSave={saveTask}
        />
      )}

      {progressTask && (
        <TaskProgressDialog
          task={progressTask}
          session={session}
          working={working}
          onClose={() => setProgressTask(null)}
          onEdit={progressTask.can_edit ? () => { setProgressTask(null); setEditingTask(progressTask) } : undefined}
          onSave={async (assignment, input) => {
            const saved = await runMutation(
              () => assignment.membership_id === session.membership_id
                ? updateMyTaskAssignment(progressTask.id, { ...input, expected_version: progressTask.version })
                : updateTaskAssignment(progressTask.id, assignment.id, { ...input, expected_version: progressTask.version }),
              'Progress updated',
            )
            if (saved) setProgressTask(null)
          }}
        />
      )}

      <AlertDialog
        open={Boolean(deletingTask)}
        title="Delete task?"
        description={deletingTask ? `“${deletingTask.title}” and all assignee progress will be permanently removed.` : undefined}
        confirmLabel="Delete task"
        loading={working}
        icon="delete"
        onCancel={() => setDeletingTask(null)}
        onConfirm={removeTask}
      />
    </WorkspacePage>
  )
}

function TaskCard({
  task,
  membershipId,
  onOpen,
  onEdit,
  onDelete,
  onStatus,
}: {
  task: TaskItem
  membershipId: string
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onStatus: (status: TaskStatus) => void
}) {
  const mine = taskMyAssignment(task, membershipId)
  const nextStatus: TaskStatus = mine?.status === 'done' ? 'todo' : mine?.status === 'in_progress' ? 'done' : 'in_progress'

  return (
    <article className={`task-card task-card--${task.priority} ${task.overdue ? 'task-card--overdue' : ''}`}>
      <button
        type="button"
        className={`task-card__check task-card__check--${mine?.status ?? task.status}`}
        onClick={() => mine ? onStatus(nextStatus) : onOpen()}
        aria-label={mine?.status === 'done' ? 'Reopen task' : mine?.status === 'in_progress' ? 'Complete task' : 'Start task'}
      >
        {mine?.status === 'done' ? <Check size={16} /> : mine?.status === 'in_progress' ? <Play size={14} /> : <Circle size={15} />}
      </button>

      <button type="button" className="task-card__body" onClick={onOpen}>
        <span className="task-card__heading">
          <strong>{task.title}</strong>
          <span className={`task-priority task-priority--${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
        </span>
        <span className="task-card__meta">
          <span className={task.overdue ? 'is-overdue' : ''}><Clock3 size={12} /> {formatDueDate(task.due_at)}</span>
          <span>{CONTEXT_LABELS[task.context_type]}</span>
          <span>{task.assignments.length} assignee{task.assignments.length === 1 ? '' : 's'}</span>
        </span>
        <span className="task-card__progress-row">
          <span className="task-card__progress" aria-label={`${task.progress}% complete`}>
            <i style={{ width: `${task.progress}%` }} />
          </span>
          <small>{task.progress}%</small>
        </span>
      </button>

      <div className="task-card__side">
        <div className="task-card__assignees" aria-label="Task assignees">
          {task.assignments.slice(0, 3).map((assignment) => (
            <span key={assignment.id} title={`${assignment.assignee_name} · ${STATUS_LABELS[assignment.status]}`}>{initials(assignment.assignee_name)}</span>
          ))}
          {task.assignments.length > 3 && <span>+{task.assignments.length - 3}</span>}
        </div>

        <div className="task-card__actions">
          {task.can_edit && <button type="button" className="task-card__action" onClick={onEdit} title="Edit task" aria-label="Edit task"><Edit3 size={15} /></button>}
          {task.can_delete && <button type="button" className="task-card__action task-card__action--danger" onClick={onDelete} title="Delete task" aria-label="Delete task"><Trash2 size={15} /></button>}
          <button type="button" className="task-card__action" onClick={onOpen} title="Open task" aria-label="Open task details"><MoreHorizontal size={16} /></button>
        </div>
      </div>
    </article>
  )
}

function TaskEditorDialog({
  task,
  session,
  options,
  canAssign,
  working,
  onClose,
  onSave,
}: {
  task?: TaskItem
  session: Session
  options: TaskOptions
  canAssign: boolean
  working: boolean
  onClose: () => void
  onSave: (input: CreateTaskInput, task?: TaskItem) => void | Promise<void>
}) {
  const roleAssignments = useMemo(
    () => new Set(task?.assignments.map((assignment) => assignment.source_role_id).filter((value): value is string => Boolean(value)) ?? []),
    [task],
  )
  const directAssignments = useMemo(
    () => new Set(task?.assignments.filter((assignment) => !assignment.source_role_id).map((assignment) => assignment.membership_id) ?? [session.membership_id]),
    [session.membership_id, task],
  )
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal')
  const [contextType, setContextType] = useState<TaskContext>(task?.context_type ?? 'general')
  const [contextId, setContextId] = useState(task?.context_id ?? '')
  const [dueAt, setDueAt] = useState(localDateTimeValue(task?.due_at ?? null))
  const [selectedUsers, setSelectedUsers] = useState(directAssignments)
  const [selectedRoles, setSelectedRoles] = useState(roleAssignments)
  const [error, setError] = useState('')

  function toggle(setter: Dispatch<SetStateAction<Set<string>>>, value: string) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (title.trim().length < 2) {
      setError('Enter a task title with at least 2 characters.')
      return
    }
    if (canAssign && selectedUsers.size === 0 && selectedRoles.size === 0) {
      setError('Select at least one user or role.')
      return
    }
    setError('')
    const input: CreateTaskInput = {
      title: title.trim(),
      description: description.trim(),
      priority,
      context_type: contextType,
      context_id: contextId.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
    }
    if (canAssign) {
      input.assignee_membership_ids = Array.from(selectedUsers)
      input.assignee_role_ids = Array.from(selectedRoles)
    }
    void onSave(input, task)
  }

  return (
    <Dialog
      title={<span className="task-dialog-title"><span className="task-dialog-title__icon"><ListTodo size={17} /></span><span>{task ? 'Edit task' : 'Create task'}</span></span>}
      subtitle={task ? 'Update details, deadline and assignment without losing progress.' : 'Create a focused, trackable task with clear ownership.'}
      className="task-editor-dialog"
      headerClassName="task-dialog-header"
      bodyClassName="task-editor-dialog__body"
      closeDisabled={working}
      onClose={onClose}
      footer={(
        <footer className="task-dialog-footer">
          <button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button>
          <button type="submit" form="task-editor-form" className="primary-button" disabled={working}>
            {working ? <Loader2 size={14} className="is-spinning" /> : <Check size={14} />} {task ? 'Save changes' : 'Create task'}
          </button>
        </footer>
      )}
    >
      <form id="task-editor-form" className="task-editor-form" onSubmit={submit}>
        <section className="task-form-section">
          <header className="task-form-section__header">
            <div><strong>Task details</strong><span>Keep the title direct and the description actionable.</span></div>
          </header>
          <div className="task-form-section__grid task-form-section__grid--details">
            <label className="task-form-field task-form-field--wide">
              <span>Task title</span>
              <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} placeholder="What needs to be done?" />
            </label>
            <label className="task-form-field task-form-field--wide">
              <span>Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} rows={3} placeholder="Add only the details needed to complete the task." />
            </label>
          </div>
        </section>

        <section className="task-form-section">
          <header className="task-form-section__header">
            <div><strong>Planning</strong><span>Set urgency, deadline and the related workspace.</span></div>
          </header>
          <div className="task-form-section__grid">
            <label className="task-form-field">
              <span>Priority</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="task-form-field">
              <span>Due date & time</span>
              <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <label className="task-form-field">
              <span>Workspace</span>
              <select value={contextType} onChange={(event) => setContextType(event.target.value as TaskContext)}>
                {Object.entries(CONTEXT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
            <label className="task-form-field">
              <span>Reference ID <small>optional</small></span>
              <input value={contextId} onChange={(event) => setContextId(event.target.value)} maxLength={80} placeholder="Project or record number" />
            </label>
          </div>
        </section>

        {canAssign && (
          <section className="task-assignment-picker task-form-section">
            <header><div><span>Assign task</span><small>Choose users, roles, or both. Duplicate users are merged automatically.</small></div><span className="task-assignment-count"><ShieldCheck size={15} /> {selectedUsers.size + selectedRoles.size} selected</span></header>
            {options.roles.length > 0 && (
              <div className="task-assignment-picker__group">
                <strong>Roles</strong>
                <div className="task-option-grid">
                  {options.roles.map((role) => (
                    <label className={`${selectedRoles.has(role.id) ? 'is-selected' : ''} ${role.member_count === 0 ? 'is-disabled' : ''}`.trim()} key={role.id}>
                      <input type="checkbox" checked={selectedRoles.has(role.id)} disabled={role.member_count === 0} onChange={() => toggle(setSelectedRoles, role.id)} />
                      <UsersRound size={14} />
                      <span><b>{role.name}</b><small>{role.member_count} active user{role.member_count === 1 ? '' : 's'}</small></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="task-assignment-picker__group">
              <strong>Users</strong>
              <div className="task-option-grid task-option-grid--users">
                {options.users.map((user) => (
                  <label className={selectedUsers.has(user.membership_id) ? 'is-selected' : ''} key={user.membership_id}>
                    <input type="checkbox" checked={selectedUsers.has(user.membership_id)} onChange={() => toggle(setSelectedUsers, user.membership_id)} />
                    <span className="task-option-avatar">{initials(user.full_name)}</span>
                    <span><b>{user.full_name}</b><small>{user.role_code.replaceAll('_', ' ')}</small></span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}

        {error && <div className="task-form-error"><AlertCircle size={14} /> {error}</div>}
      </form>
    </Dialog>
  )
}

function TaskProgressDialog({
  task,
  session,
  working,
  onClose,
  onEdit,
  onSave,
}: {
  task: TaskItem
  session: Session
  working: boolean
  onClose: () => void
  onEdit?: () => void
  onSave: (assignment: TaskAssignment, input: UpdateTaskAssignmentInput) => void | Promise<void>
}) {
  const mine = taskMyAssignment(task, session.membership_id)
  const initial = mine ?? task.assignments[0]
  const [assignmentId, setAssignmentId] = useState(initial?.id ?? '')
  const assignment = task.assignments.find((item) => item.id === assignmentId) ?? initial
  const [status, setStatus] = useState<TaskStatus>(assignment?.status ?? 'todo')
  const [progress, setProgress] = useState(assignment?.progress ?? 0)
  const [note, setNote] = useState(assignment?.note ?? '')

  useEffect(() => {
    if (!assignment) return
    setStatus(assignment.status)
    setProgress(assignment.progress)
    setNote(assignment.note)
  }, [assignment])

  if (!assignment) return null
  const canSelectAssignment = task.can_manage_assignments && task.assignments.length > 1

  return (
    <Dialog
      title={<span className="task-dialog-title"><span className="task-dialog-title__icon task-dialog-title__icon--progress"><CheckCircle2 size={17} /></span><span>{task.title}</span></span>}
      subtitle={`${PRIORITY_LABELS[task.priority]} priority · ${CONTEXT_LABELS[task.context_type]} · created by ${task.created_by_name}`}
      className="task-progress-dialog"
      headerClassName="task-dialog-header"
      bodyClassName="task-progress-dialog__body"
      closeDisabled={working}
      onClose={onClose}
      footer={(
        <footer className="task-dialog-footer task-dialog-footer--split">
          <div>{onEdit && <button type="button" className="secondary-button" onClick={onEdit} disabled={working}><Edit3 size={14} /> Edit task</button>}</div>
          <div>
            <button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button>
            <button type="button" className="primary-button" disabled={working} onClick={() => void onSave(assignment, { status, progress, note: note.trim() })}>
              {working ? <Loader2 size={14} className="is-spinning" /> : <Check size={14} />} Save progress
            </button>
          </div>
        </footer>
      )}
    >
      <div className="task-progress-content">
        <section className="task-progress-overview">
          <div>
            <span className={`task-priority task-priority--${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
            {task.description && <p className="task-progress-description">{task.description}</p>}
          </div>
          <strong className="task-progress-overall"><span>{task.progress}%</span><small>overall</small></strong>
        </section>
        <div className="task-progress-facts">
          <span className={task.overdue ? 'is-overdue' : ''}><Clock3 size={13} /> {formatDueDate(task.due_at)}</span>
          <span><UsersRound size={13} /> {task.assignments.length} assignee{task.assignments.length === 1 ? '' : 's'}</span>
          <span><ListTodo size={13} /> {CONTEXT_LABELS[task.context_type]}</span>
        </div>

        {canSelectAssignment && (
          <label className="task-form-field task-form-field--wide">
            <span>Update assignee</span>
            <select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
              {task.assignments.map((item) => <option value={item.id} key={item.id}>{item.assignee_name} · {STATUS_LABELS[item.status]}</option>)}
            </select>
          </label>
        )}

        <section className="task-assignee-focus">
          <span className="task-option-avatar task-option-avatar--large">{initials(assignment.assignee_name)}</span>
          <div><strong>{assignment.assignee_name}</strong><small>{assignment.role_code.replaceAll('_', ' ')}</small></div>
          {assignment.source_role_name && <i>Assigned via {assignment.source_role_name}</i>}
        </section>

        <div className="task-status-grid" role="group" aria-label="Task status">
          {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((value) => (
            <button type="button" className={status === value ? 'is-active' : ''} key={value} onClick={() => {
              setStatus(value)
              if (value === 'done') setProgress(100)
              else if (value === 'todo') setProgress(0)
              else if (value === 'in_progress' && progress === 0) setProgress(10)
            }}>
              {value === 'done' ? <CheckCircle2 size={15} /> : value === 'blocked' ? <AlertCircle size={15} /> : value === 'in_progress' ? <Play size={15} /> : <Circle size={15} />}
              {STATUS_LABELS[value]}
            </button>
          ))}
        </div>

        <label className="task-progress-control">
          <span><b>Progress</b><strong>{progress}%</strong></span>
          <input type="range" min="0" max="100" step="5" value={progress} onChange={(event) => {
            const value = Number(event.target.value)
            setProgress(value)
            if (value === 100) setStatus('done')
            else if (value > 0 && status === 'todo') setStatus('in_progress')
          }} />
        </label>

        <label className="task-form-field task-form-field--wide">
          <span>Progress note <small>optional</small></span>
          <textarea rows={3} maxLength={600} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a blocker, handoff note or short update." />
        </label>
      </div>
    </Dialog>
  )
}
