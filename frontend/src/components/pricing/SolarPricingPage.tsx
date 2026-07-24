import {
  BadgeIndianRupee,
  Calculator,
  Download,
  Plus,
  Printer,
  RotateCcw,
  Settings2,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertDialog } from '../ui/AlertDialog'
import { useToast } from '../ui/ToastProvider'

type Formula = 'normal' | 'panelPerWatt' | 'fittingPerKw' | 'multiplier' | 'fixedFinal'
type PricingView = 'setup' | 'all'
type PriceKey = 'kitPrice' | 'costToUs' | 'withoutLoanPrice' | 'withLoanPrice'

type PricingItem = {
  name: string
  price: number
  qty: number
  tax: number | 'NON'
  formula: Formula
  multiplier?: number
  final?: number
  manualFinal?: number
}

type PricingState = {
  projectName: string
  systemKw: number
  showPrice: PriceKey
  items: PricingItem[]
}

const storageKey = 'shreeSolarPricingV1'
const loanOutputBase = 33898

const defaultState: PricingState = {
  projectName: '',
  systemKw: 3.6,
  showPrice: 'withoutLoanPrice',
  items: [
    { name: 'FITTING', price: 1600, qty: 1, tax: 'NON', formula: 'fittingPerKw' },
    { name: '540', price: 25.5, qty: 6, tax: 5, formula: 'panelPerWatt' },
    { name: '3.6KW', price: 15500, qty: 1, tax: 5, formula: 'normal' },
    { name: 'ASG-ACDB(1-6KW)1PH(L&T+ELMAX)', price: 900, qty: 1, tax: 5, formula: 'normal' },
    { name: 'DSG-DCDB(1-5KW) 1N-1', price: 800, qty: 1, tax: 5, formula: 'normal' },
    { name: '60*40*2MM 6 MTR', price: 84, qty: 3, tax: 18, formula: 'multiplier', multiplier: 18 },
    { name: '40*40*2MM 6 MTR', price: 83, qty: 3, tax: 18, formula: 'multiplier', multiplier: 14.6 },
    { name: 'CABLE - 4SQ MM RED POLYCAB FR', price: 36, qty: 5, tax: 18, formula: 'normal' },
    { name: 'CABLE - 4SQ MM BLACK POLYCAB FR', price: 36, qty: 5, tax: 18, formula: 'normal' },
    { name: 'CABLE 4SQ MM DC ENTYPE POLYCAB', price: 57, qty: 40, tax: 18, formula: 'normal' },
    { name: 'LA 16 SQMM JAINFLAX ALU', price: 15, qty: 20, tax: 18, formula: 'normal' },
    { name: 'HW 1 CORE X 4.0 SQMM GREEN 90M', price: 36, qty: 20, tax: 18, formula: 'normal' },
    { name: 'RESIDENTIAL EARTHING KIT', price: 700, qty: 1, tax: 18, formula: 'normal' },
    { name: 'BFC BAG', price: 0, qty: 0, tax: 18, formula: 'normal' },
    { name: 'PVC PIPE 25MM HAVEY 1.5MM POLYCAB', price: 47, qty: 10, tax: 18, formula: 'normal' },
    { name: 'PVC BAND 25MM ELBOW', price: 3, qty: 25, tax: 18, formula: 'normal' },
    { name: 'JBOLT-8MM SET', price: 12, qty: 32, tax: 18, formula: 'normal' },
    { name: 'MC4 CONNECTOR', price: 50, qty: 2, tax: 18, formula: 'normal' },
    { name: 'STUD 12 MM*2 MTR', price: 130, qty: 1, tax: 18, formula: 'normal' },
    { name: 'BASE PLATE 125*125*3 MM', price: 35, qty: 2, tax: 18, formula: 'normal' },
    { name: 'M10 SILVER ANCHOR FASTNER', price: 12, qty: 8, tax: 18, formula: 'normal' },
    { name: 'ZINC CHROME', price: 50, qty: 1, tax: 18, formula: 'normal' },
    { name: 'CABLE CLIP-25MM CPVC/G2', price: 1, qty: 50, tax: 18, formula: 'normal' },
    { name: 'CABLE TIE SLOCK 300*4.8 BLACK UV', price: 50, qty: 1, tax: 18, formula: 'normal' },
    { name: 'CABLE TRAY 45X25 1 MTR', price: 0, qty: 0, tax: 18, formula: 'normal' },
    { name: 'NUT 10MM', price: 80, qty: 1, tax: 18, formula: 'normal' },
    { name: 'PVC BAND 25MM TEE', price: 5, qty: 6, tax: 18, formula: 'normal' },
    { name: 'RING LUG (CU) 2.5 SQMM -M6', price: 1, qty: 5, tax: 18, formula: 'normal' },
    { name: 'AGENT', price: 5000, qty: 1, tax: 'NON', formula: 'fixedFinal', final: 7000 },
    { name: 'PROFIT', price: 15000, qty: 1, tax: 'NON', formula: 'fixedFinal', final: 15000 },
  ],
}

