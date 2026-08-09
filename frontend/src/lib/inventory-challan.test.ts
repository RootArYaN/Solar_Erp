import { describe, expect, it } from 'vitest'
import type { InventoryMovement } from '../erp-types'
import { createInventoryChallanPdf, inventoryChallanFileName } from './inventory-challan'

const movement: InventoryMovement = {
  id: 'movement-1', item_id: 'item-1', item_name: 'Solar panel', item_sku: 'PV-550', item_unit: 'Nos',
  movement_type: 'outward', quantity: 12, source_location_id: 'warehouse-1', source_location_name: 'Main warehouse', source_location_manual: '',
  destination_location_id: null, destination_location_name: '', destination_location_manual: 'Customer site', project_id: null, project_number: '',
  customer_id: null, customer_name: '', reference_number: 'CH-2026/001', movement_group_id: 'group-1', challan_date: '2026-08-08',
  partner_name: 'Asha Patel', transporter_name: 'Fast Transport', vehicle_number: 'GJ01AB1234', driver_name: 'Ravi', driver_phone: '9999999999',
  eway_bill_number: 'EWB-1', note: 'Handle with care', status: 'completed', created_at: '2026-08-08T06:00:00Z',
}

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('inventory challan PDF', () => {
  it('includes the challan, item, route and transport details', async () => {
    const blob = createInventoryChallanPdf([movement], 'Solar EPC', 'Admin User')
    expect(blob?.type).toBe('application/pdf')
    const source = await readBlob(blob as Blob)
    expect(source).toContain('%ERP-INVENTORY-CHALLAN')
    expect(source).toContain('CH-2026/001')
    expect(source).toContain('Solar panel')
    expect(source).toContain('Customer site')
    expect(source).toContain('GJ01AB1234')
  })

  it('creates a filesystem-safe filename', () => {
    expect(inventoryChallanFileName('CH-2026/001')).toBe('CH-2026-001.pdf')
  })
})
