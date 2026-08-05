import { FileText, History, Pencil, Plus, Search, Upload } from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'
import type { CustomerFlowSnapshot, CustomerPayment } from '../../contracts/domain-contracts'
import { downloadStoredFile } from '../../api/files'
import { projectDisplayName } from '../../lib/project-name'
import { EmptyState } from '../ui/PageState'
import { dateTime, label, money, shortDate } from './customer-workspace-utils'

export function OverviewTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  const contact = snapshot.customer.contacts[0]
  const rows = [
    ['Full name', snapshot.customer.display_name], ['Phone', contact?.phone], ['Alternate phone', snapshot.customer.alternate_phone], ['Email', contact?.email],
    ['Consumer number', snapshot.customer.consumer_number], ['Electricity provider', snapshot.customer.electricity_provider], ['Customer type', label(snapshot.customer.customer_type)],
    ['Assigned agent', snapshot.customer.assigned_agent_id ? 'Assigned' : 'Unassigned'], ['Lead source', snapshot.customer.lead_source], ['Status', label(snapshot.customer.status)],
    ['Billing address', snapshot.customer.billing_address], ['Installation site', snapshot.customer.site_address], ['District / state', [snapshot.customer.district, snapshot.customer.state, snapshot.customer.postal_code].filter(Boolean).join(', ')],
    ['Created', shortDate.format(new Date(snapshot.customer.created_at))], ['Last updated', dateTime.format(new Date(snapshot.customer.updated_at))],
  ]
  return <div className="detail-grid">{rows.map(([name, value]) => <div className="detail-field" key={name}><span>{name}</span><strong>{value || '—'}</strong></div>)}</div>
}

export function ProjectsTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.projects.length) return <EmptyState title="No project yet" message="Approve a quotation to create the customer project." />
  return <div className="erp-table-wrap customer-tab-table"><table className="erp-table"><thead><tr><th>Project</th><th>Site / capacity</th><th>Payment</th><th>Documentation</th><th>Material</th><th>Installation</th><th>Subsidy</th></tr></thead><tbody>{snapshot.projects.map((row) => <tr key={row.id}><td><strong>{row.record_number}</strong><small>{projectDisplayName(row.name, snapshot.customer.display_name)}</small></td><td>{row.capacity_kw} kW<small>{row.site_address}</small></td><td><span className="soft-badge">{label(row.payment_mode || 'Pending')}</span></td><td>{label(row.documentation_status)}</td><td>{label(row.material_status)}</td><td>{label(row.installation_status)}</td><td>{label(row.subsidy_status)}</td></tr>)}</tbody></table></div>
}

export function TimelineTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.timeline.length) return <EmptyState title="Timeline not created" message="The project timeline starts after quotation approval." />
  return <div className="customer-timeline">{snapshot.timeline.map((row) => <article className={`customer-timeline__row customer-timeline__row--${row.status}`} key={row.key}><span className="customer-timeline__marker" /><div><header><strong>{row.name}</strong><span>{label(row.status)}</span></header><p>{row.note || 'No note added.'}</p><footer>{row.event_date ? shortDate.format(new Date(row.event_date)) : row.completed_at ? dateTime.format(new Date(row.completed_at)) : 'Date pending'}{row.updated_by && ` · ${row.updated_by}`}</footer></div></article>)}</div>
}

export function QuotationsTab({ snapshot, canApprove, working, onApprove }: { snapshot: CustomerFlowSnapshot; canApprove: boolean; working: boolean; onApprove: () => void }) {
  if (!snapshot.quotations.length) return <EmptyState title="No quotations" />
  return <div className="erp-table-wrap customer-tab-table"><table className="erp-table"><thead><tr><th>Quotation</th><th>Date</th><th>Capacity / title</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{snapshot.quotations.map((row, index) => { const rev = row.revisions.find((item) => item.id === row.current_revision_id) ?? row.revisions[0]; return <tr key={row.id}><td><strong>{row.record_number}</strong><small>{rev?.record_number}</small></td><td>{shortDate.format(new Date(row.created_at))}</td><td>{row.title}</td><td>{money.format(Number(rev?.grand_total ?? 0))}</td><td><span className="soft-badge">{label(rev?.status || 'draft')}</span></td><td>{index === 0 && canApprove && rev?.status === 'submitted' && <button className="primary-button primary-button--compact" disabled={working} onClick={onApprove}>Approve</button>}</td></tr> })}</tbody></table></div>
}

