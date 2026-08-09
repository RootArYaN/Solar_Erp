import { useState, type FormEvent } from 'react'
import type { Bill, BillCustomerOption, CompanyLoan, FinanceCategory, FinanceTransaction, FinancialAccount } from '../../erp-types'
import type { ProjectTimelineListItem } from '../../types'
import { label, money, today } from './finance-utils'

export function EditTransactionForm({ transaction, working, onSubmit }: { transaction: FinanceTransaction; accounts: FinancialAccount[]; categories: FinanceCategory[]; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}>
    <div className="inline-warning">Posted financial values are locked. Use Reverse to correct date, amount, account, category, direction, or source.</div>
    <input type="hidden" name="transaction_date" value={transaction.transaction_date} />
    <input type="hidden" name="direction" value={transaction.direction} />
    <input type="hidden" name="amount" value={transaction.amount} />
    <input type="hidden" name="account_id" value={transaction.account_id} />
    <input type="hidden" name="category_id" value={transaction.category_id || ''} />
    <input type="hidden" name="source_type" value={transaction.source_type} />
    <div className="erp-form-grid">
      <label><span>Date</span><input value={transaction.transaction_date} disabled /></label>
      <label><span>Amount</span><input value={money.format(transaction.amount)} disabled /></label>
      <label><span>Account</span><input value={transaction.account_name} disabled /></label>
      <label><span>Category / source</span><input value={transaction.category_name || label(transaction.source_type)} disabled /></label>
      <label><span>Payment method</span><select name="payment_method" defaultValue={transaction.payment_method}><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label>
      <label><span>Reference</span><input name="reference_number" defaultValue={transaction.reference_number} /></label>
      <label className="erp-form-wide"><span>Description</span><input name="description" defaultValue={transaction.description} /></label>
    </div>
    <footer className="erp-form-actions"><button className="primary-button" disabled={working}>Save details</button></footer>
  </form>
}


