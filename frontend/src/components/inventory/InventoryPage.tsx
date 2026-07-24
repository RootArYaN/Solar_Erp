import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CircleCheck,
  ClipboardList,
  IndianRupee,
  MapPin,
  PackageCheck,
  PackagePlus,
  Plus,
  Search,
  Truck,
  Warehouse,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Modal } from '../admin/Modal'
import { useToast } from '../ui/ToastProvider'

type Category =
  | 'Solar Panels'
  | 'Inverters'
  | 'Mounting'
  | 'Protection'
  | 'Cables'
  | 'Earthing'
  | 'Batteries'
  | 'Consumables'

type StockItem = {
  id: string
  sku: string
  name: string
  category: Category
  unit: string
  stock: number
  reserved: number
  reorderLevel: number
  unitCost: number
  location: string
  supplier: string
}

type MovementType = 'inward' | 'outward' | 'transfer' | 'adjustment'
type MovementStatus = 'completed' | 'in-transit'

type StockMovement = {
  id: string
  createdAt: string
  type: MovementType
  status: MovementStatus
  itemId: string
  itemName: string
  quantity: number
  from: string
  to: string
  partner: string
  reference: string
  note: string
}

type InventoryState = {
  items: StockItem[]
  movements: StockMovement[]
}

const storageKey = 'solarErpInventoryV1'
const categories: Category[] = ['Solar Panels', 'Inverters', 'Mounting', 'Protection', 'Cables', 'Earthing', 'Batteries', 'Consumables']
const locations = ['Main Warehouse', 'Secondary Store', 'Project Site', 'Customer Site']

const defaultItems: StockItem[] = [
  { id: 'panel-540', sku: 'PV-540M', name: '540W Mono PERC Solar Panel', category: 'Solar Panels', unit: 'Nos', stock: 86, reserved: 24, reorderLevel: 30, unitCost: 14250, location: 'Main Warehouse', supplier: 'Waaree' },
  { id: 'panel-550', sku: 'PV-550N', name: '550W N-Type Solar Panel', category: 'Solar Panels', unit: 'Nos', stock: 18, reserved: 8, reorderLevel: 24, unitCost: 15100, location: 'Main Warehouse', supplier: 'Adani Solar' },
  { id: 'inv-3ph-10', sku: 'INV-10K-3P', name: '10kW Three Phase Inverter', category: 'Inverters', unit: 'Nos', stock: 7, reserved: 3, reorderLevel: 4, unitCost: 68200, location: 'Main Warehouse', supplier: 'Sungrow' },
  { id: 'inv-1ph-5', sku: 'INV-5K-1P', name: '5kW Single Phase Inverter', category: 'Inverters', unit: 'Nos', stock: 3, reserved: 2, reorderLevel: 4, unitCost: 38600, location: 'Secondary Store', supplier: 'Growatt' },
  { id: 'rail-40', sku: 'MS-R40-6M', name: '40×40 Aluminium Mounting Rail', category: 'Mounting', unit: 'Lengths', stock: 64, reserved: 20, reorderLevel: 25, unitCost: 1180, location: 'Main Warehouse', supplier: 'Local Fabricator' },
  { id: 'acdb-6', sku: 'ACDB-6KW', name: 'ACDB 1–6kW Single Phase', category: 'Protection', unit: 'Nos', stock: 13, reserved: 4, reorderLevel: 8, unitCost: 3900, location: 'Main Warehouse', supplier: 'Elmax' },
  { id: 'dcdb-5', sku: 'DCDB-5KW', name: 'DCDB 1–5kW 1-in-1-out', category: 'Protection', unit: 'Nos', stock: 6, reserved: 3, reorderLevel: 8, unitCost: 3350, location: 'Main Warehouse', supplier: 'Elmax' },
  { id: 'dc-cable-red', sku: 'DC4-R-90', name: '4 sq.mm DC Cable Red 90m', category: 'Cables', unit: 'Rolls', stock: 12, reserved: 5, reorderLevel: 8, unitCost: 6050, location: 'Main Warehouse', supplier: 'Polycab' },
  { id: 'dc-cable-black', sku: 'DC4-B-90', name: '4 sq.mm DC Cable Black 90m', category: 'Cables', unit: 'Rolls', stock: 10, reserved: 4, reorderLevel: 8, unitCost: 6050, location: 'Main Warehouse', supplier: 'Polycab' },
  { id: 'earth-kit', sku: 'EARTH-KIT-R', name: 'Residential Earthing Kit', category: 'Earthing', unit: 'Kits', stock: 9, reserved: 5, reorderLevel: 10, unitCost: 4850, location: 'Secondary Store', supplier: 'Jainflex' },
  { id: 'battery-5', sku: 'LFP-5.1K', name: '5.1kWh LiFePO₄ Battery', category: 'Batteries', unit: 'Nos', stock: 4, reserved: 1, reorderLevel: 3, unitCost: 101000, location: 'Main Warehouse', supplier: 'Dyness' },
  { id: 'mc4-pair', sku: 'MC4-PAIR', name: 'MC4 Connector Pair', category: 'Consumables', unit: 'Pairs', stock: 96, reserved: 30, reorderLevel: 40, unitCost: 145, location: 'Main Warehouse', supplier: 'Elmex' },
]

