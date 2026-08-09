import { describe, expect, it } from 'vitest'
import { newMovementLineWithCopiedLocations, type MovementLine } from './InventoryPage'

function movementLine(overrides: Partial<MovementLine> = {}): MovementLine {
  return {
    key: 'previous',
    item_id: 'item-1',
    quantity: '12',
    stock_location_id: 'warehouse-1',
    endpoint_mode: 'manual',
    endpoint_location_id: '',
    endpoint_manual: 'Customer site',
    ...overrides,
  }
}

describe('newMovementLineWithCopiedLocations', () => {
  it('copies typed locations but starts with an empty item and quantity', () => {
    const next = newMovementLineWithCopiedLocations(movementLine())

    expect(next).toMatchObject({
      item_id: '',
      quantity: '',
      stock_location_id: 'warehouse-1',
      endpoint_mode: 'manual',
      endpoint_location_id: '',
      endpoint_manual: 'Customer site',
    })
  })

  it('copies selected saved locations', () => {
    const next = newMovementLineWithCopiedLocations(movementLine({
      endpoint_mode: 'stored',
      endpoint_location_id: 'site-2',
      endpoint_manual: '',
    }))

    expect(next).toMatchObject({
      stock_location_id: 'warehouse-1',
      endpoint_mode: 'stored',
      endpoint_location_id: 'site-2',
      endpoint_manual: '',
    })
  })
})
