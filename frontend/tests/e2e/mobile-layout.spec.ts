import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const phoneWidths = [320, 375, 430, 768]
const styleFiles = [
  'design-tokens.css',
  'base.css',
  'ui-primitives.css',
  'erp-shared.css',
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