const priceOptions: { key: PriceKey; label: string }[] = [
  { key: 'kitPrice', label: 'Kit Price' },
  { key: 'costToUs', label: 'Cost To Us' },
  { key: 'withoutLoanPrice', label: 'Without Loan' },
  { key: 'withLoanPrice', label: 'With Loan' },
]

const formulaOptions: { value: Formula; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'panelPerWatt', label: 'Panel / watt' },
  { value: 'fittingPerKw', label: 'Fitting / kW' },
  { value: 'multiplier', label: 'Multiplier' },
  { value: 'fixedFinal', label: 'Fixed final' },
]

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function cloneState(value: PricingState): PricingState {
  return JSON.parse(JSON.stringify(value)) as PricingState
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '') as PricingState
    if (saved && Array.isArray(saved.items)) return saved
  } catch {
    localStorage.removeItem(storageKey)
  }
  return cloneState(defaultState)
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function taxRate(item: PricingItem) {
  return item.tax === 'NON' ? 0 : numeric(item.tax)
}

function calculatePricing(state: PricingState) {
  const panel = state.items[1]
  const lines = state.items.map((item) => {
    let taxable = 0
    if (item.formula === 'panelPerWatt') taxable = numeric(item.price) * numeric(item.name) * numeric(item.qty)
    else if (item.formula === 'multiplier') taxable = numeric(item.price) * numeric(item.qty) * numeric(item.multiplier || 1)
    else if (item.formula !== 'fixedFinal' && item.formula !== 'fittingPerKw') taxable = numeric(item.price) * numeric(item.qty)

    let final = taxable * (1 + taxRate(item) / 100)
    if (item.formula === 'fixedFinal') final = numeric(item.final)
    if (item.formula === 'fittingPerKw') final = ((numeric(panel?.name) * numeric(panel?.qty)) / 1000) * numeric(item.price)
    if (item.manualFinal !== undefined) final = numeric(item.manualFinal)
    return { taxable, final, tax: taxRate(item) }
  })

  const input5Base = lines.slice(1, 5).reduce((sum, row) => sum + row.taxable, 0)
  const input18Base = lines.slice(5, 28).reduce((sum, row) => sum + row.taxable, 0)
  const inputTax = input5Base * 0.05 + input18Base * 0.18
  const kitPrice = lines.slice(1, 28).reduce((sum, row) => sum + row.final, 0)
  const costToUs = lines.slice(0, 28).reduce((sum, row) => sum + row.final, 0)
  const withoutLoanPrice = lines.reduce((sum, row) => sum + row.final, 0)
  const outputTax = ((withoutLoanPrice - loanOutputBase) * 0.05) + (loanOutputBase * 0.18)
  const withLoanPrice = withoutLoanPrice + (outputTax - inputTax)

  return { lines, input5Base, input18Base, inputTax, outputTax, kitPrice, costToUs, withoutLoanPrice, withLoanPrice }
}

function formatMoney(value: number) {
  return money.format(Math.round(numeric(value)))
}