export function TransactionForm({ accounts, categories, projects, working, expense = false, onSubmit }: { accounts: FinancialAccount[]; categories: FinanceCategory[]; projects: ProjectTimelineListItem[]; working: boolean; expense?: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input name="transaction_date" type="date" defaultValue={today()} required /></label>{!expense && <label><select name="direction"><option value="credit">Money in</option><option value="debit">Money out</option></select></label>}<label><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" required /></label><label><span>Account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Category</span><select name="category_id"><option value="">No category</option>{categories.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Payment method</span><select name="payment_method"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Paid to / received from</span><input name="party_name" /></label><label><span>Party type</span><select name="party_type"><option value="other">Other</option><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="agent">Agent</option><option value="employee">Employee</option><option value="lender">Lender</option></select></label>{!expense && <label><span>Source</span><select name="source_type"><option value="manual_adjustment">Manual entry</option><option value="customer_payment">Customer payment</option><option value="supplier_payment">Supplier payment</option><option value="subsidy_received">Subsidy received</option><option value="agent_commission">Agent commission</option></select></label>}<label><span>Project (optional)</span><select name="project_id"><option value="">General company entry</option>{projects.map((row) => <option value={row.project_id} key={row.project_id}>{row.project_number} · {row.customer_name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Description</span><input name="description" required /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working || !accounts.length}>Post {expense ? 'expense' : 'transaction'}</button></footer></form>
}

export function AccountForm({ working, onSubmit }: { working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Account name</span><input name="name" required /></label><label><span>Type</span><select name="account_type"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="petty_cash">Petty cash</option></select></label><label><span>Bank name</span><input name="bank_name" /></label><label><span>Last 4 account digits</span><input name="masked_account_number" placeholder="1234" /></label><label><span>Opening balance</span><input type="number" step="0.01" name="opening_balance" defaultValue="0" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Create account</button></footer></form> }

export function TransferForm({ accounts, working, onSubmit }: { accounts: FinancialAccount[]; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" required /></label><label><span>From account</span><select name="source_account_id" required><option value="">Select source</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name} · {money.format(row.current_balance)}</option>)}</select></label><label><span>To account</span><select name="destination_account_id" required><option value="">Select destination</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label><span>Description</span><input name="description" defaultValue="Account transfer" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Transfer money</button></footer></form> }

export function BillForm({ customers, projects, initialType, working, onSubmit }: { customers: BillCustomerOption[]; projects: ProjectTimelineListItem[]; initialType: 'sales' | 'purchase'; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [type, setType] = useState<'sales' | 'purchase'>(initialType)
  const [customerId, setCustomerId] = useState('')
  const availableProjects = type === 'sales' ? projects.filter((row) => row.customer_id === customerId) : projects

  return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid">
    <label><span>Bill type</span><select name="bill_type" value={type} onChange={(event) => { setType(event.target.value as 'sales' | 'purchase'); setCustomerId('') }}><option value="sales">Sales bill</option><option value="purchase">Purchase bill</option></select></label>
    <label><span>Bill number</span><input name="bill_number" required /></label>
    <label><span>Bill date</span><input type="date" name="bill_date" defaultValue={today()} required /></label>
    <label><span>Due date</span><input type="date" name="due_date" /></label>
    {type === 'sales'
      ? <label className="erp-form-wide"><span>Customer</span><select name="customer_id" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required><option value="">Select customer</option>{customers.map((row) => <option value={row.id} key={row.id}>{row.customer_name}</option>)}</select></label>
      : <label className="erp-form-wide"><span>Supplier name</span><input name="supplier_name" required /></label>}
    <label><span>Project (optional)</span><select name="project_id" disabled={type === 'sales' && !customerId}><option value="">{type === 'sales' ? 'No linked project' : 'General purchase'}</option>{availableProjects.map((row) => <option value={row.project_id} key={row.project_id}>{row.project_number} · {row.customer_name}</option>)}</select></label>
    <label><span>Subtotal</span><input type="number" name="subtotal" min="0.01" step="0.01" required /></label>
    <label><span>Tax</span><input type="number" name="tax_amount" min="0" step="0.01" defaultValue="0" /></label>
    <label className="erp-form-wide"><span>Bill attachment (optional)</span><input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.webp" /></label>
    <label className="erp-form-wide"><span>Note</span><textarea name="note" /></label>
  </div><footer className="erp-form-actions"><button className="primary-button" disabled={working || (type === 'sales' && !customers.length)}>{working ? 'Creating…' : `Create ${type} bill`}</button></footer></form>
}

export function EditBillForm({ bill, working, onSubmit }: { bill: Bill; customers: BillCustomerOption[]; projects: ProjectTimelineListItem[]; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="erp-form" onSubmit={onSubmit}>
    <div className="inline-warning">The bill number, party, and amounts cannot change. Cancel this bill and create a new one to fix them.</div>
    <input type="hidden" name="bill_number" value={bill.bill_number} />
    <input type="hidden" name="bill_date" value={bill.bill_date} />
    <input type="hidden" name="customer_id" value={bill.customer_id || ''} />
    <input type="hidden" name="project_id" value={bill.project_id || ''} />
    <input type="hidden" name="supplier_name" value={bill.supplier_name} />
    <input type="hidden" name="subtotal" value={bill.subtotal} />
    <input type="hidden" name="tax_amount" value={bill.tax_amount} />
    <div className="erp-form-grid">
      <label><span>Bill</span><input value={bill.bill_number} disabled /></label>
      <label><span>Party</span><input value={bill.customer_name || bill.supplier_name} disabled /></label>
      <label><span>Total</span><input value={money.format(bill.total_amount)} disabled /></label>
      <label><span>Due date</span><input type="date" name="due_date" defaultValue={bill.due_date || ''} /></label>
      <label className="erp-form-wide"><span>Note</span><textarea name="note" defaultValue={bill.note} /></label>
    </div>
    <footer className="erp-form-actions"><button className="primary-button" disabled={working}>{working ? 'Saving…' : 'Save details'}</button></footer>
  </form>
}


export function PaymentForm({ accounts, amount, working, onSubmit }: { accounts: FinancialAccount[]; amount: number; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} required /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" max={amount} step="0.01" defaultValue={amount} required /></label><label><span>Account</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Method</span><select name="payment_method"><option value="bank">Bank</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="cheque">Cheque</option></select></label><label><span>Reference</span><input name="reference_number" /></label><label><span>Description</span><input name="description" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Record payment</button></footer></form> }

export function CompanyLoanForm({ accounts, working, onSubmit }: { accounts: FinancialAccount[]; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Lender</span><input name="lender_name" required /></label><label><span>Loan account number</span><input name="loan_account_number" /></label><label><span>Loan amount</span><input type="number" name="principal_amount" min="0.01" step="0.01" required /></label><label><span>Interest rate %</span><input type="number" name="interest_rate" min="0" step="0.001" /></label><label><span>EMI</span><input type="number" name="emi_amount" min="0" step="0.01" /></label><label><span>Receive money in</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Start date</span><input type="date" name="start_date" defaultValue={today()} required /></label><label><span>End date</span><input type="date" name="end_date" /></label><label><span>Next due date</span><input type="date" name="next_due_date" /></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Create company loan</button></footer></form> }

export function EditCompanyLoanForm({ loan, working, onSubmit }: { loan: CompanyLoan; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const repaid = Math.max(0, loan.principal_amount - loan.outstanding_amount)
  return <form className="erp-form" onSubmit={onSubmit}><div className="inline-warning">The loan amount and start date cannot change. Reverse the loan transaction to fix them.</div><div className="erp-form-grid"><label><span>Lender</span><input name="lender_name" defaultValue={loan.lender_name} required /></label><label><span>Loan account number</span><input name="loan_account_number" defaultValue={loan.loan_account_number} /></label><input type="hidden" name="principal_amount" value={loan.principal_amount} /><label><span>Loan amount</span><input value={money.format(loan.principal_amount)} disabled /></label><label><span>Interest rate %</span><input type="number" name="interest_rate" min="0" step="0.001" defaultValue={loan.interest_rate} /></label><label><span>EMI</span><input type="number" name="emi_amount" min="0" step="0.01" defaultValue={loan.emi_amount} /></label><label><span>Amount repaid</span><input value={money.format(repaid)} disabled /></label><input type="hidden" name="start_date" value={loan.start_date} /><label><span>Start date</span><input value={loan.start_date} disabled /></label><label><span>End date</span><input type="date" name="end_date" defaultValue={loan.end_date || ''} /></label><label><span>Next due date</span><input type="date" name="next_due_date" defaultValue={loan.next_due_date || ''} /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" defaultValue={loan.note} /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>{working ? 'Saving…' : 'Save loan changes'}</button></footer></form>
}

export function LoanPaymentForm({ accounts, amount, working, onSubmit }: { accounts: FinancialAccount[]; amount: number; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <form className="erp-form" onSubmit={onSubmit}><div className="erp-form-grid"><label><span>Date</span><input type="date" name="transaction_date" defaultValue={today()} required /></label><label><span>Amount</span><input type="number" name="amount" min="0.01" step="0.01" defaultValue={amount} required /></label><label><span>Paid from</span><select name="account_id" required><option value="">Select account</option>{accounts.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label><span>Reference</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Note</span><input name="note" /></label></div><footer className="erp-form-actions"><button className="primary-button" disabled={working}>Record loan payment</button></footer></form> }
