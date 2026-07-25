import {
  Check,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  decideQuotation,
  decideTransaction,
  generateQuotation,
  getApprovalCenter,
} from '../../lib/api'
import type {
  ApprovalCenter,
  ApprovalDecisionInput,
  GenerateQuotationInput,
  QuotationRequestSummary,
  Session,
  TransactionApprovalSummary,
} from '../../types'
import { useToast } from '../ui/ToastProvider'
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog'
import { QuotationBuilderDialog } from './QuotationBuilderDialog'

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const dateFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })

type DecisionTarget =
  | { kind: 'quotation'; item: QuotationRequestSummary; decision: 'approved' | 'rejected' }
  | { kind: 'transaction'; item: TransactionApprovalSummary; decision: 'approved' | 'rejected' }

function prettyStatus(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function ApprovalCenterPage({ session }: { session: Session }) {
  const [data, setData] = useState<ApprovalCenter>({ quotation_requests: [], transactions: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [builderRequest, setBuilderRequest] = useState<QuotationRequestSummary | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<DecisionTarget | null>(null)
  const { toast } = useToast()

  async function load() {
    setLoading(true)
    try {
      setData(await getApprovalCenter(session.access_token))
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load approvals', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  async function saveQuotation(value: GenerateQuotationInput) {
    if (!builderRequest) return
    setBusy(true)
    try {
      await generateQuotation(session.access_token, builderRequest.id, value)
      setBuilderRequest(null)
      await load()
      toast({ message: 'Quotation saved and queued for approval', variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not save quotation', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function saveDecision(value: ApprovalDecisionInput) {
    if (!decisionTarget) return
    setBusy(true)
    try {
      if (decisionTarget.kind === 'quotation') {
        const quotation = decisionTarget.item.quotation
        if (!quotation) throw new Error('Generate the quotation before making a decision')
        await decideQuotation(session.access_token, quotation.id, value)
      } else {
        await decideTransaction(session.access_token, decisionTarget.item.approval_id, value)
      }
      setDecisionTarget(null)
      await load()
      toast({ message: value.decision === 'approved' ? 'Approval completed' : 'Request rejected', variant: value.decision === 'approved' ? 'success' : 'warning' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not save decision', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const quotationCount = data.quotation_requests.length
  const pendingQuotationCount = data.quotation_requests.filter((item) =>
    !item.quotation || ['pending_approval', 'rejected'].includes(item.quotation.status),
  ).length
  const approvedQuotationCount = data.quotation_requests.filter((item) => item.quotation?.status === 'approved').length
  const pendingTransactionCount = data.transactions.length

  return <section className="approval-page">
    <div className="approval-toolbar">
      <div className="approval-kpis" aria-label="Approval summary">
        <article><span>Total requests</span><strong>{quotationCount}</strong></article>
        <article><span>Pending quotes</span><strong>{pendingQuotationCount}</strong></article>
        <article><span>Approved</span><strong>{approvedQuotationCount}</strong></article>
        <article><span>Transactions</span><strong>{pendingTransactionCount}</strong></article>
      </div>
      <button className="approval-refresh" type="button" onClick={() => void load()} disabled={loading || busy}>
        <RefreshCw size={14} className={loading ? 'is-spinning' : undefined} />
        Refresh
      </button>
    </div>

    <div className="approval-split-layout">
      <section className="approval-panel approval-panel--quotation">
        <header><div><FileCheck2 size={18} /><span><strong>Quotations</strong><small>Request, review and project conversion</small></span></div><em>{data.quotation_requests.length}</em></header>
        {loading ? <div className="approval-empty">Loading quotations…</div> : data.quotation_requests.length === 0 ? <div className="approval-empty">No quotation requests.</div> : <div className="approval-table-wrap"><table className="approval-table approval-table--quotations">
          <thead><tr><th>Customer</th><th>Request</th><th>Quotation</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{data.quotation_requests.map((item) => <tr key={item.id}>
            <td data-label="Customer"><div className="approval-customer-cell"><span className="customer-avatar customer-avatar--small">{item.customer_name.slice(0, 1).toUpperCase()}</span><span><strong>{item.customer_name}</strong><small>{item.company_name || 'Individual customer'}</small><small><UserRound size={11} /> {item.agent_name}</small></span></div></td>
            <td data-label="Request"><strong>{item.requirement_summary}</strong><small>{item.proposed_capacity_kw} kW · {dateFormatter.format(new Date(item.created_at))}</small>{item.project_number && <small className="approval-project-inline"><Check size={11} /> {item.project_number} · {prettyStatus(item.project_status || '')}</small>}</td>
            <td data-label="Quotation">{item.quotation ? <><strong>{currency.format(item.quotation.grand_total)}</strong><small>{item.quotation.quotation_number}</small></> : <span className="approval-muted">Not generated</span>}</td>
            <td data-label="Status"><span className={`workflow-status workflow-status--${item.quotation?.status || item.status}`}>{prettyStatus(item.quotation?.status || item.status)}</span></td>
            <td data-label="Action"><div className="approval-row-actions">
              {(!item.quotation || item.quotation.status === 'rejected') && ['pending', 'quotation_ready', 'rejected'].includes(item.status) && <button className="table-action-button table-action-button--neutral" onClick={() => setBuilderRequest(item)}><FilePlus2 size={13} /> {item.quotation ? 'Revise' : 'Generate'}</button>}
              {item.quotation?.status === 'pending_approval' && <>
                <button className="approval-action approval-action--approve" onClick={() => setDecisionTarget({ kind: 'quotation', item, decision: 'approved' })}><Check size={13} /> Approve</button>
                <button className="approval-action approval-action--reject" onClick={() => setDecisionTarget({ kind: 'quotation', item, decision: 'rejected' })}><X size={13} /> Reject</button>
              </>}
              {item.quotation && !['pending_approval', 'rejected'].includes(item.quotation.status) && <span className="approval-muted">—</span>}
            </div></td>
          </tr>)}</tbody>
        </table></div>}
      </section>

      <section className="approval-panel approval-panel--transactions">
        <header><div><ClipboardCheck size={18} /><span><strong>Transactions</strong><small>Pending entries require approval</small></span></div><em>{data.transactions.length}</em></header>
        {loading ? <div className="approval-empty">Loading transactions…</div> : data.transactions.length === 0 ? <div className="approval-empty">No transactions are waiting for approval.</div> : <div className="approval-table-wrap"><table className="approval-table approval-table--transactions">
          <thead><tr><th>Agent</th><th>Date</th><th>Details</th><th>Amount</th><th>Action</th></tr></thead>
          <tbody>{data.transactions.map((item) => <tr key={item.approval_id}>
            <td data-label="Agent"><strong>{item.agent_name}</strong><small>{item.reference || 'No reference'}</small></td>
            <td data-label="Date">{dateFormatter.format(new Date(item.transaction_date))}</td>
            <td data-label="Details"><strong>{prettyStatus(item.transaction_type)}</strong><small>{item.description}</small></td>
            <td data-label="Amount"><strong>{currency.format(item.credit > 0 ? item.credit : item.debit)}</strong><small>{item.credit > 0 ? 'Credit' : 'Debit'}</small></td>
            <td data-label="Action"><div className="approval-row-actions"><button className="approval-action approval-action--approve" onClick={() => setDecisionTarget({ kind: 'transaction', item, decision: 'approved' })}><Check size={13} /> Approve</button><button className="approval-action approval-action--reject" onClick={() => setDecisionTarget({ kind: 'transaction', item, decision: 'rejected' })}><X size={13} /> Reject</button></div></td>
          </tr>)}</tbody>
        </table></div>}
      </section>
    </div>

    {builderRequest && <QuotationBuilderDialog request={builderRequest} busy={busy} onClose={() => setBuilderRequest(null)} onSubmit={saveQuotation} />}
    {decisionTarget && <ApprovalDecisionDialog title={decisionTarget.kind === 'quotation' ? 'quotation' : 'transaction'} decision={decisionTarget.decision} busy={busy} onClose={() => setDecisionTarget(null)} onSubmit={saveDecision} />}
  </section>
}
