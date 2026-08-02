import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const phoneWidths = [320, 375, 430, 768]
const styleFiles = [
  'base.css',
  'erp-shared.css',
  'shell-admin.css',
  'feedback.css',
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
      <main class="app-shell app-shell--view-mobile">
        <section class="app-main">
          <div class="app-viewport"><div class="route-transition">
            <section class="workspace-page erp-page inventory-page">
              <header class="erp-page-head">
                <div><span>Operations</span><h1>Inventory</h1></div>
                <div class="erp-head-actions">
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
    expect(new Set(actionTops).size).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    const pageBox = await page.locator('.inventory-page').boundingBox()
    expect(pageBox).not.toBeNull()
    expect(pageBox!.x).toBeGreaterThanOrEqual(0)
    expect(pageBox!.x + pageBox!.width).toBeLessThanOrEqual(width + 1)
  })

  test(`portal overlays and toast fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.setContent(`
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