const seedMovements: StockMovement[] = [
  { id: 'mv-1', createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(), type: 'outward', status: 'completed', itemId: 'panel-540', itemName: '540W Mono PERC Solar Panel', quantity: 18, from: 'Main Warehouse', to: 'Patel Residence · 10kW', partner: 'Sunrise Logistics', reference: 'DC-1048', note: 'Site dispatch' },
  { id: 'mv-2', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), type: 'transfer', status: 'in-transit', itemId: 'rail-40', itemName: '40×40 Aluminium Mounting Rail', quantity: 12, from: 'Main Warehouse', to: 'Project Site', partner: 'Shree Transport', reference: 'TR-221', note: 'Expected today' },
  { id: 'mv-3', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 27).toISOString(), type: 'inward', status: 'completed', itemId: 'inv-3ph-10', itemName: '10kW Three Phase Inverter', quantity: 5, from: 'Sungrow', to: 'Main Warehouse', partner: 'Sungrow', reference: 'PO-781', note: 'Purchase received' },
]

const blankItem: Omit<StockItem, 'id'> = {
  sku: '',
  name: '',
  category: 'Solar Panels',
  unit: 'Nos',
  stock: 0,
  reserved: 0,
  reorderLevel: 5,
  unitCost: 0,
  location: 'Main Warehouse',
  supplier: '',
}

function loadInventory(): InventoryState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '') as InventoryState
    if (saved && Array.isArray(saved.items) && Array.isArray(saved.movements)) return saved
  } catch {
    localStorage.removeItem(storageKey)
  }
  return { items: defaultItems, movements: seedMovements }
}

