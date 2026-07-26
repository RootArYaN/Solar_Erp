import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientId } from './client-id'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createClientId', () => {
  it('creates UUIDs when randomUUID is unavailable on an insecure LAN origin', () => {
    let seed = 0
    vi.stubGlobal('crypto', {
      getRandomValues<T extends ArrayBufferView>(value: T): T {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        bytes.forEach((_, index) => { bytes[index] = (seed + index) % 256 })
        seed += 17
        return value
      },
    })

    const first = createClientId()
    const second = createClientId()

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(second).not.toBe(first)
  })
})
