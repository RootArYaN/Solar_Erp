import { AlertTriangle, Boxes, Download, IndianRupee, PackagePlus, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Warehouse, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { correctInventoryMovement, createInventoryItem, createInventoryLocation, createInventoryMovementBatch, getInventoryMovements, getInventorySummary, reverseInventoryMovement, updateInventoryItem, updateInventoryLocation } from '../../api/operations'
import type { InventoryItem, InventoryLocation, InventoryMovement, InventorySummary } from '../../erp-types'
import { downloadInventoryChallanPdf } from '../../lib/inventory-challan'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { EntityEditDialog } from '../editing/EntityEditDialog'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { Pagination } from '../ui/Pagination'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, TabButton, TabStrip, WorkspaceHeader, WorkspacePage } from '../workspace'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

function formObject(form: HTMLFormElement): Record<string, unknown> {
  const entries = Object.fromEntries(new FormData(form).entries())
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => key.endsWith('_quantity') || ['unit_cost', 'reorder_level', 'quantity'].includes(key) ? [key, Number(value || 0)] : [key, value]))
}

type MovementDirection = 'inward' | 'outward'
type EntryMode = 'individual' | 'multiple'
type EndpointMode = 'stored' | 'manual'
type MovementLine = {
  key: string
  item_id: string
  quantity: string
  stock_location_id: string
  endpoint_mode: EndpointMode
  endpoint_location_id: string
  endpoint_manual: string
}

function newMovementLine(itemId = '', stockLocationId = ''): MovementLine {
  return {
    key: `${Date.now()}-${Math.random()}`,
    item_id: itemId,
    quantity: '',
    stock_location_id: stockLocationId,
    endpoint_mode: 'manual',
    endpoint_location_id: '',
    endpoint_manual: '',
  }
}

