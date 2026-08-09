import type { Bill, BillCustomerOption, BillList, CompanyLoan, FinanceCategory, FinanceOverview, FinanceTransaction, FinanceTransactionList, FinancialAccount, Profitability } from '../erp-types'
import { createClientId } from '../lib/client-id'
import { apiRequest, apiSegment, downloadRequest } from './client'

function datedQuery(query: string) {
  const params = new URLSearchParams(query)
  if (!params.get('date_from') || !params.get('date_to')) {
    throw new Error('Finance date range is required')
  }
  return `?${params.toString()}`
}

export const getFinanceOverview = (query: string): Promise<FinanceOverview> => apiRequest(`/finance/overview${datedQuery(query)}`)
export const getFinancialAccounts = (): Promise<FinancialAccount[]> => apiRequest('/finance/accounts')
export const createFinancialAccount = (body: Record<string, unknown>): Promise<FinancialAccount> => apiRequest('/finance/accounts', { method: 'POST', body, idempotencyKey: createClientId() })
export const getFinanceCategories = (): Promise<FinanceCategory[]> => apiRequest('/finance/categories')
export const getFinanceTransactions = (query: string): Promise<FinanceTransactionList> => apiRequest(`/finance/transactions${datedQuery(query)}`)
export const createFinanceTransaction = (body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest('/finance/transactions', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateFinanceTransaction = (id: string, body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest(`/finance/transactions/${apiSegment(id)}`, { method: 'PATCH', body })
export const reverseFinanceTransaction = (id: string, body: Record<string, unknown>): Promise<FinanceTransaction> => apiRequest(`/finance/transactions/${apiSegment(id)}/reverse`, { method: 'POST', body, idempotencyKey: createClientId() })
export const deleteFinanceTransaction = (id: string, body: Record<string, unknown>): Promise<void> => apiRequest(`/finance/transactions/${apiSegment(id)}`, { method: 'DELETE', body })
export const transferFinancialAccounts = (body: Record<string, unknown>): Promise<FinanceTransaction[]> => apiRequest('/finance/transfers', { method: 'POST', body, idempotencyKey: createClientId() })
export const getExpenses = (query: string): Promise<FinanceTransactionList> => apiRequest(`/finance/expenses${datedQuery(query)}`)
export const getBills = (query: string): Promise<BillList> => apiRequest(`/finance/bills${datedQuery(query)}`)
export const getBillCustomers = (): Promise<BillCustomerOption[]> => apiRequest('/finance/bill-customers')
export const createBill = (body: Record<string, unknown>): Promise<Bill> => apiRequest('/finance/bills', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateBill = (id: string, body: Record<string, unknown>): Promise<Bill> => apiRequest(`/finance/bills/${apiSegment(id)}`, { method: 'PATCH', body })
export const recordBillPayment = (id: string, body: Record<string, unknown>): Promise<Bill> => apiRequest(`/finance/bills/${apiSegment(id)}/payments`, { method: 'POST', body, idempotencyKey: createClientId() })
export const reverseBillPayment = (billId: string, paymentId: string, body: Record<string, unknown>): Promise<Bill> => apiRequest(`/finance/bills/${apiSegment(billId)}/payments/${apiSegment(paymentId)}/reverse`, { method: 'POST', body, idempotencyKey: createClientId() })
export const voidBill = (id: string, body: Record<string, unknown>): Promise<Bill> => apiRequest(`/finance/bills/${apiSegment(id)}/void`, { method: 'POST', body, idempotencyKey: createClientId() })
export const downloadMergedBills = (query: string): Promise<void> => downloadRequest(`/finance/bills/merged-download${datedQuery(query)}`, 'Bills.pdf')
export const getCompanyLoans = (): Promise<CompanyLoan[]> => apiRequest('/finance/company-loans')
export const createCompanyLoan = (body: Record<string, unknown>): Promise<CompanyLoan> => apiRequest('/finance/company-loans', { method: 'POST', body, idempotencyKey: createClientId() })
export const updateCompanyLoan = (id: string, body: Record<string, unknown>): Promise<CompanyLoan> => apiRequest(`/finance/company-loans/${apiSegment(id)}`, { method: 'PATCH', body })
export const recordCompanyLoanPayment = (id: string, body: Record<string, unknown>): Promise<CompanyLoan> => apiRequest(`/finance/company-loans/${apiSegment(id)}/payments`, { method: 'POST', body, idempotencyKey: createClientId() })
export const getProfitability = (query: string): Promise<Profitability> => apiRequest(`/finance/profitability${datedQuery(query)}`)

export const saveCustomerLoan = (projectId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => apiRequest(`/finance/customer-loans/${apiSegment(projectId)}`, { method: 'PUT', body })