export function DocumentsTab({ snapshot, canUpload, working, onUpload }: { snapshot: CustomerFlowSnapshot; canUpload: boolean; working: boolean; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const [documentSearch, setDocumentSearch] = useState('')
  useEffect(() => setDocumentSearch(''), [snapshot.customer.id])
  const normalizedSearch = documentSearch.trim().toLowerCase()
  const visibleDocuments = normalizedSearch
    ? snapshot.documents.filter((row) => [
      row.name,
      label(row.owner_type),
      row.project_id ? 'linked project' : 'customer',
    ].join(' ').toLowerCase().includes(normalizedSearch))
    : snapshot.documents

  return <><div className="tab-toolbar customer-documents-toolbar"><div><strong>Customer documents</strong><span>{visibleDocuments.length} of {snapshot.documents.length} stored files</span></div><div className="customer-documents-toolbar__actions"><label className="customer-document-search"><Search size={14} /><input value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search filename or document type" aria-label="Search customer documents" /></label>{canUpload && <label className="primary-button primary-button--compact"><Upload size={14} /> Upload<input hidden type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" disabled={working} onChange={onUpload} /></label>}</div></div>{!snapshot.documents.length ? <EmptyState title="No documents uploaded" /> : !visibleDocuments.length ? <EmptyState title="No matching documents" message="Try a filename, document type, or project." /> : <div className="erp-table-wrap customer-tab-table"><table className="erp-table"><thead><tr><th>Document</th><th>Type</th><th>Project</th><th>Uploaded</th><th /></tr></thead><tbody>{visibleDocuments.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{label(row.owner_type)}</td><td>{row.project_id ? 'Linked' : 'Customer'}</td><td>{shortDate.format(new Date(row.created_at))}</td><td><button className="secondary-button" onClick={() => void downloadStoredFile(row.id, row.name)}>Download</button></td></tr>)}</tbody></table></div>}</>
}

export function PaymentsTab({ snapshot, approvedValue, totalReceived, balance, canManage, onAdd, onEdit, onBill }: { snapshot: CustomerFlowSnapshot; approvedValue: number; totalReceived: number; balance: number; canManage: boolean; onAdd: () => void; onEdit: (payment: CustomerPayment) => void; onBill: () => void }) {
  return <><section className="mini-kpis payments-summary-grid"><article><span>Approved</span><strong>{money.format(approvedValue)}</strong></article><article><span>Received</span><strong>{money.format(totalReceived)}</strong></article><article><span>Pending</span><strong>{money.format(balance)}</strong></article><article><span>Entries</span><strong>{snapshot.payments.length}</strong></article></section><div className="tab-toolbar payments-toolbar"><div><strong>Customer money</strong></div>{canManage && <div className="payments-toolbar__actions"><button className="secondary-button" onClick={onBill}><FileText size={14} /> Sales bill</button><button className="primary-button primary-button--compact" onClick={onAdd}><Plus size={14} /> Record money</button></div>}</div>{!snapshot.payments.length ? <EmptyState title="No customer transactions" /> : <div className="erp-table-wrap customer-tab-table"><table className="erp-table"><thead><tr><th>Date</th><th>Transaction</th><th>Description</th><th>Account</th><th>Money in</th><th>Money out</th><th>Status</th>{canManage && <th />}</tr></thead><tbody>{snapshot.payments.map((row) => <tr key={row.id}><td>{shortDate.format(new Date(row.transaction_date))}</td><td><strong>{row.transaction_number}</strong><small>{row.reference_number}</small></td><td>{row.description || label(row.source_type)}</td><td>{row.account_name}<small>{label(row.payment_method)}</small></td><td className="money-in">{row.direction === 'credit' ? money.format(Number(row.amount)) : '—'}</td><td className="money-out">{row.direction === 'debit' ? money.format(Number(row.amount)) : '—'}</td><td>{label(row.status)}</td>{canManage && <td><button className="secondary-button secondary-button--compact" onClick={() => onEdit(row)}><Pencil size={13} /> Edit</button></td>}</tr>)}</tbody></table></div>}</>
}

export function LoanTab({ snapshot, canManage, onEdit }: { snapshot: CustomerFlowSnapshot; canManage: boolean; onEdit: () => void }) {
  const loan = snapshot.loan
  return <><div className="tab-toolbar"><div><strong>Customer solar loan</strong><span>Separate from company borrowing.</span></div>{canManage && snapshot.project && <button className="primary-button primary-button--compact" onClick={onEdit}><Pencil size={14} /> {loan ? 'Update' : 'Create'} loan</button>}</div>{!loan ? <EmptyState title="No customer loan record" message="Create it only when the project uses loan payment mode." /> : <div className="detail-grid">{[
    ['Bank', loan.bank_name], ['Application number', loan.application_number], ['Requested', money.format(Number(loan.requested_amount))], ['Approved', money.format(Number(loan.approved_amount))],
    ['Customer contribution', money.format(Number(loan.customer_contribution))], ['Application status', label(loan.application_status)], ['Documents', label(loan.documentation_status)],
    ['First disbursement', money.format(Number(loan.first_disbursement_amount))], ['Second disbursement', money.format(Number(loan.second_disbursement_amount))], ['EMI', money.format(Number(loan.emi_amount))], ['Loan status', label(loan.loan_status)], ['Note', loan.note],
  ].map(([name, value]) => <div className="detail-field" key={name}><span>{name}</span><strong>{value || '—'}</strong></div>)}</div>}</>
}

export function ActivityTab({ snapshot }: { snapshot: CustomerFlowSnapshot }) {
  if (!snapshot.activity.length) return <EmptyState title="No activity yet" />
  return <div className="activity-list">{snapshot.activity.map((row) => <article key={row.id}><span><History size={14} /></span><div><strong>{label(row.event.replace('.', ' '))}</strong><p>{label(row.entity)}{row.project_id ? ' · Project linked' : ''}</p><time>{dateTime.format(new Date(row.created_at))} · {label(row.user_role)}</time></div></article>)}</div>
}
