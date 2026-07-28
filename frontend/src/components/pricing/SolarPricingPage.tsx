import { Calculator, IndianRupee, Plus, RefreshCw, Save, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PricingBook, PricingItem } from '../../erp-types'
import { getPricingBook, savePricingBook } from '../../api/operations'
import { getModuleAccess } from '../../lib/permissions'
import type { Session } from '../../types'
import { ErrorState, LoadingSkeleton, ReadOnlyNotice } from '../ui/PageState'
import { useToast } from '../ui/ToastProvider'
import { KpiGrid, WorkspaceHeader, WorkspacePage } from '../workspace'

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const emptyItem = (): PricingItem => ({ name: '', category: 'Solar Panel', unit: 'Nos', price: 0, quantity: 1, tax_rate: 0, calculation_type: 'quantity', calculation_value: 1, display_order: 0, is_active: true, inventory_item_id: null })

export function SolarPricingPage({ session }: { session: Session }) {
  const [book, setBook] = useState<PricingBook | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [rowSearch, setRowSearch] = useState('')
  const access = getModuleAccess(session, 'pricing')
  const { toast } = useToast()

  const load = useCallback(async () => { setError(''); try { setBook(await getPricingBook()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load pricing') } }, [])
  useEffect(() => { void load() }, [load])

  const total = useMemo(() => (book?.items ?? []).filter((row) => row.is_active).reduce((sum, row) => sum + row.price * row.quantity * row.calculation_value * (1 + row.tax_rate / 100), 0), [book])
  const visibleItems = useMemo(() => {
    const term = rowSearch.trim().toLowerCase()
    return (book?.items ?? [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !term || [
        row.name,
        row.category,
        row.unit,
        row.price,
        row.quantity,
        row.tax_rate,
        row.calculation_value,
        row.is_active ? 'active' : 'inactive',
      ].join(' ').toLowerCase().includes(term))
  }, [book, rowSearch])

  function update(index: number, field: keyof PricingItem, value: string | number | boolean) {
    setBook((current) => current ? { ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row) } : current)
  }

  async function save() {
    if (!book) return
    const invalid = book.items.find((row) => !row.name.trim())
    if (invalid) { toast({ message: 'Every pricing row needs a name', variant: 'warning' }); return }
    setWorking(true)
    try { setBook(await savePricingBook({ name: book.name, items: book.items.map((row, index) => ({ ...row, display_order: index })) })); toast({ message: 'Master pricing saved', variant: 'success' }) }
    catch (reason) { toast({ message: reason instanceof Error ? reason.message : 'Could not save pricing', variant: 'error' }) }
    finally { setWorking(false) }
  }

  if (!book && !error) return <WorkspacePage className="erp-page"><LoadingSkeleton rows={7} /></WorkspacePage>
  if (!book) return <WorkspacePage className="erp-page"><ErrorState message={error} onRetry={() => void load()} /></WorkspacePage>

  return <WorkspacePage className="erp-page">
    <WorkspaceHeader className="erp-page-head"><div><span>Commercial settings</span><h1>Solar pricing</h1></div><div className="erp-head-actions"><button className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>{access.canEdit && <button className="primary-button" onClick={() => void save()} disabled={working}><Save size={15} /> Save pricing</button>}</div></WorkspaceHeader>
    {access.readOnly && <ReadOnlyNotice />}

    <KpiGrid columns={3} className="erp-kpi-grid"><article><IndianRupee /><span>Calculated package</span><strong>{money.format(total)}</strong><small>Active rows including tax</small></article><article><Calculator /><span>Price book version</span><strong>v{book.version}</strong><small>Updated {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(book.updated_at))}</small></article><article><Plus /><span>Active rows</span><strong>{book.items.filter((row) => row.is_active).length}</strong><small>{book.items.length} total pricing rows</small></article></KpiGrid>

    <section className="erp-panel pricing-workspace-panel"><header className="pricing-book-head"><label><span>Price book name</span><input value={book.name} disabled={!access.canEdit} onChange={(event) => setBook({ ...book, name: event.target.value })} /></label><div className="pricing-book-actions"><div className="erp-search pricing-row-search"><Search size={14} /><input type="search" value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} placeholder="Search pricing rows" aria-label="Search pricing rows" /></div>{access.canEdit && <button className="secondary-button" onClick={() => setBook({ ...book, items: [...book.items, emptyItem()] })}><Plus size={15} /> Add row</button>}</div></header>
      <div className="erp-table-wrap"><table className="erp-table pricing-table"><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Price</th><th>Qty</th><th>Tax %</th><th>Multiplier</th><th>Total</th><th>Active</th><th /></tr></thead><tbody>{visibleItems.map(({ row, index }) => <tr key={row.id ?? `new-${index}`}><td><input value={row.name} disabled={!access.canEdit} onChange={(event) => update(index, 'name', event.target.value)} placeholder="Pricing item" /></td><td><input value={row.category} disabled={!access.canEdit} onChange={(event) => update(index, 'category', event.target.value)} /></td><td><input value={row.unit} disabled={!access.canEdit} onChange={(event) => update(index, 'unit', event.target.value)} /></td><td><input type="number" min="0" step="0.01" value={row.price} disabled={!access.canEdit} onChange={(event) => update(index, 'price', Number(event.target.value))} /></td><td><input type="number" min="0" step="0.001" value={row.quantity} disabled={!access.canEdit} onChange={(event) => update(index, 'quantity', Number(event.target.value))} /></td><td><input type="number" min="0" max="100" step="0.01" value={row.tax_rate} disabled={!access.canEdit} onChange={(event) => update(index, 'tax_rate', Number(event.target.value))} /></td><td><input type="number" min="0" step="0.001" value={row.calculation_value} disabled={!access.canEdit} onChange={(event) => update(index, 'calculation_value', Number(event.target.value))} /></td><td><strong>{money.format(row.price * row.quantity * row.calculation_value * (1 + row.tax_rate / 100))}</strong></td><td><input type="checkbox" checked={row.is_active} disabled={!access.canEdit} onChange={(event) => update(index, 'is_active', event.target.checked)} /></td><td>{access.canEdit && <button className="icon-button icon-button--danger" onClick={() => setBook({ ...book, items: book.items.filter((_, rowIndex) => rowIndex !== index) })} aria-label="Remove pricing row"><Trash2 size={15} /></button>}</td></tr>)}{visibleItems.length === 0 && <tr><td className="pricing-table-empty" colSpan={10}>{book.items.length === 0 ? 'No pricing rows yet.' : `No pricing rows match “${rowSearch.trim()}”.`}</td></tr>}</tbody></table></div>
    </section>
  </WorkspacePage>
}
