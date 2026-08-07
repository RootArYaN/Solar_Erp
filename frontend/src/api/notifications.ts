import type { WorkspaceNotificationSummary } from '../types'
import { apiRequest } from './client'

export const getWorkspaceNotifications = (signal?: AbortSignal): Promise<WorkspaceNotificationSummary> =>
  apiRequest('/notifications/summary', { signal, timeoutMs: 12_000 })