export function SolarPricingPage() {
  const [state, setState] = useState<PricingState>(loadState)
  const [view, setView] = useState<PricingView>('setup')
  const [itemToDelete, setItemToDelete] = useState<{ index: number; name: string } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const { toast } = useToast()
  const storageErrorShown = useRef(false)
  const totals = useMemo(() => calculatePricing(state), [state])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state))
      storageErrorShown.current = false
    } catch {
      if (!storageErrorShown.current) {
        toast({ message: 'Could not save pricing in this browser', variant: 'error' })
        storageErrorShown.current = true
      }
    }
  }, [state, toast])

  function updateItem(index: number, patch: Partial<PricingItem>) {
    setState((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }))
  }

  function addItem() {
    setState((current) => ({
      ...current,
      items: [...current.items, { name: 'NEW ITEM', price: 0, qty: 1, tax: 18, formula: 'normal' }],
    }))
  }

  function removeItem() {
    if (!itemToDelete) return
    setState((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== itemToDelete.index) }))
    toast({ message: `${itemToDelete.name || 'Item'} deleted`, variant: 'success' })
    setItemToDelete(null)
  }

  function resetPricing() {
    setState(cloneState(defaultState))
    setResetOpen(false)
    toast({ message: 'Pricing reset to defaults', variant: 'success' })
  }

  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'solar-pricing-backup.json'
    anchor.click()
    URL.revokeObjectURL(url)
    toast({ message: 'Pricing backup downloaded', variant: 'success' })
  }

  const priceDate = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())
  const selectedPrice = priceOptions.find((option) => option.key === state.showPrice) ?? priceOptions[2]
  const withoutLoanMargin = totals.withoutLoanPrice - totals.costToUs
  const withLoanMargin = totals.withLoanPrice - totals.costToUs
  const gstDifference = totals.outputTax - totals.inputTax

  return (
    <section className="pricing-desk-page">
      <header className="pricing-desk-header">
        <div>
          <span>Updated {priceDate}</span>
          <h1>Solar pricing</h1>
        </div>
        <div className="pricing-desk-project">
          <label><span>Customer / Project</span><input value={state.projectName} onChange={(event) => setState((current) => ({ ...current, projectName: event.target.value }))} placeholder="Customer name" /></label>
          <label><span>System size</span><input type="number" min="0" step="0.01" value={state.systemKw} onChange={(event) => setState((current) => ({ ...current, systemKw: numeric(event.target.value) }))} /><b>kW</b></label>
        </div>
        <button className="secondary-button pricing-print-button" onClick={() => { window.print(); toast({ message: 'Print dialog opened', variant: 'info' }) }}><Printer size={14} /> Print</button>
      </header>

      <nav className="pricing-desk-tabs">
        <button className={view === 'setup' ? 'active' : ''} onClick={() => setView('setup')}><Settings2 size={15} /> Setup</button>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}><TrendingUp size={15} /> Prices</button>
      </nav>

      {view === 'setup' ? (
        <div className="pricing-setup-layout">
          <section className="pricing-components-panel">
            <header>
              <div><Calculator size={16} /><strong>Components</strong><span>{state.items.length} items</span></div>
              <div>
                <button onClick={addItem}><Plus size={13} /> Add item</button>
                <button onClick={exportBackup}><Download size={13} /> Backup</button>
                <button className="danger" onClick={() => setResetOpen(true)}><RotateCcw size={13} /> Reset</button>
              </div>
            </header>
            <div className="pricing-components-table-wrap">
              <table className="pricing-components-table">
                <colgroup>
                  <col className="pricing-col-number" />
                  <col className="pricing-col-component" />
                  <col className="pricing-col-formula" />
                  <col className="pricing-col-price" />
                  <col className="pricing-col-qty" />
                  <col className="pricing-col-tax" />
                  <col className="pricing-col-extra" />
                  <col className="pricing-col-final" />
                  <col className="pricing-col-action" />
                </colgroup>
                <thead><tr><th>#</th><th>Component</th><th>Formula</th><th>Price</th><th>Qty</th><th>Tax</th><th>Extra</th><th className="numeric-cell">Final</th><th /></tr></thead>
                <tbody>
                  {state.items.map((item, index) => (
                    <tr key={index}>
                      <td><span className="pricing-item-number">{index + 1}</span></td>
                      <td><input className="component-name-input" value={item.name} onChange={(event) => updateItem(index, { name: event.target.value })} /></td>
                      <td><select value={item.formula} onChange={(event) => {
                        const formula = event.target.value as Formula
                        updateItem(index, {
                          formula,
                          ...(formula === 'multiplier' && !item.multiplier ? { multiplier: 1 } : {}),
                          ...(formula === 'fixedFinal' && item.final === undefined ? { final: item.price * item.qty } : {}),
                        })
                      }}>{formulaOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></td>
                      <td><input type="number" step=".01" value={item.price} onChange={(event) => updateItem(index, { price: numeric(event.target.value) })} /></td>
                      <td><input type="number" step=".01" value={item.qty} onChange={(event) => updateItem(index, { qty: numeric(event.target.value) })} /></td>
                      <td><input value={item.tax} onChange={(event) => {
                        const value = event.target.value.trim().toUpperCase()
                        updateItem(index, { tax: value.startsWith('N') ? 'NON' : numeric(value) })
                      }} /></td>
                      <td>
                        <input
                          type="number"
                          step=".01"
                          value={item.formula === 'fixedFinal' ? item.final ?? 0 : item.multiplier ?? ''}
                          placeholder="—"
                          title={item.formula === 'fixedFinal' ? 'Fixed final amount' : 'Multiplier'}
                          onChange={(event) => {
                            const value = event.target.value
                            if (item.formula === 'fixedFinal') updateItem(index, { final: value === '' ? 0 : numeric(value) })
                            else updateItem(index, {
                              multiplier: value === '' ? undefined : numeric(value),
                              ...(value !== '' && item.formula !== 'multiplier' ? { formula: 'multiplier' as Formula } : {}),
                            })
                          }}
                        />
                      </td>
                      <td className="numeric-cell">
                        <div className={`pricing-final-field ${item.manualFinal !== undefined ? 'is-overridden' : ''}`}>
                          <span>₹</span>
                          <input
                            type="number"
                            step=".01"
                            value={item.manualFinal ?? Math.round(totals.lines[index]?.final ?? 0)}
                            title="Edit to override the calculated final. Clear to restore calculation."
                            onChange={(event) => updateItem(index, {
                              manualFinal: event.target.value === '' ? undefined : numeric(event.target.value),
                            })}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') updateItem(index, { manualFinal: undefined })
                            }}
                          />
                        </div>
                      </td>
                      <td><button className="pricing-remove-item" onClick={() => setItemToDelete({ index, name: item.name })} aria-label={`Delete ${item.name}`} title="Delete row"><Trash2 size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="pricing-totals-panel">
            <header><BadgeIndianRupee size={17} /><strong>Live totals</strong></header>
            <div>
              <TotalRow label="Input tax 5% base" value={totals.input5Base} />
              <TotalRow label="Input tax 18% base" value={totals.input18Base} />
              <TotalRow label="Input tax" value={totals.inputTax} />
              <TotalRow label="Output tax" value={totals.outputTax} />
              <TotalRow label="Kit Price" value={totals.kitPrice} />
              <TotalRow label="Cost To Us" value={totals.costToUs} />
              <TotalRow label="Without Loan" value={totals.withoutLoanPrice} prominent />
              <TotalRow label="With Loan" value={totals.withLoanPrice} prominent />
            </div>
          </aside>
        </div>
      ) : (
        <div className="all-pricing-view">
          <section className="all-pricing-grid">
            {priceOptions.map((option, index) => {
              const value = totals[option.key]
              const priorValue = index === 0 ? 0 : totals[priceOptions[index - 1].key]
              return (
                <article className={`all-price-card all-price-card--${option.key}`} key={option.key}>
                  <header><span>{String(index + 1).padStart(2, '0')}</span><b>{option.label}</b></header>
                  <strong>{formatMoney(value)}</strong>
                  <footer>{index === 0 ? `${state.systemKw} kW component package` : `+ ${formatMoney(value - priorValue)} from previous stage`}</footer>
                </article>
              )
            })}
          </section>

          <section className="pricing-smart-layout">
            <article className="pricing-customer-display">
              <header><span>Customer price</span><select value={state.showPrice} onChange={(event) => setState((current) => ({ ...current, showPrice: event.target.value as PriceKey }))}>{priceOptions.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></header>
              <div>
                <span>{state.projectName || 'Solar System Price'}</span>
                <b>{state.systemKw.toLocaleString('en-IN')} kW</b>
                <small>{selectedPrice.label}</small>
                <strong>{formatMoney(totals[selectedPrice.key])}</strong>
              </div>
            </article>

            <article className="pricing-margin-card">
              <header><TrendingUp size={17} /><strong>Margins</strong></header>
              <div className="pricing-margin-comparison">
                <div><span>Without loan margin</span><strong>{formatMoney(withoutLoanMargin)}</strong><small>{totals.withoutLoanPrice ? ((withoutLoanMargin / totals.withoutLoanPrice) * 100).toFixed(1) : '0.0'}% of selling price</small></div>
                <div><span>With loan margin</span><strong>{formatMoney(withLoanMargin)}</strong><small>{totals.withLoanPrice ? ((withLoanMargin / totals.withLoanPrice) * 100).toFixed(1) : '0.0'}% of selling price</small></div>
              </div>
              <footer>Loan price uplift: <strong>{formatMoney(totals.withLoanPrice - totals.withoutLoanPrice)}</strong></footer>
            </article>

            <article className="pricing-gst-card">
              <header><Calculator size={17} /><strong>GST</strong></header>
              <div><span>5% taxable base</span><b>{formatMoney(totals.input5Base)}</b></div>
              <div><span>18% taxable base</span><b>{formatMoney(totals.input18Base)}</b></div>
              <div><span>Total input tax</span><b>{formatMoney(totals.inputTax)}</b></div>
              <div><span>Output tax</span><b>{formatMoney(totals.outputTax)}</b></div>
              <footer><span>Output − input GST</span><strong>{formatMoney(gstDifference)}</strong></footer>
            </article>
          </section>
        </div>
      )}
      <AlertDialog
        open={Boolean(itemToDelete)}
        title={`Delete ${itemToDelete?.name || 'item'}?`}
        confirmLabel="Delete item"
        icon="delete"
        onCancel={() => setItemToDelete(null)}
        onConfirm={removeItem}
      />
      <AlertDialog
        open={resetOpen}
        title="Reset pricing?"
        confirmLabel="Reset pricing"
        variant="warning"
        icon="reset"
        onCancel={() => setResetOpen(false)}
        onConfirm={resetPricing}
      />
    </section>
  )
}

function TotalRow({ label, value, prominent = false }: { label: string; value: number; prominent?: boolean }) {
  return <div className={prominent ? 'prominent' : ''}><span>{label}</span><strong>{formatMoney(value)}</strong></div>
}