function MovementDialog({ items, locations, initialItem, initialDirection, working, onClose, onSubmit }: {
  items: InventoryItem[]
  locations: InventoryLocation[]
  initialItem: InventoryItem | null
  initialDirection: MovementDirection
  working: boolean
  onClose: () => void
  onSubmit: (body: Record<string, unknown>) => Promise<void>
}) {
  const [direction, setDirection] = useState<MovementDirection>(initialDirection)
  const [entryMode, setEntryMode] = useState<EntryMode>('individual')
  const [lines, setLines] = useState<MovementLine[]>([newMovementLine(initialItem?.id, initialItem?.location_id ?? '')])

  function updateLine(key: string, patch: Partial<MovementLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  function changeEntryMode(mode: EntryMode) {
    setEntryMode(mode)
    if (mode === 'individual') setLines((current) => [current[0] ?? newMovementLine(initialItem?.id, initialItem?.location_id ?? '')])
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const details = formObject(event.currentTarget)
    const movementLines = lines.map((line) => ({
      item_id: line.item_id,
      quantity: Number(line.quantity),
      source_location_id: direction === 'outward'
        ? line.stock_location_id
        : line.endpoint_mode === 'stored' ? line.endpoint_location_id || null : null,
      destination_location_id: direction === 'inward'
        ? line.stock_location_id
        : line.endpoint_mode === 'stored' ? line.endpoint_location_id || null : null,
      source_location_manual: direction === 'inward' && line.endpoint_mode === 'manual' ? line.endpoint_manual : '',
      destination_location_manual: direction === 'outward' && line.endpoint_mode === 'manual' ? line.endpoint_manual : '',
    }))
    await onSubmit({ ...details, movement_type: direction, lines: movementLines })
  }

  const otherSideLabel = direction === 'inward' ? 'Coming from' : 'Going to'

  return <Modal className="inventory-movement-modal" title="Inventory inward / outward" subtitle="Choose an individual or multiple entry. Manual places stay separate from saved locations." onClose={onClose}>
    <form className="erp-form inventory-movement-form" onSubmit={submit}>
      <section className="movement-choice">
        <span>Movement</span>
        <div>
          <button type="button" className={direction === 'inward' ? 'is-active' : ''} onClick={() => setDirection('inward')}>Inward</button>
          <button type="button" className={direction === 'outward' ? 'is-active' : ''} onClick={() => setDirection('outward')}>Outward</button>
        </div>
      </section>
      <section className="movement-choice">
        <span>Entry type</span>
        <div>
          <button type="button" className={entryMode === 'individual' ? 'is-active' : ''} onClick={() => changeEntryMode('individual')}>Individual</button>
          <button type="button" className={entryMode === 'multiple' ? 'is-active' : ''} onClick={() => changeEntryMode('multiple')}>Multiple items / locations</button>
        </div>
      </section>

      <section className="movement-lines">
        <header><div><strong>{direction === 'inward' ? 'Items received' : 'Items dispatched'}</strong><small>Set the location for each row.</small></div>{entryMode === 'multiple' && <button type="button" className="secondary-button secondary-button--compact" onClick={() => setLines((current) => [...current, newMovementLine()])}><Plus size={14} /> Add row</button>}</header>
        {lines.map((line, index) => <article key={line.key} className="movement-line">
          <span className="movement-line__number">{index + 1}</span>
          <label><span>Item</span><select required value={line.item_id} onChange={(event) => updateLine(line.key, { item_id: event.target.value })}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
          <label><span>Quantity</span><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
          <label><span>{direction === 'inward' ? 'Inventory destination' : 'Inventory source'}</span><select required value={line.stock_location_id} onChange={(event) => updateLine(line.key, { stock_location_id: event.target.value })}><option value="">Select saved location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <div className="movement-endpoint">
            <span>{otherSideLabel}</span>
            <div className="movement-endpoint__toggle">
              <button type="button" className={line.endpoint_mode === 'manual' ? 'is-active' : ''} onClick={() => updateLine(line.key, { endpoint_mode: 'manual', endpoint_location_id: '' })}>Manual</button>
              <button type="button" className={line.endpoint_mode === 'stored' ? 'is-active' : ''} onClick={() => updateLine(line.key, { endpoint_mode: 'stored', endpoint_manual: '' })}>Saved</button>
            </div>
            {line.endpoint_mode === 'manual'
              ? <input aria-label={`${otherSideLabel} manual location`} required placeholder="Type supplier, site or address" value={line.endpoint_manual} onChange={(event) => updateLine(line.key, { endpoint_manual: event.target.value })} />
              : <select aria-label={`${otherSideLabel} saved location`} required value={line.endpoint_location_id} onChange={(event) => updateLine(line.key, { endpoint_location_id: event.target.value })}><option value="">Select saved location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select>}
          </div>
          {entryMode === 'multiple' && lines.length > 1 && <button type="button" className="movement-line__remove" aria-label={`Remove row ${index + 1}`} onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}><Trash2 size={15} /></button>}
        </article>)}
      </section>

      <fieldset className="movement-details">
        <legend>Challan & transport details</legend>
        <div className="erp-form-grid">
          <label><span>Challan number</span><input name="reference_number" placeholder="Auto-generated if blank" /></label>
          <label><span>Challan date</span><input name="challan_date" type="date" /></label>
          <label><span>Party / supplier</span><input name="supplier_name" /></label>
          <label><span>Transporter</span><input name="transporter_name" /></label>
          <label><span>Vehicle number</span><input name="vehicle_number" placeholder="GJ 01 AB 1234" /></label>
          <label><span>Driver name</span><input name="driver_name" /></label>
          <label><span>Driver phone</span><input name="driver_phone" type="tel" /></label>
          <label><span>E-way bill number</span><input name="eway_bill_number" /></label>
          <label className="erp-form-wide"><span>Other details / note</span><textarea name="note" /></label>
        </div>
      </fieldset>
      <footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={working}>{working ? 'Posting…' : `Post ${lines.length} ${lines.length === 1 ? 'entry' : 'entries'}`}</button></footer>
    </form>
  </Modal>
}

