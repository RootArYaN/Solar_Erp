import type {
  CreateTaskInput,
  TaskList,
  TaskMetrics,
  TaskOptions,
  TaskPriority,
  TaskScope,
  TaskStatus,
  TaskItem,
  UpdateTaskAssignmentInput,
  UpdateTaskInput,
} from '../types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment } from './client'

export type TaskListParams = {
  scope: TaskScope
  q?: string
  status?: TaskStatus | ''
  priority?: TaskPriority | ''
  assigneeId?: string
  page?: number
  pageSize?: number
}

function taskQuery(params: TaskListParams): string {
  const query = new URLSearchParams({
    scope: params.scope,
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 50),
  })
  if (params.q?.trim()) query.set('q', params.q.trim())
  if (params.status) query.set('status', params.status)
  if (params.priority) query.set('priority', params.priority)
  if (params.assigneeId) query.set('assignee_id', params.assigneeId)
  return query.toString()
}

export const getTasks = (params: TaskListParams, signal?: AbortSignal): Promise<TaskList> =>
  apiRequest(`/tasks?${taskQuery(params)}`, { signal })

export const getTaskMetrics = (signal?: AbortSignal): Promise<TaskMetrics> =>
  apiRequest('/tasks/metrics', { signal })

export const getTaskOptions = (signal?: AbortSignal): Promise<TaskOptions> =>
  apiRequest('/tasks/options', { signal })

export const createTask = (input: CreateTaskInput): Promise<TaskItem> =>
  apiRequest('/tasks', { method: 'POST', body: input, idempotencyKey: createClientId() })

export const updateTask = (taskId: string, input: UpdateTaskInput): Promise<TaskItem> =>
  apiRequest(`/tasks/${apiSegment(taskId)}`, { method: 'PATCH', body: input })

export const updateMyTaskAssignment = (taskId: string, input: UpdateTaskAssignmentInput): Promise<TaskItem> =>
  apiRequest(`/tasks/${apiSegment(taskId)}/my-assignment`, { method: 'PATCH', body: input })

export const updateTaskAssignment = (taskId: string, assignmentId: string, input: UpdateTaskAssignmentInput): Promise<TaskItem> =>
  apiRequest(`/tasks/${apiSegment(taskId)}/assignments/${apiSegment(assignmentId)}`, { method: 'PATCH', body: input })

export const deleteTask = (taskId: string, expectedVersion: number): Promise<void> =>
  apiRequest(`/tasks/${apiSegment(taskId)}?expected_version=${expectedVersion}`, { method: 'DELETE', idempotencyKey: createClientId() })
