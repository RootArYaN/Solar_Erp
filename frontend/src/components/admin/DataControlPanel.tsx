import { Activity, History, RefreshCw, RotateCcw, Search, Trash2, Wrench } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getAuditHistory, getDataHealth, getDeletedCustomers, getInventoryMovementHistory, restoreDeletedCustomer, type DataHealthSummary } from '../../api/data-control'
import type { Customer } from '../../contracts/domain-contracts'
import type { InventoryMovement } from '../../erp-types'
import type { AuditEvent } from '../../types'
import { Button } from '../ui/Button'
import { EmptyState, LoadingSkeleton } from '../ui/PageState'
import { Field } from '../ui/Field'
import { Pagination } from '../ui/Pagination'
import { useToast } from '../ui/ToastProvider'
import { TabButton, TabStrip } from '../workspace'

type DataTab = 'deleted' | 'corrections' | 'reversals' | 'audit' | 'health'

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function DataControlPanel() {
  const [tab, setTab] = useState<DataTab>('deleted')
  const [query, setQuery] = useState('')
  const [deleted, setDeleted] = useState<Customer[]>([])
  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [health, setHealth] = useState<DataHealthSummary | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 50
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'deleted') {
        const result = await getDeletedCustomers(query, page, pageSize)
        setDeleted(result.items)
        setTotal(result.total ?? result.items.length)
      } else if (tab === 'corrections' || tab === 'reversals') {
        const result = await getInventoryMovementHistory(tab === 'corrections' ? 'corrected' : 'reversed', page, pageSize)
        setMovements(result.data)
        setTotal(result.total)
      } else if (tab === 'audit') {
        const result = await getAuditHistory(query, page, pageSize)
        setEvents(result.data)
        setTotal(result.total)
      } else {
        setHealth(await getDataHealth())
        setTotal(0)
      }
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load data-control history', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [page, query, tab, toast])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, query.trim() ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function restore(customer: Customer) {
    setBusyId(customer.id)
    try {
      await restoreDeletedCustomer(customer.id, 'Restored from Administration → Data Control')
      await load()
      toast({ message: `${customer.display_name} restored`, variant: 'success' })
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not restore customer', variant: 'error' })
    } finally {
      setBusyId('')
    }
  }

  return (
    <section className="data-panel">
      <div className="data-panel__toolbar">
        <TabStrip className="segmented-tabs" label="Data control sections">
          <TabButton active={tab === 'deleted'} onClick={() => { setTab('deleted'); setQuery(''); setPage(1) }}><Trash2 size={14} /> Deleted</TabButton>
          <TabButton active={tab === 'corrections'} onClick={() => { setTab('corrections'); setQuery(''); setPage(1) }}><Wrench size={14} /> Corrections</TabButton>
          <TabButton active={tab === 'reversals'} onClick={() => { setTab('reversals'); setQuery(''); setPage(1) }}><RotateCcw size={14} /> Reversals</TabButton>
          <TabButton active={tab === 'audit'} onClick={() => { setTab('audit'); setQuery(''); setPage(1) }}><History size={14} /> Audit</TabButton>
          <TabButton active={tab === 'health'} onClick={() => { setTab('health'); setQuery(''); setPage(1) }}><Activity size={14} /> Data Health</TabButton>
        </TabStrip>
        {(tab === 'deleted' || tab === 'audit') && <Field label="Search data control" hideLabel prefix={<Search size={15} />}><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={tab === 'deleted' ? 'Customer name, phone, ID…' : 'Event, entity, ID, role…'} /></Field>}
        <Button size="icon" variant="ghost" aria-label="Refresh data control" onClick={() => void load()}><RefreshCw size={15} /></Button>
      </div>

      {loading ? <LoadingSkeleton rows={6} /> : tab === 'deleted' ? (
        deleted.length ? <div className="user-table-wrap"><table className="user-table"><thead><tr><th>Customer</th><th>Status</th><th>Balance</th><th>Deleted</th><th /></tr></thead><tbody>
          {deleted.map((row) => <tr key={row.id}><td><strong>{row.display_name}</strong><small>{row.record_number}</small></td><td><span className="status-badge">Deleted</span></td><td>₹{Number(row.outstanding_balance || 0).toLocaleString('en-IN')}</td><td>{row.deleted_at ? dateTime.format(new Date(row.deleted_at)) : '—'}</td><td><Button size="compact" disabled={busyId === row.id} onClick={() => void restore(row)}>{busyId === row.id ? 'Restoring…' : 'Restore'}</Button></td></tr>)}
        </tbody></table></div> : <EmptyState title="No deleted customers" />
      ) : tab === 'audit' ? (
        events.length ? <div className="user-table-wrap"><table className="user-table"><thead><tr><th>Event</th><th>Entity</th><th>Actor</th><th>Date</th></tr></thead><tbody>
          {events.map((row) => <tr key={row.id}><td><strong>{title(row.event)}</strong><small>{row.request_id || 'No request ID'}</small></td><td>{title(row.entity)}<small>{row.entity_id}</small></td><td>{title(row.user_role)}</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}
        </tbody></table></div> : <EmptyState title="No audit events found" />
      ) : tab === 'health' ? (
        health ? <div className="user-table-wrap"><table className="user-table"><thead><tr><th>Check</th><th>State</th><th>Count</th><th>Details</th></tr></thead><tbody>
          {health.checks.map((row) => <tr key={row.key}><td><strong>{row.label}</strong><small>{row.description}</small></td><td><span className={`status-badge ${row.severity === 'ok' ? 'status-badge--active' : ''}`}>{title(row.severity)}</span></td><td>{row.count}</td><td>{row.sample_ids.length ? <small>Samples: {row.sample_ids.join(', ')}</small> : 'Clean'}</td></tr>)}
        </tbody></table></div> : <EmptyState title="Data Health unavailable" />
      ) : movements.length ? (
        <div className="user-table-wrap"><table className="user-table"><thead><tr><th>Movement</th><th>Item</th><th>Quantity</th><th>Reason</th><th>Date</th></tr></thead><tbody>
          {movements.map((row) => <tr key={row.id}><td><strong>{row.reference_number}</strong><small>{title(row.movement_type)} · {title(row.status)}</small></td><td>{row.item_name}</td><td>{row.corrected_quantity != null ? `${row.quantity} → ${row.corrected_quantity}` : row.quantity}</td><td>{row.reason || '—'}</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}
        </tbody></table></div>
      ) : <EmptyState title={tab === 'corrections' ? 'No corrected movements' : 'No reversed movements'} />}
      {tab !== 'health' && <Pagination page={page} pageSize={pageSize} total={total} loading={loading} onPageChange={setPage} />}
    </section>
  )
}
