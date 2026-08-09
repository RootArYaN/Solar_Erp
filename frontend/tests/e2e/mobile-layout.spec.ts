import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const phoneWidths = [320, 375, 430, 768]
const styleFiles = [
  'design-tokens.css',
  'base.css',
  'ui-primitives.css',
  'erp-shared.css',
  'shell.css',
  'shell-admin.css',
  'agents.css',
  'documents-posters.css',
  'operations.css',
  'feedback.css',
  'workflow.css',
  'finance.css',
  'workspace.css',
  'ui-system.css',
]

async function loadStyles(page: Page) {
  for (const file of styleFiles) {
    await page.addStyleTag({ path: path.resolve('src/styles', file) })
  }
}

for (const width of phoneWidths) {
  test(`sidebar menu button stays visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell">
        <section class="app-main">
          <header class="app-topbar">
            <button class="icon-button app-menu-button" aria-label="Open menu">☰</button>
          </header>
          <div class="app-viewport"><div style="height: 1600px"></div></div>
        </section>
      </main>
    `)
    await loadStyles(page)

    const menuButton = page.getByRole('button', { name: 'Open menu' })
    await expect(menuButton).toBeVisible()
    await expect(menuButton).toHaveCSS('display', 'grid')

    const buttonBox = await menuButton.boundingBox()
    expect(buttonBox).not.toBeNull()
    expect(buttonBox!.x).toBeGreaterThanOrEqual(0)
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(width)
  })
}

