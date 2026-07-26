import type { DashboardSummary } from '../erp-types'
import { apiRequest } from './client'
export const getDashboardSummary = (): Promise<DashboardSummary> => apiRequest('/dashboard/summary')
