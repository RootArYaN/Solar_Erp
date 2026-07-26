import { AlertTriangle, Boxes, IndianRupee, PackagePlus, Plus, RefreshCw, Search, Warehouse } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { createInventoryItem, createInventoryLocation, createInventoryMovement, getInventorySummary } from '../../api/operations'
import type { InventoryItem, InventorySummary } from '../../erp-types'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { Modal } from '../admin/Modal'
import { EmptyState, ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
const shortDate = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

function formObject(form: HTMLFormElement): Record<string, unknown> {
  const entries = Object.fromEntries(new FormData(form).entries())
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => key.endsWith('_quantity') || ['unit_cost', 'reorder_level', 'quantity'].includes(key) ? [key, Number(value || 0)] : [key, value]))
}

export function InventoryPage({ session }: { session: Session }) {
  const [data, setData] = useState<InventorySummary | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [modal, setModal] = useState<'item' | 'movement' | 'location' | null>(null)
  const [selected, setSelected] = useState<InventoryItem | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const access = getModuleAccess(session, 'inventory')
  const { toast } = useToast()

  const load = useCallback(async () => {
    setError('')
    try { setData(await getInventorySummary()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load inventory') }
  }, [])

  useEffect(() => { void load() }, [load])

  const categories = useMemo(() => ['All', ...Array.from(new Set((data?.items ?? []).map((item) => item.category))).sort()], [data])
  const items = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.items ?? []).filter((item) => (category === 'All' || item.category === category) && (!term || `${item.sku} ${item.name} ${item.supplier_name} ${item.location_name}`.toLowerCase().includes(term)))
  }, [category, data, search])

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

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true)
    try {
      const body = formObject(event.currentTarget)
      for (const key of ['source_location_id', 'destination_location_id', 'project_id', 'customer_id']) if (!body[key]) body[key] = null
      await createInventoryMovement(body); setModal(null); setSelected(null); await load(); toast({ message: 'Stock movement posted', variant: 'success' })
    } catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not post movement', variant: 'error' }) }
    finally { setWorking(false) }
  }

  if (!data && !error) return <section className="erp-page"><LoadingSkeleton rows={7} /></section>
  if (!data) return <section className="erp-page"><ErrorState message={error} onRetry={() => void load()} /></section>

  return <section className="erp-page">
    <header className="erp-page-head"><div><span>Operations</span><h1>Inventory</h1><p>Live warehouse balances and movement history connected to customer projects.</p></div><div className="erp-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canCreate && <button className="secondary-button" onClick={() => setModal('location')}><Warehouse size={15} /> Location</button>}{access.canCreate && <button className="primary-button" onClick={() => setModal('item')}><Plus size={15} /> Add item</button>}</div></header>
    {access.readOnly && <ReadOnlyNotice />}

    <div className="erp-kpi-grid"><article><Boxes /><span>Active items</span><strong>{data.total_items}</strong><small>{number.format(data.total_quantity)} units on hand</small></article><article><AlertTriangle /><span>Low stock</span><strong>{data.low_stock_items}</strong><small>At or below reorder level</small></article><article><IndianRupee /><span>Stock value</span><strong>{money.format(data.stock_value)}</strong><small>Based on current unit cost</small></article><article><Warehouse /><span>Locations</span><strong>{data.locations.length}</strong><small>Active storage locations</small></article></div>

    <section className="erp-panel"><div className="erp-toolbar"><label className="erp-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, SKU, supplier or location" /></label><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((row) => <option key={row}>{row}</option>)}</select></div>
      {items.length ? <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Item</th><th>Category</th><th>Location</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Unit cost</th><th>Status</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.sku} · {item.supplier_name || 'No supplier'}</small></td><td>{item.category}</td><td>{item.location_name || '—'}</td><td>{number.format(item.quantity_on_hand)} {item.unit}</td><td>{number.format(item.reserved_quantity)}</td><td><strong>{number.format(item.available_quantity)}</strong></td><td>{money.format(item.unit_cost)}</td><td><span className={`soft-badge ${item.low_stock ? 'soft-badge--warning' : 'soft-badge--success'}`}>{item.low_stock ? 'Low stock' : 'Available'}</span></td><td>{access.canEdit && <button className="secondary-button secondary-button--compact" onClick={() => { setSelected(item); setModal('movement') }}><PackagePlus size={14} /> Move</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="No inventory items found" message="Change the filters or add the first item." />}
    </section>

    <section className="erp-panel"><header><div><span>Recent history</span><h2>Stock movements</h2></div></header>{data.movements.length ? <div className="erp-table-wrap"><table className="erp-table"><thead><tr><th>Date</th><th>Item</th><th>Movement</th><th>Quantity</th><th>From</th><th>To</th><th>Project / customer</th><th>Reference</th></tr></thead><tbody>{data.movements.map((row) => <tr key={row.id}><td>{shortDate.format(new Date(row.created_at))}</td><td><strong>{row.item_name}</strong><small>{row.partner_name}</small></td><td><span className="soft-badge">{row.movement_type.replaceAll('_', ' ')}</span></td><td>{number.format(row.quantity)}</td><td>{row.source_location_name || '—'}</td><td>{row.destination_location_name || '—'}</td><td>{row.project_number || row.customer_name || '—'}</td><td>{row.reference_number || '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="No stock movements" message="Opening stock and future movements appear here." />}</section>

    {modal === 'item' && <Modal title="Add inventory item" subtitle="Create the item and its opening balance in one step." onClose={() => setModal(null)}><form className="erp-form" onSubmit={submitItem}><div className="erp-form-grid"><label><span>SKU</span><input name="sku" required /></label><label><span>Item name</span><input name="name" required /></label><label><span>Category</span><input name="category" defaultValue="Solar Panels" required /></label><label><span>Unit</span><input name="unit" defaultValue="Nos" required /></label><label><span>Supplier</span><input name="supplier_name" /></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" name="unit_cost" defaultValue="0" /></label><label><span>Reorder level</span><input type="number" min="0" step="0.001" name="reorder_level" defaultValue="0" /></label><label><span>Location</span><select name="location_id" required><option value="">Select location</option>{data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>Opening quantity</span><input type="number" min="0" step="0.001" name="opening_quantity" defaultValue="0" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Create item</button></footer></form></Modal>}

    {modal === 'location' && <Modal title="Add inventory location" subtitle="Keep warehouses and project stores simple." onClose={() => setModal(null)}><form className="erp-form" onSubmit={submitLocation}><div className="erp-form-grid"><label><span>Name</span><input name="name" required /></label><label><span>Type</span><select name="location_type"><option value="warehouse">Warehouse</option><option value="store">Store</option><option value="project_site">Project site</option></select></label><label className="erp-form-wide"><span>Address</span><textarea name="address" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Create location</button></footer></form></Modal>}

    {modal === 'movement' && selected && <Modal title="Record stock movement" subtitle={`${selected.name} · ${number.format(selected.available_quantity)} ${selected.unit} available`} onClose={() => setModal(null)}><form className="erp-form" onSubmit={submitMovement}><input type="hidden" name="item_id" value={selected.id} /><div className="erp-form-grid"><label><span>Movement</span><select name="movement_type"><option value="inward">Inward</option><option value="outward">Outward</option><option value="transfer">Transfer</option><option value="project_dispatch">Project dispatch</option><option value="project_return">Project return</option><option value="supplier_return">Supplier return</option><option value="adjustment">Adjustment</option></select></label><label><span>Quantity</span><input type="number" min="0.001" step="0.001" name="quantity" required /></label><label><span>Source</span><select name="source_location_id"><option value="">None</option>{data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>Destination</span><select name="destination_location_id"><option value="">None</option>{data.locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label><span>Supplier</span><input name="supplier_name" /></label><label><span>Transporter</span><input name="transporter_name" /></label><label><span>Reference / challan</span><input name="reference_number" /></label><label className="erp-form-wide"><span>Note</span><textarea name="note" /></label></div><footer className="erp-form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={working}>Post movement</button></footer></form></Modal>}
  </section>
}
