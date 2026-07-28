import type { Bill, BillCustomerOption, BillList, CompanyLoan, FinanceCategory, FinanceOverview, FinanceTransaction, FinanceTransactionList, FinancialAccount, Profitability } from '../erp-types'
import { createClientId } from '../lib/client-id'
import { apiRequest } from './client'

export const getFinanceOverview = (): Promise<FinanceOverview> => apiRequest('/finance/overview')
export const getFinancialAccounts = (): Promise<FinancialAccount[]> => apiRequest('/finance/accounts')
export const createFinancialAccount = (body: Record<string, unknown>): Promise<FinancialAccount> => apiRequest('/finance/accounts', { method: 'POST', body })
export const getFinanceCategories = (): Promise<FinanceCategory[]> => apiRequest('/finance/categories')
export const getFinanceTransactions = (query = ''): Promise<FinanceTransactionList> => apiRequest(`/finance/transactions${query ? `?${query}` : ''}`)
export const createFinanceTransaction = (body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest('/finance/transactions', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateFinanceTransaction = (id: string, body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest(`/finance/transactions/${id}`, { method: 'PATCH', body })
export const reverseFinanceTransaction = (id: string, body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest(`/finance/transactions/${id}/reverse`, { method: 'POST', body, idempotencyKey: createClientId() })
export const transferFinancialAccounts = (body: Record<string, unknown>): Promise<FinanceTransaction[]> => apiRequest('/finance/transfers', { method: 'POST', body, idempotencyKey: createClientId() })
export const getExpenses = (query = ''): Promise<FinanceTransactionList> => apiRequest(`/finance/expenses${query ? `?${query}` : ''}`)
export const getBills = (query = ''): Promise<BillList> => apiRequest(`/finance/bills${query ? `?${query}` : ''}`)
export const getBillCustomers = (): Promise<BillCustomerOption[]> => apiRequest('/finance/bill-customers')
export const createBill = (body: Record<string, unknown>): Promise<Bill> => apiRequest('/finance/bills', { method: 'POST', body, idempotencyKey: createClientId() })
export const recordBillPayment = (id: string, body: Record<string, unknown>): Promise<Bill> => apiRequest(`/finance/bills/${id}/payments`, { method: 'POST', body, idempotencyKey: createClientId() })
export const getCompanyLoans = (): Promise<CompanyLoan[]> => apiRequest('/finance/company-loans')
export const createCompanyLoan = (body: Record<string, unknown>): Promise<CompanyLoan> => apiRequest('/finance/company-loans', { method: 'POST', body, idempotencyKey: createClientId() })
export const recordCompanyLoanPayment = (id: string, body: Record<string, unknown>): Promise<CompanyLoan> => apiRequest(`/finance/company-loans/${id}/payments`, { method: 'POST', body, idempotencyKey: createClientId() })
export const getProfitability = (): Promise<Profitability> => apiRequest('/finance/profitability')

export const getCustomerLoan = (projectId: string): Promise<Record<string, unknown> | null> => apiRequest(`/finance/customer-loans/${projectId}`)
export const saveCustomerLoan = (projectId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => apiRequest(`/finance/customer-loans/${projectId}`, { method: 'PUT', body })