export function InventoryPage({ session }: { session: Session }) {
  const [data, setData] = useState<InventorySummary | null>(null)
  const [search, setSearch] = useState('')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [itemPage, setItemPage] = useState(1)
  const itemPageSize = 50
  const [activeView, setActiveView] = useState<'stock' | 'history'>('stock')
  const [historyDirection, setHistoryDirection] = useState<'all' | MovementDirection>('all')
  const [historyRows, setHistoryRows] = useState<InventoryMovement[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [movementDirection, setMovementDirection] = useState<MovementDirection>('inward')
  const [modal, setModal] = useState<'item' | 'edit-item' | 'movement' | 'location' | 'edit-location' | 'correct-movement' | 'reverse-movement' | null>(null)
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovement | null>(null)
  const [generatedChallan, setGeneratedChallan] = useState<InventoryMovement[]>([])
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<InventoryLocation | null>(null)
  const [editDirty, setEditDirty] = useState(false)
  const [editError, setEditError] = useState('')
  const [editConflict, setEditConflict] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'inventory')
  const { toast } = useToast()

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await getInventorySummary({
        page: itemPage,
        pageSize: itemPageSize,
        query: inventoryQuery,
        category: category === 'All' ? undefined : category,
      })
      setData(result)
      if (result.item_page !== itemPage) setItemPage(result.item_page)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load inventory') }
  }, [category, inventoryQuery, itemPage])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setItemPage(1)
      setInventoryQuery(search.trim())
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [search])

  const categories = useMemo(() => ['All', ...(data?.item_categories ?? [])], [data?.item_categories])
  const items = data?.items ?? []
  const movementHistory = historyRows

  const loadHistory = useCallback(async (page = historyPage) => {
    setHistoryLoading(true)
    try {
      const result = await getInventoryMovements({ movementType: historyDirection === 'all' ? undefined : historyDirection, page, pageSize: 50 })
      setHistoryRows(result.data)
      setHistoryTotal(result.total)
      setHistoryPage(result.page)
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Could not load inventory history', variant: 'error' })
    } finally { setHistoryLoading(false) }
  }, [historyDirection, historyPage, toast])

  useEffect(() => {
    if (activeView === 'history') void loadHistory(1)
  }, [activeView, historyDirection])

  async function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true)
    try { await createInventoryItem(formObject(event.currentTarget)); setModal(null); await load(); toast({ message: 'Inventory item created', variant: 'success' }) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create item', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true)
    try { await createInventoryLocation(formObject(event.currentTarget)); setModal(null); await load(); toast({ message: 'Inventory location created', variant: 'success' }) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not create location', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitItemEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; setWorking(true); setEditError(''); setEditConflict(false)
    try {
      const body = formObject(event.currentTarget); body.is_active = new FormData(event.currentTarget).has('is_active'); await updateInventoryItem(selected.id, body); setModal(null); setSelected(null); setEditDirty(false); await load(); toast({ message: 'Inventory item updated', variant: 'success' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not update item'
      setEditError(message); setEditConflict(message.toLowerCase().includes('updated by another user') || message.includes('409'))
    } finally { setWorking(false) }
  }

  async function submitLocationEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedLocation) return; setWorking(true); setEditError(''); setEditConflict(false)
    try {
      const body = formObject(event.currentTarget); body.is_active = new FormData(event.currentTarget).has('is_active'); await updateInventoryLocation(selectedLocation.id, body); setModal(null); setSelectedLocation(null); setEditDirty(false); await load(); toast({ message: 'Inventory location updated', variant: 'success' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not update location'
      setEditError(message); setEditConflict(message.toLowerCase().includes('updated by another user') || message.includes('409'))
    } finally { setWorking(false) }
  }

  async function submitMovementBatch(body: Record<string, unknown>) {
    setWorking(true)
    try {
      if (!body.challan_date) body.challan_date = null
      const posted = await createInventoryMovementBatch(body)
      setModal(null); setSelected(null); setGeneratedChallan(posted); await load()
      toast({ message: `${posted.length} inventory ${posted.length === 1 ? 'entry' : 'entries'} posted`, variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not post inventory entries', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitMovementCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedMovement) return
    const form = new FormData(event.currentTarget)
    setWorking(true)
    try {
      await correctInventoryMovement(selectedMovement.id, Number(form.get('quantity') || 0), String(form.get('reason') || ''))
      setModal(null); setSelectedMovement(null); await Promise.all([load(), loadHistory(historyPage)])
      toast({ message: 'Inventory movement corrected with reversal history preserved', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not correct inventory movement', variant: 'error' }) }
    finally { setWorking(false) }
  }

  async function submitMovementReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedMovement) return
    const form = new FormData(event.currentTarget)
    setWorking(true)
    try {
      await reverseInventoryMovement(selectedMovement.id, String(form.get('reason') || ''))
      setModal(null); setSelectedMovement(null); await Promise.all([load(), loadHistory(historyPage)])
      toast({ message: 'Inventory movement reversed', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not reverse inventory movement', variant: 'error' }) }
    finally { setWorking(false) }
  }

  if (!data && !error) return <WorkspacePage className="erp-page"><LoadingSkeleton rows={7} /></WorkspacePage>
  if (!data) return <WorkspacePage className="erp-page"><ErrorState message={error} onRetry={() => void load()} /></WorkspacePage>

  return <WorkspacePage className="erp-page inventory-page">
    <WorkspaceHeader className="erp-page-head"><div><span>Operations</span><h1>Inventory</h1></div><div className="erp-head-actions inventory-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canEdit && <button className="secondary-button inventory-action--inward" onClick={() => { setSelected(null); setMovementDirection('inward'); setModal('movement') }}><PackagePlus size={15} /> Inward</button>}{access.canEdit && <button className="secondary-button inventory-action--outward" onClick={() => { setSelected(null); setMovementDirection('outward'); setModal('movement') }}><PackagePlus size={15} /> Outward</button>}{access.canCreate && <button className="secondary-button" onClick={() => setModal('location')}><Warehouse size={15} /> Location</button>}{access.canCreate && <button className="primary-button" onClick={() => setModal('item')}><Plus size={15} /> Add item</button>}</div></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}

    <KpiGrid columns={4} phoneColumns={2} responsive className="erp-kpi-grid"><article><Boxes /><span>Active items</span><strong>{data.total_items}</strong><small>{number.format(data.total_quantity)} units on hand</small></article><article><AlertTriangle /><span>Low stock</span><strong>{data.low_stock_items}</strong><small>At or below reorder level</small></article><article><IndianRupee /><span>Stock value</span><strong>{money.format(data.stock_value)}</strong><small>Based on current unit cost</small></article><article><Warehouse /><span>Locations</span><strong>{data.locations.length}</strong><small>Active storage locations</small></article></KpiGrid>

    <TabStrip className="erp-tabs inventory-main-tabs" label="Inventory views">
      <TabButton active={activeView === 'stock'} onClick={() => setActiveView('stock')}><Boxes size={14} /> Stock & locations</TabButton>
      <TabButton active={activeView === 'history'} onClick={() => setActiveView('history')}><RefreshCw size={14} /> Inventory history</TabButton>
    </TabStrip>

    <div className="inventory-workspace-body">
      {activeView === 'stock' && <div className="inventory-stock-grid" role="tabpanel">
        <section className="erp-panel inventory-items-panel"><div className="erp-toolbar"><label className="erp-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, SKU, supplier or location" /></label><select value={category} onChange={(event) => { setCategory(event.target.value); setItemPage(1) }}>{categories.map((row) => <option key={row}>{row}</option>)}</select></div>
          {items.length ? <><div className="erp-table-wrap"><table className="erp-table inventory-table inventory-items-table"><thead><tr><th>Item</th><th>Category</th><th>Location</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Unit cost</th><th>Status</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="Item"><strong>{item.name}</strong><small>{item.sku} · {item.supplier_name || 'No supplier'}</small></td><td data-label="Category">{item.category}</td><td data-label="Location">{item.location_name || '—'}</td><td data-label="On hand">{number.format(item.quantity_on_hand)} {item.unit}</td><td data-label="Reserved">{number.format(item.reserved_quantity)}</td><td data-label="Available"><strong>{number.format(item.available_quantity)}</strong></td><td data-label="Unit cost">{money.format(item.unit_cost)}</td><td data-label="Status"><span className={`soft-badge ${item.low_stock ? 'soft-badge--warning' : 'soft-badge--success'}`}>{item.low_stock ? 'Low stock' : 'Available'}</span></td><td data-label="Actions">{access.canEdit && <div className="table-row-actions"><button className="secondary-button secondary-button--compact" onClick={() => { setSelected(item); setEditDirty(false); setEditError(''); setEditConflict(false); setModal('edit-item') }}><Pencil size={14} /> Edit</button><button className="secondary-button secondary-button--compact" onClick={() => { setSelected(item); setMovementDirection('outward'); setModal('movement') }}><PackagePlus size={14} /> Outward</button></div>}</td></tr>)}</tbody></table></div><Pagination className="inventory-items-pagination" page={data.item_page} pageSize={data.item_page_size} total={data.item_total} onPageChange={setItemPage} /></> : <EmptyState title="No inventory items found" message="Change the filters or add the first item." />}
        </section>

        <section className="erp-panel inventory-locations-panel"><header><div><span>Storage master</span><h2>Locations</h2></div></header><div className="erp-table-wrap"><table className="erp-table inventory-table inventory-locations-table"><thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Status</th><th /></tr></thead><tbody>{data.locations.map((row) => <tr key={row.id}><td data-label="Location"><strong>{row.name}</strong></td><td data-label="Type">{row.location_type.replaceAll('_', ' ')}</td><td data-label="Address">{row.address || '—'}</td><td data-label="Status"><span className={`soft-badge ${row.is_active ? 'soft-badge--success' : ''}`}>{row.is_active ? 'Active' : 'Inactive'}</span></td><td data-label="Actions">{access.canEdit && <button className="secondary-button secondary-button--compact" onClick={() => { setSelectedLocation(row); setEditDirty(false); setEditError(''); setEditConflict(false); setModal('edit-location') }}><Pencil size={14} /></button>}</td></tr>)}</tbody></table></div></section>
      </div>}

      {activeView === 'history' && <section className="erp-panel inventory-history-panel" role="tabpanel"><header><div><span>Inventory history</span><h2>Movement ledger</h2></div><TabStrip className="erp-tabs inventory-history-tabs" label="Inventory history direction">{(['all', 'inward', 'outward'] as const).map((option) => <TabButton key={option} active={historyDirection === option} onClick={() => { setHistoryPage(1); setHistoryDirection(option) }}>{option}</TabButton>)}</TabStrip></header>{historyLoading ? <LoadingSkeleton rows={5} /> : movementHistory.length ? <><div className="erp-table-wrap"><table className="erp-table inventory-table inventory-history-table"><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Quantity</th><th>From</th><th>To</th><th>Challan</th><th>Status</th><th /></tr></thead><tbody>{movementHistory.map((row) => <tr key={row.id}><td data-label="Date">{shortDate.format(new Date(row.created_at))}</td><td data-label="Item"><strong>{row.item_name}</strong><small>{row.partner_name}</small></td><td data-label="Movement"><span className={`soft-badge ${row.movement_type === 'inward' ? 'soft-badge--success' : 'soft-badge--warning'}`}>{row.movement_type.replaceAll('_', ' ')}</span></td><td data-label="Quantity">{number.format(row.quantity)}</td><td data-label="From">{row.source_location_name || row.source_location_manual || '—'}</td><td data-label="To">{row.destination_location_name || row.destination_location_manual || '—'}</td><td data-label="Challan"><strong>{row.reference_number || '—'}</strong><small>{row.challan_date || ''}</small></td><td data-label="Status"><span className="soft-badge">{row.correction_of_movement_id ? 'corrected replacement' : row.status}</span>{row.reason && <small>{row.reason}</small>}</td><td data-label="Actions"><div className="table-row-actions"><button type="button" className="secondary-button secondary-button--compact" onClick={() => downloadInventoryChallanPdf([row], session.company.name, session.user.full_name)} aria-label={`Download challan ${row.reference_number}`} title="Download challan"><Download size={13} /></button>{session.user.is_super_admin && row.status === 'completed' && !row.correction_of_movement_id && ['inward','outward','transfer','project_dispatch','project_return','supplier_return'].includes(row.movement_type) && <><button className="secondary-button secondary-button--compact" onClick={() => { setSelectedMovement(row); setModal('correct-movement') }} aria-label={`Correct ${row.reference_number}`} title="Correct movement"><Wrench size={13} /></button><button className="secondary-button secondary-button--compact" onClick={() => { setSelectedMovement(row); setModal('reverse-movement') }} aria-label={`Reverse ${row.reference_number}`} title="Reverse movement"><RotateCcw size={13} /></button></>}</div></td></tr>)}</tbody></table></div><Pagination className="inventory-history-pagination" page={historyPage} pageSize={50} total={historyTotal} loading={historyLoading} onPageChange={(page) => void loadHistory(page)} /></> : <EmptyState title={`No ${historyDirection === 'all' ? '' : `${historyDirection} `}inventory history`} message="Posted inventory entries appear here." />}</section>}
    </div>

    {modal === 'item' && <Modal title="Add inventory item" subtitle="Create the item and its opening balance in one step." onClose={() => setModal(null)}><form className="erp-form" onSubmit={submitItem}><div className="erp-form-grid"><label><span>SKU</span><input name="sku" required /></label><label><span>Item name</span><input name="name" required /></label><label><span>Category</span><input name="category" defaultValue="Solar Panels" required /></label><label><span>Unit</span><input name="unit" defaultValue="Nos" required /></label><label><span>Supplier</span><input name="supplier_name" /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" name="unit_cost" defaultValue="0" /></label><label><span>Reorder level</span><input type="number" min="0" step="0.001" name="reorder_level" defaultValue="0" /></label><label><span>Location</span><select name="location_id" required><option value="">Select location</option>{data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>Opening quantity</span><input type="number" min="0" step="0.001" name="opening_quantity" defaultValue="0" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Create item</button></footer></form></Modal>}

    {modal === 'location' && <Modal title="Add inventory location" subtitle="Keep warehouses and project stores simple." onClose={() => setModal(null)}><form className="erp-form" onSubmit={submitLocation}><div className="erp-form-grid"><label><span>Name</span><input name="name" required /></label><label><span>Type</span><select name="location_type"><option value="warehouse">Warehouse</option><option value="store">Store</option><option value="project_site">Project site</option></select></label><label className="erp-form-wide"><span>Address</span><textarea name="address" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Create location</button></footer></form></Modal>}

    {modal === 'edit-item' && selected && <EntityEditDialog title="Edit inventory item" subtitle="Stock quantity remains controlled by movements." isDirty={editDirty} isSaving={working} error={editError} conflict={editConflict} onClose={() => { setModal(null); setSelected(null) }} onReload={() => { setModal(null); setSelected(null); void load() }} onSave={() => document.getElementById('inventory-item-edit-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))}><form id="inventory-item-edit-form" className="erp-form" onSubmit={submitItemEdit} onChange={() => setEditDirty(true)}><input type="hidden" name="version" value={selected.version} /><div className="erp-form-grid"><label><span>SKU</span><input name="sku" defaultValue={selected.sku} required /></label><label><span>Item name</span><input name="name" defaultValue={selected.name} required /></label><label><span>Category</span><input name="category" defaultValue={selected.category} required /></label><label><span>Unit</span><input name="unit" defaultValue={selected.unit} required /></label><label><span>Supplier</span><input name="supplier_name" defaultValue={selected.supplier_name} /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" name="unit_cost" defaultValue={selected.unit_cost} /></label><label><span>Reorder level</span><input type="number" min="0" step="0.001" name="reorder_level" defaultValue={selected.reorder_level} /></label><label className="checkbox-row"><input type="checkbox" name="is_active" value="true" defaultChecked={selected.is_active} /><span>Active item</span></label></div></form></EntityEditDialog>}

    {modal === 'edit-location' && selectedLocation && <EntityEditDialog title="Edit inventory location" isDirty={editDirty} isSaving={working} error={editError} conflict={editConflict} onClose={() => { setModal(null); setSelectedLocation(null) }} onReload={() => { setModal(null); setSelectedLocation(null); void load() }} onSave={() => document.getElementById('inventory-location-edit-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))}><form id="inventory-location-edit-form" className="erp-form" onSubmit={submitLocationEdit} onChange={() => setEditDirty(true)}><input type="hidden" name="version" value={selectedLocation.version} /><div className="erp-form-grid"><label><span>Name</span><input name="name" defaultValue={selectedLocation.name} required /></label><label><span>Type</span><select name="location_type" defaultValue={selectedLocation.location_type}><option value="warehouse">Warehouse</option><option value="store">Store</option><option value="project_site">Project site</option></select></label><label className="erp-form-wide"><span>Address</span><textarea name="address" defaultValue={selectedLocation.address} /></label><label className="checkbox-row"><input type="checkbox" name="is_active" value="true" defaultChecked={selectedLocation.is_active} /><span>Active location</span></label></div></form></EntityEditDialog>}

    {modal === 'correct-movement' && selectedMovement && <Modal title={`Correct ${selectedMovement.reference_number}`} subtitle="The original finalized movement stays intact. A reversal and corrected replacement are appended." onClose={() => !working && setModal(null)}><form className="erp-form" onSubmit={submitMovementCorrection}><div className="erp-form-grid"><label><span>Correct quantity</span><input name="quantity" type="number" min="0.001" step="0.001" defaultValue={selectedMovement.quantity} required /></label><label className="erp-form-wide"><span>Reason</span><textarea name="reason" minLength={3} required placeholder="Why is this correction needed?" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Apply correction</button></footer></form></Modal>}
    {modal === 'reverse-movement' && selectedMovement && <Modal title={`Reverse ${selectedMovement.reference_number}`} subtitle="This posts the opposite stock effect and preserves the original movement." onClose={() => !working && setModal(null)}><form className="erp-form" onSubmit={submitMovementReversal}><label><span>Reason</span><textarea name="reason" minLength={3} required placeholder="Why is this movement being reversed?" /></label><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Reverse movement</button></footer></form></Modal>}
    {modal === 'movement' && <MovementDialog items={data.items} locations={data.locations} initialItem={selected} initialDirection={movementDirection} working={working} onClose={() => { setModal(null); setSelected(null) }} onSubmit={submitMovementBatch} />}
    {!!generatedChallan.length && <Modal title="Challan ready" subtitle={`${generatedChallan[0].reference_number} · ${generatedChallan.length} ${generatedChallan.length === 1 ? 'item' : 'items'} posted`} onClose={() => setGeneratedChallan([])}><div className="erp-form"><div className="customer-lifecycle-impact"><strong>System-formatted challan</strong><p>Includes item quantities, locations, party, transport, vehicle, driver, e-way bill and acknowledgement details.</p></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setGeneratedChallan([])}>Close</button><button type="button" className="primary-button" onClick={() => downloadInventoryChallanPdf(generatedChallan, session.company.name, session.user.full_name)}><Download size={14} /> Download challan</button></footer></div></Modal>}
  </WorkspacePage>
}