function money(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function movementLabel(type: MovementType) {
  return ({ inward: 'Stock inward', outward: 'Stock outward', transfer: 'Transfer', adjustment: 'Adjustment' })[type]
}

function available(item: StockItem) {
  return Math.max(0, item.stock - item.reserved)
}

export function InventoryPage() {
  const [state, setState] = useState<InventoryState>(loadInventory)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'All' | Category>('All')
  const [movementOpen, setMovementOpen] = useState(false)
  const [itemOpen, setItemOpen] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState(state.items[0]?.id ?? '')
  const [movementType, setMovementType] = useState<MovementType>('inward')
  const [quantity, setQuantity] = useState(1)
  const [from, setFrom] = useState('Supplier')
  const [to, setTo] = useState('Main Warehouse')
  const [partner, setPartner] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [newItem, setNewItem] = useState(blankItem)
  const { toast } = useToast()

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return state.items.filter((item) => (
      (category === 'All' || item.category === category)
      && (!term || `${item.name} ${item.sku} ${item.supplier} ${item.location}`.toLowerCase().includes(term))
    ))
  }, [category, search, state.items])

  const stats = useMemo(() => {
    const totalUnits = state.items.reduce((sum, item) => sum + item.stock, 0)
    const reservedUnits = state.items.reduce((sum, item) => sum + item.reserved, 0)
    const stockValue = state.items.reduce((sum, item) => sum + item.stock * item.unitCost, 0)
    const lowStock = state.items.filter((item) => available(item) <= item.reorderLevel).length
    const inTransit = state.movements.filter((movement) => movement.status === 'in-transit').reduce((sum, movement) => sum + movement.quantity, 0)
    return { totalUnits, reservedUnits, stockValue, lowStock, inTransit }
  }, [state])

  function beginMovement(itemId?: string, type: MovementType = 'inward') {
    const item = state.items.find((entry) => entry.id === itemId) ?? state.items[0]
    if (!item) {
      toast({ message: 'Add an inventory item first', variant: 'warning' })
      return
    }
    setSelectedItemId(item.id)
    setMovementType(type)
    setQuantity(1)
    setFrom(type === 'inward' ? item.supplier || 'Supplier' : item.location)
    setTo(type === 'outward' ? 'Customer Site' : type === 'transfer' ? 'Project Site' : item.location)
    setPartner('')
    setReference('')
    setNote('')
    setMovementOpen(true)
  }

  function submitMovement(event: FormEvent) {
    event.preventDefault()
    const item = state.items.find((entry) => entry.id === selectedItemId)
    const qty = Math.abs(Number(quantity))
    if (!item || !Number.isFinite(qty) || qty <= 0) return
    if (movementType === 'outward' && qty > available(item)) {
      toast({ title: 'Not enough available stock', message: `${item.name} has ${available(item)} ${item.unit} available.`, variant: 'error' })
      return
    }

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      type: movementType,
      status: movementType === 'transfer' ? 'in-transit' : 'completed',
      itemId: item.id,
      itemName: item.name,
      quantity: qty,
      from,
      to,
      partner,
      reference: reference || `STK-${Date.now().toString().slice(-6)}`,
      note,
    }

    setState((current) => ({
      items: current.items.map((entry) => {
        if (entry.id !== item.id) return entry
        if (movementType === 'inward') return { ...entry, stock: entry.stock + qty }
        if (movementType === 'outward') return { ...entry, stock: Math.max(0, entry.stock - qty), reserved: Math.min(entry.reserved, Math.max(0, entry.stock - qty)) }
        if (movementType === 'adjustment') return { ...entry, stock: qty, reserved: Math.min(entry.reserved, qty) }
        return entry
      }),
      movements: [movement, ...current.movements],
    }))
    setMovementOpen(false)
    toast({ message: `${movementLabel(movementType)} recorded`, variant: 'success' })
  }

  function completeTransfer(id: string) {
    setState((current) => ({
      ...current,
      movements: current.movements.map((movement) => movement.id === id ? { ...movement, status: 'completed' } : movement),
    }))
    toast({ message: 'Transfer marked delivered', variant: 'success' })
  }

  function submitNewItem(event: FormEvent) {
    event.preventDefault()
    if (!newItem.name.trim() || !newItem.sku.trim()) return
    const item: StockItem = { ...newItem, id: crypto.randomUUID(), stock: Number(newItem.stock), reserved: Number(newItem.reserved), reorderLevel: Number(newItem.reorderLevel), unitCost: Number(newItem.unitCost) }
    setState((current) => ({ ...current, items: [...current.items, item] }))
    setNewItem(blankItem)
    setItemOpen(false)
    toast({ message: `${item.name} added to inventory`, variant: 'success' })
  }

  return (
    <section className="inventory-page">
      <header className="inventory-header">
        <div>
          <span className="inventory-eyebrow"><Warehouse size={14} /> Stock control</span>
          <h1>Solar Inventory</h1>
          <p>Manage supply, stock availability and site dispatches from one place.</p>
        </div>
        <div className="inventory-header__actions">
          <button className="inventory-secondary-button" onClick={() => setItemOpen(true)}><Plus size={15} /> Add item</button>
          <button className="inventory-primary-button" onClick={() => beginMovement()}><PackagePlus size={16} /> Record movement</button>
        </div>
      </header>

      <section className="inventory-kpis">
        <article><span><Boxes size={16} /></span><div><small>Stock on hand</small><strong>{stats.totalUnits}</strong><em>{stats.reservedUnits} reserved</em></div></article>
        <article className={stats.lowStock ? 'is-warning' : ''}><span><AlertTriangle size={16} /></span><div><small>Reorder attention</small><strong>{stats.lowStock}</strong><em>items at or below level</em></div></article>
        <article><span><Truck size={16} /></span><div><small>In transit</small><strong>{stats.inTransit}</strong><em>units moving to sites</em></div></article>
        <article><span><IndianRupee size={16} /></span><div><small>Stock value</small><strong>{money(stats.stockValue)}</strong><em>at current unit cost</em></div></article>
      </section>

      <div className="inventory-workspace">
        <section className="inventory-stock-panel">
          <header>
            <div><PackageCheck size={17} /><span><strong>Current stock</strong><small>{filteredItems.length} of {state.items.length} items</small></span></div>
            <label className="inventory-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, SKU or supplier" /></label>
          </header>
          <nav className="inventory-categories" aria-label="Inventory categories">
            <button className={category === 'All' ? 'active' : ''} onClick={() => setCategory('All')}>All <span>{state.items.length}</span></button>
            {categories.map((name) => <button className={category === name ? 'active' : ''} onClick={() => setCategory(name)} key={name}>{name} <span>{state.items.filter((item) => item.category === name).length}</span></button>)}
          </nav>
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead><tr><th>Item</th><th>Location</th><th>Available</th><th>Reserved</th><th>Reorder</th><th>Value</th><th /></tr></thead>
              <tbody>
                {filteredItems.map((item) => {
                  const balance = available(item)
                  const low = balance <= item.reorderLevel
                  return (
                    <tr key={item.id}>
                      <td><div className="inventory-item-cell"><span>{item.category.slice(0, 2).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.sku} · {item.supplier}</small></div></div></td>
                      <td><div className="inventory-location"><MapPin size={12} />{item.location}</div></td>
                      <td><strong className={low ? 'inventory-quantity inventory-quantity--low' : 'inventory-quantity'}>{balance} <small>{item.unit}</small></strong></td>
                      <td>{item.reserved}</td>
                      <td>{item.reorderLevel}</td>
                      <td>{money(item.stock * item.unitCost)}</td>
                      <td><button className="inventory-row-action" onClick={() => beginMovement(item.id, 'outward')} title="Move stock"><ArrowRight size={15} /></button></td>
                    </tr>
                  )
                })}
                {!filteredItems.length && <tr><td colSpan={7} className="inventory-empty">No inventory items match this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="inventory-flow-panel">
          <header><div><Truck size={17} /><span><strong>Stock flow</strong><small>Latest supply and dispatches</small></span></div><button onClick={() => beginMovement(undefined, 'transfer')}><Plus size={14} /> Transfer</button></header>
          <div className="inventory-flow-list">
            {state.movements.map((movement) => {
              const Icon = movement.type === 'inward' ? ArrowDownLeft : movement.type === 'outward' ? ArrowUpRight : movement.type === 'transfer' ? Truck : ClipboardList
              return (
                <article key={movement.id}>
                  <span className={`inventory-flow-icon inventory-flow-icon--${movement.type}`}><Icon size={15} /></span>
                  <div>
                    <header><strong>{movementLabel(movement.type)}</strong><time>{shortDate(movement.createdAt)}</time></header>
                    <p>{movement.itemName}</p>
                    <span className="inventory-route">{movement.from}<ArrowRight size={11} />{movement.to}</span>
                    <footer>
                      <b>{movement.quantity} units</b>
                      <small>{movement.reference}</small>
                      {movement.status === 'in-transit'
                        ? <button onClick={() => completeTransfer(movement.id)}>Mark delivered</button>
                        : <em><CircleCheck size={11} /> Completed</em>}
                    </footer>
                  </div>
                </article>
              )
            })}
          </div>
        </aside>
      </div>

      {movementOpen && (
        <Modal title="Record stock movement" subtitle="One simple entry updates stock and creates a transaction record." onClose={() => setMovementOpen(false)}>
          <form className="inventory-form" onSubmit={submitMovement}>
            <div className="inventory-movement-types">
              {(['inward', 'outward', 'transfer', 'adjustment'] as MovementType[]).map((type) => (
                <button type="button" className={movementType === type ? 'active' : ''} onClick={() => setMovementType(type)} key={type}>{movementLabel(type)}</button>
              ))}
            </div>
            <label className="inventory-field inventory-field--wide"><span>Stock item</span><select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>{state.items.map((item) => <option value={item.id} key={item.id}>{item.name} · {available(item)} available</option>)}</select></label>
            <div className="inventory-form-grid">
              <label className="inventory-field"><span>{movementType === 'adjustment' ? 'Set physical stock to' : 'Quantity'}</span><input required min=".01" step=".01" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
              <label className="inventory-field"><span>Reference / challan</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Auto generated" /></label>
              <label className="inventory-field"><span>From</span><input value={from} onChange={(event) => setFrom(event.target.value)} list="inventory-locations" /></label>
              <label className="inventory-field"><span>To</span><input value={to} onChange={(event) => setTo(event.target.value)} list="inventory-locations" /></label>
              <label className="inventory-field inventory-field--wide"><span>Supplier / transporter / receiver</span><input value={partner} onChange={(event) => setPartner(event.target.value)} placeholder="Optional" /></label>
              <label className="inventory-field inventory-field--wide"><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Short purpose or site name" /></label>
            </div>
            <datalist id="inventory-locations">{locations.map((location) => <option value={location} key={location} />)}</datalist>
            <footer className="inventory-form-actions"><button type="button" className="inventory-secondary-button" onClick={() => setMovementOpen(false)}>Cancel</button><button className="inventory-primary-button" type="submit">Save movement</button></footer>
          </form>
        </Modal>
      )}

      {itemOpen && (
        <Modal title="Add inventory item" subtitle="Create one reusable stock item for future inward and outward entries." onClose={() => setItemOpen(false)}>
          <form className="inventory-form" onSubmit={submitNewItem}>
            <div className="inventory-form-grid">
              <label className="inventory-field inventory-field--wide"><span>Item name</span><input required value={newItem.name} onChange={(event) => setNewItem((current) => ({ ...current, name: event.target.value }))} placeholder="Example: 550W N-Type Solar Panel" /></label>
              <label className="inventory-field"><span>SKU</span><input required value={newItem.sku} onChange={(event) => setNewItem((current) => ({ ...current, sku: event.target.value }))} /></label>
              <label className="inventory-field"><span>Category</span><select value={newItem.category} onChange={(event) => setNewItem((current) => ({ ...current, category: event.target.value as Category }))}>{categories.map((name) => <option key={name}>{name}</option>)}</select></label>
              <label className="inventory-field"><span>Opening stock</span><input min="0" type="number" value={newItem.stock} onChange={(event) => setNewItem((current) => ({ ...current, stock: Number(event.target.value) }))} /></label>
              <label className="inventory-field"><span>Unit</span><input value={newItem.unit} onChange={(event) => setNewItem((current) => ({ ...current, unit: event.target.value }))} placeholder="Nos, rolls, kits" /></label>
              <label className="inventory-field"><span>Reorder level</span><input min="0" type="number" value={newItem.reorderLevel} onChange={(event) => setNewItem((current) => ({ ...current, reorderLevel: Number(event.target.value) }))} /></label>
              <label className="inventory-field"><span>Unit cost</span><input min="0" type="number" value={newItem.unitCost} onChange={(event) => setNewItem((current) => ({ ...current, unitCost: Number(event.target.value) }))} /></label>
              <label className="inventory-field"><span>Location</span><select value={newItem.location} onChange={(event) => setNewItem((current) => ({ ...current, location: event.target.value }))}>{locations.slice(0, 2).map((location) => <option key={location}>{location}</option>)}</select></label>
              <label className="inventory-field"><span>Supplier</span><input value={newItem.supplier} onChange={(event) => setNewItem((current) => ({ ...current, supplier: event.target.value }))} /></label>
            </div>
            <footer className="inventory-form-actions"><button type="button" className="inventory-secondary-button" onClick={() => setItemOpen(false)}>Cancel</button><button className="inventory-primary-button" type="submit">Add item</button></footer>
          </form>
        </Modal>
      )}
    </section>
  )
}