for (const width of phoneWidths) {
  test(`inventory toolbar and records fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell app-shell--view-mobile">
        <section class="app-main">
          <div class="app-viewport"><div class="route-transition">
            <section class="workspace-page erp-page inventory-page">
              <header class="erp-page-head">
                <div><span>Operations</span><h1>Inventory</h1></div>
                <div class="erp-head-actions inventory-head-actions">
                  <button class="secondary-button">↻ Refresh</button>
                  <button class="secondary-button inventory-action--inward">⇥ Inward</button>
                  <button class="secondary-button inventory-action--outward">⇤ Outward</button>
                  <button class="secondary-button">▣ Location</button>
                  <button class="primary-button">＋ Add item</button>
                </div>
              </header>
              <nav class="erp-tabs inventory-main-tabs"><button>Stock &amp; locations</button><button>Inventory history</button></nav>
              <div class="inventory-workspace-body"><div class="inventory-stock-grid">
                <section class="erp-panel inventory-items-panel">
                  <div class="erp-toolbar"><label class="erp-search"><input placeholder="Search inventory" /></label><select><option>All</option></select></div>
                  <div class="erp-table-wrap"><table class="erp-table inventory-table inventory-items-table"><tbody>
                    <tr><td data-label="Item"><strong>Solar panel</strong><small>SKU-001</small></td><td data-label="Location">Main warehouse</td><td data-label="Available"><strong>24</strong></td><td data-label="Actions"><div class="table-row-actions"><button>Edit</button><button>Outward</button></div></td></tr>
                  </tbody></table></div>
                </section>
              </div></div>
            </section>
          </div></div>
        </section>
      </main>
    `)
    await loadStyles(page)

    const actionTops = await page.locator('.erp-head-actions button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)))
    const toolbarLayout = await page.locator('.inventory-head-actions').evaluate((toolbar) => ({
      columns: getComputedStyle(toolbar).gridTemplateColumns,
      containerWidth: toolbar.closest('.app-viewport')?.clientWidth,
    }))
    expect(new Set(actionTops).size, `Inventory actions should share one row: ${JSON.stringify(toolbarLayout)}`).toBe(1)
    const actionMetrics = await page.locator('.erp-head-actions button').evaluateAll((buttons) => buttons.map((button) => ({
      clientWidth: button.clientWidth,
      offsetHeight: button.offsetHeight,
      scrollWidth: button.scrollWidth,
    })))
    expect(
      actionMetrics.every(({ clientWidth, offsetHeight, scrollWidth }) => scrollWidth <= clientWidth && offsetHeight >= 44),
      `Inventory actions should fit and retain a 44px touch target: ${JSON.stringify(actionMetrics)}`,
    ).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    const pageBox = await page.locator('.inventory-page').boundingBox()
    expect(pageBox).not.toBeNull()
    expect(pageBox!.x).toBeGreaterThanOrEqual(0)
    expect(pageBox!.x + pageBox!.width).toBeLessThanOrEqual(width + 1)
  })

  test(`inventory history actions stay on one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell app-shell--view-mobile">
        <section class="app-main"><div class="app-viewport"><div class="route-transition">
          <section class="workspace-page erp-page inventory-page">
            <section class="erp-panel inventory-history-panel">
              <header><div><span>Inventory history</span><h2>Movement ledger</h2></div><div class="inventory-history-controls">
                <label class="erp-search inventory-history-search"><span aria-hidden="true">⌕</span><input aria-label="Search inventory history" placeholder="Search item, challan, party or location" /></label>
                <nav class="erp-tabs inventory-history-tabs"><button>all</button><button>inward</button><button>outward</button></nav>
              </div></header>
              <div class="erp-table-wrap"><table class="erp-table inventory-table inventory-history-table"><tbody>
                <tr><td data-label="Status"><span class="soft-badge">Completed</span></td><td data-label="Actions"><div class="table-row-actions">
                  <button class="secondary-button secondary-button--compact" aria-label="Download challan">↓</button>
                  <button class="secondary-button secondary-button--compact" aria-label="Correct movement">⌕</button>
                  <button class="secondary-button secondary-button--compact" aria-label="Reverse movement">↶</button>
                </div></td></tr>
              </tbody></table></div>
            </section>
          </section>
        </div></div></section>
      </main>
    `)
    await loadStyles(page)

    const search = page.getByRole('textbox', { name: 'Search inventory history' })
    const searchBox = await search.boundingBox()
    const tabsBox = await page.locator('.inventory-history-tabs').boundingBox()
    await expect(search).toBeVisible()
    expect(searchBox).not.toBeNull()
    expect(tabsBox).not.toBeNull()
    expect(tabsBox!.y).toBeGreaterThanOrEqual(searchBox!.y + searchBox!.height)
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(width + 1)

    const buttons = page.locator('.inventory-history-table .table-row-actions button')
    await expect(buttons).toHaveCount(3)
    const boxes = await buttons.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()))
    expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1)
    expect(boxes.every((box) => box.width >= 44 && box.left >= 0 && box.right <= width + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test(`portal overlays and toast fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div class="modal-layer">
        <section class="modal-card inventory-movement-modal">
          <header class="modal-card__header"><div><h2>Inventory inward / outward</h2><p>Post stock movement safely.</p></div><button class="icon-button">×</button></header>
          <div class="modal-card__body"><form class="erp-form inventory-movement-form">
            <section class="movement-choice"><span>Movement</span><div><button>Inward</button><button>Outward</button></div></section>
            <section class="movement-lines"><header><div><strong>Items received</strong><small>Each row can use a different location.</small></div></header><article class="movement-line"><span class="movement-line__number">1</span><label><span>Item</span><select><option>Solar panel</option></select></label><label><span>Quantity</span><input value="1" /></label><div class="movement-endpoint"><span>Coming from</span><input value="Supplier" /></div></article></section>
            <footer class="erp-form-actions"><button>Cancel</button><button>Post entry</button></footer>
          </form></div>
        </section>
      </div>
      <div class="toast-viewport"><article class="toast toast--success"><div class="toast__icon">✓</div><div class="toast__content"><strong>Inventory updated</strong><span>The movement was posted successfully.</span></div><button>×</button></article></div>
    `)
    await page.locator('body').evaluate((body) => body.classList.add('app-preview-mobile'))
    await loadStyles(page)

    for (const selector of ['.modal-card', '.toast-viewport']) {
      const box = await page.locator(selector).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

test('mobile pages retain semantic titles while only the dashboard greeting stays visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 820 })
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <main class="app-shell app-shell--view-mobile">
      <section class="app-main"><div class="app-viewport"><div class="route-transition">
        <section class="workspace-page">
          <header class="workspace-header">
            <div class="workspace-header__copy"><span>Company finance</span><h1>Finance</h1></div>
          </header>
        </section>
        <section class="workspace-page">
          <header class="workspace-header dashboard-header">
            <div class="workspace-header__copy"><span>Operations overview</span><h1>Good to see you, Aryan.</h1></div>
            <div class="workspace-header__actions"><button class="ui-button ui-button--icon" aria-label="Refresh dashboard">↻</button></div>
          </header>
        </section>
      </div></div></section>
    </main>
  `)
  await loadStyles(page)

  await expect(page.getByRole('heading', { name: 'Finance' })).toBeAttached()
  await expect(page.getByRole('heading', { name: 'Good to see you, Aryan.' })).toBeVisible()

  const financeCopy = await page.locator('.workspace-header:not(.dashboard-header) .workspace-header__copy').boundingBox()
  const dashboardCopy = await page.locator('.dashboard-header .workspace-header__copy').boundingBox()
  expect(financeCopy).not.toBeNull()
  expect(financeCopy!.width).toBeLessThanOrEqual(1)
  expect(dashboardCopy).not.toBeNull()
  expect(dashboardCopy!.width).toBeGreaterThan(1)
})

test('document preview title and zoom controls stay inline at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 })
  await page.setContent(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <main class="app-shell app-shell--view-mobile">
      <section class="app-main"><div class="app-viewport"><div class="route-transition">
        <section class="workspace-page document-page">
          <div class="generated-pack-preview">
            <header class="generated-pack-preview__head">
              <div><span>◉ Live preview</span><strong>Feasibility Report</strong></div>
              <div class="generated-pack-zoom" aria-label="Preview zoom controls">
                <button type="button" aria-label="Zoom out">−</button><span>50%</span>
                <button type="button" aria-label="Zoom in">＋</button><button type="button" class="is-active">Fit</button>
              </div>
            </header>
            <nav class="generated-pack-tabs"><button class="is-active">Feasibility</button></nav>
            <div class="generated-pack-preview__scroll"></div>
          </div>
        </section>
      </div></div></section>
    </main>
  `)
  await page.locator('body').evaluate((body) => body.classList.add('app-preview-mobile'))
  await loadStyles(page)

  const titleBox = await page.locator('.generated-pack-preview__head > div:first-child').boundingBox()
  const zoomBox = await page.locator('.generated-pack-zoom').boundingBox()
  const headerBox = await page.locator('.generated-pack-preview__head').boundingBox()
  expect(titleBox).not.toBeNull()
  expect(zoomBox).not.toBeNull()
  expect(headerBox).not.toBeNull()
  expect(zoomBox!.x).toBeGreaterThan(titleBox!.x)
  expect(zoomBox!.y).toBeLessThan(titleBox!.y + titleBox!.height)
  expect(headerBox!.height).toBeLessThanOrEqual(66)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

for (const mode of [
  { name: 'real phone', width: 375, preview: false },
  { name: 'mobile preview', width: 1024, preview: true },
]) {
  test(`quotation builder stays compact in ${mode.name} mode`, async ({ page }) => {
    await page.setViewportSize({ width: mode.width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <div class="modal-layer"><section class="modal-card quotation-builder-modal">
        <header class="modal-card__header"><div><h2>Generate quotation</h2></div><button class="icon-button" aria-label="Close dialog">×</button></header>
        <div class="modal-card__body"><form class="admin-form quotation-builder">
          <div class="workflow-customer-strip"><strong>Sample customer</strong><span>Agent · 3 kW</span></div>
          <div class="admin-form__grid"><label class="field"><span>Quotation title</span><div class="field__control"><input value="3 kW solar EPC" /></div></label><label class="field"><span>Valid until</span><div class="field__control"><input type="date" value="2026-09-08" /></div></label></div>
          <div class="quotation-lines"><div class="quotation-line quotation-line--header"><span>Description</span><span>Qty</span><span>Unit</span><span>Unit price</span><span>Tax %</span><span></span></div>
            <div class="quotation-line">
              <label class="quotation-line__field quotation-line__field--description"><span>Description</span><input value="Solar modules and inverter" /></label>
              <label class="quotation-line__field"><span>Quantity</span><input value="1" /></label>
              <label class="quotation-line__field"><span>Unit</span><input value="Lot" /></label>
              <label class="quotation-line__field"><span>Unit price</span><input value="0" /></label>
              <label class="quotation-line__field"><span>Tax %</span><input value="5" /></label>
              <div class="quotation-line__actions"><span>Item 1</span><button class="icon-button" aria-label="Remove line 1">⌫</button></div>
            </div>
          </div>
          <div class="quotation-builder-footer"><button class="secondary-button">Add line</button><div><span>Subtotal ₹0</span><span>Tax ₹0</span><strong>Total ₹0</strong></div></div>
        </form></div>
        <footer class="quotation-builder-actions"><button class="secondary-button">Cancel</button><button class="primary-button">Save for approval</button></footer>
      </section></div>
    `)
    if (mode.preview) await page.locator('body').evaluate((body) => body.classList.add('app-preview-mobile'))
    await loadStyles(page)

    for (const label of ['Description', 'Quantity', 'Unit', 'Unit price', 'Tax %', 'Item 1']) {
      await expect(page.getByText(label, { exact: true }).last()).toBeVisible()
    }

    const layout = await page.locator('.quotation-line:not(.quotation-line--header)').evaluate((line) => {
      const fields = Array.from(line.querySelectorAll<HTMLElement>('.quotation-line__field')).map((field) => field.getBoundingClientRect().toJSON())
      const actions = line.querySelector<HTMLElement>('.quotation-line__actions')!.getBoundingClientRect().toJSON()
      return { fields, actions }
    })
    expect(layout.fields[1].top).toBe(layout.fields[2].top)
    expect(layout.fields[3].top).toBe(layout.fields[4].top)
    expect(layout.fields[1].top).toBeGreaterThan(layout.fields[0].top)
    expect(layout.actions.top).toBeGreaterThan(layout.fields[3].top)

    const modal = await page.locator('.quotation-builder-modal').boundingBox()
    const footer = await page.locator('.quotation-builder-actions').boundingBox()
    expect(modal).not.toBeNull()
    expect(footer).not.toBeNull()
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(modal!.y + modal!.height + 1)
    expect(footer!.x).toBeGreaterThanOrEqual(modal!.x)
    expect(footer!.x + footer!.width).toBeLessThanOrEqual(modal!.x + modal!.width + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

for (const width of [375, 1440]) {
  test(`customer summary typography remains readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell">
        <section class="app-main"><div class="app-viewport"><div class="route-transition">
          <section class="workspace-page customer-detail-page">
            <div class="customer-detail-layout">
              <aside class="customer-directory"></aside>
              <main class="customer-workspace">
                <div class="workspace-kpi-grid ui-kpi-grid customer-summary-grid" data-columns="4" data-phone-columns="1" data-responsive="true" style="--workspace-kpi-columns: 4">
                  <article class="ui-kpi-card"><span class="ui-kpi-card__icon">◫</span><div class="ui-kpi-card__content"><span class="ui-kpi-card__label">Current project</span><strong class="ui-kpi-card__value">PRJ-2026-152B65A9</strong><small class="ui-kpi-card__note">3.24 kW · Loan</small></div></article>
                  <article class="ui-kpi-card"><span class="ui-kpi-card__icon">◷</span><div class="ui-kpi-card__content"><span class="ui-kpi-card__label">Current stage</span><strong class="ui-kpi-card__value">Loan application submitted</strong><small class="ui-kpi-card__note">50% complete</small></div></article>
                  <article class="ui-kpi-card"><span class="ui-kpi-card__icon">₹</span><div class="ui-kpi-card__content"><span class="ui-kpi-card__label">Approved value</span><strong class="ui-kpi-card__value">₹1,60,000</strong><small class="ui-kpi-card__note">QUO-2026-7CFDE976-R1</small></div></article>
                  <article class="ui-kpi-card"><span class="ui-kpi-card__icon">✓</span><div class="ui-kpi-card__content"><span class="ui-kpi-card__label">Received / pending</span><strong class="ui-kpi-card__value">₹0</strong><small class="ui-kpi-card__note">₹1,60,000 pending</small></div></article>
                </div>
              </main>
            </div>
          </section>
        </div></div></section>
      </main>
    `)
    await loadStyles(page)

    const values = page.locator('.customer-summary-grid .ui-kpi-card__value')
    await expect(values).toHaveCount(4)
    const typography = await values.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element)
      return {
        fontSize: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
        whiteSpace: style.whiteSpace,
        height: element.getBoundingClientRect().height,
      }
    }))
    expect(typography.every(({ fontSize }) => fontSize >= 14 && fontSize <= 16)).toBe(true)
    expect(typography.every(({ whiteSpace }) => whiteSpace === 'normal')).toBe(true)
    expect(typography.every(({ height, lineHeight }) => height <= (lineHeight * 2) + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

for (const mode of [
  { name: 'real phone', width: 375, shellClass: '' },
  { name: 'mobile preview', width: 1024, shellClass: 'app-shell--view-mobile' },
]) {
  test(`customer document controls stack in ${mode.name} mode`, async ({ page }) => {
    await page.setViewportSize({ width: mode.width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell ${mode.shellClass}">
        <section class="app-main"><div class="app-viewport"><div class="route-transition">
          <section class="workspace-page customer-detail-page">
            <main class="customer-workspace">
              <div class="tab-toolbar customer-documents-toolbar">
                <div class="customer-documents-toolbar__copy">
                  <strong>Customer documents</strong>
                  <span>5 of 5 stored files</span>
                </div>
                <div class="customer-documents-toolbar__actions">
                  <label class="customer-document-search">
                    <span aria-hidden="true">⌕</span>
                    <input aria-label="Search customer documents" placeholder="Search filename or document type" />
                  </label>
                  <label class="primary-button primary-button--compact">Upload<input hidden type="file" /></label>
                </div>
              </div>
            </main>
          </section>
        </div></div></section>
      </main>
    `)
    await loadStyles(page)

    const layout = await page.locator('.customer-documents-toolbar').evaluate((toolbar) => {
      const title = toolbar.querySelector('.customer-documents-toolbar__copy')!.getBoundingClientRect()
      const actions = toolbar.querySelector('.customer-documents-toolbar__actions')!.getBoundingClientRect()
      const search = toolbar.querySelector('.customer-document-search')!.getBoundingClientRect()
      const upload = toolbar.querySelector('.primary-button')!.getBoundingClientRect()
      return {
        toolbar: toolbar.getBoundingClientRect().toJSON(),
        title: title.toJSON(),
        actions: actions.toJSON(),
        search: search.toJSON(),
        upload: upload.toJSON(),
      }
    })

    expect(layout.actions.top).toBeGreaterThanOrEqual(layout.title.bottom)
    expect(layout.search.width).toBeGreaterThanOrEqual(layout.actions.width - 1)
    expect(layout.upload.width).toBeGreaterThanOrEqual(layout.actions.width - 1)
    expect(layout.upload.top).toBeGreaterThanOrEqual(layout.search.bottom)
    expect(layout.search.left).toBeGreaterThanOrEqual(layout.toolbar.left)
    expect(layout.search.right).toBeLessThanOrEqual(layout.toolbar.right + 1)
    expect(layout.upload.right).toBeLessThanOrEqual(layout.toolbar.right + 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

for (const width of [375, 1440]) {
  test(`finance date filters fit overview, bills, and profitability at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <main class="app-shell ${width <= 430 ? 'app-shell--view-mobile' : ''}">
        <aside class="app-sidebar"></aside>
        <section class="app-main"><div class="app-viewport"><div class="route-transition">
          <section class="workspace-page finance-page">
            <div class="finance-tab-panel finance-tab-panel--overview">
              <div class="finance-range-toolbar">
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>From</small><span class="date-filter-control__value">01/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-01" /></label>
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>To</small><span class="date-filter-control__value">31/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-31" /></label>
                <button class="secondary-button finance-range-apply">Apply</button>
              </div>
            </div>
            <div class="finance-tab-panel finance-tab-panel--bills">
              <div class="finance-bills-toolbar">
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>From</small><span class="date-filter-control__value">01/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-01" /></label>
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>To</small><span class="date-filter-control__value">31/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-31" /></label>
                <label class="finance-bill-type"><select><option>All bills</option></select></label>
                <button class="secondary-button finance-bill-apply">Apply</button>
                <button class="primary-button finance-bill-create">Create bill</button>
              </div>
            </div>
            <div class="finance-tab-panel finance-tab-panel--profitability">
              <div class="finance-range-toolbar">
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>From</small><span class="date-filter-control__value">01/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-01" /></label>
                <label class="date-filter-control finance-date-field"><span class="date-filter-control__copy"><small>To</small><span class="date-filter-control__value">31/08/26</span></span><span aria-hidden="true">▣</span><input type="date" value="2026-08-31" /></label>
                <button class="secondary-button finance-range-apply">Apply</button>
              </div>
            </div>
          </section>
        </div></div></section>
      </main>
    `)
    await loadStyles(page)

    await expect(page.getByText('From')).toHaveCount(3)
    await expect(page.getByText('To')).toHaveCount(3)
    const controls = page.locator('.finance-date-field, .finance-range-apply, .finance-bill-type, .finance-bill-apply, .finance-bill-create')
    const boxes = await controls.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()))
    expect(boxes.every((box) => box.width > 0 && box.left >= 0 && box.right <= width + 1)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}
