import { describe, expect, it } from 'vitest'
import { projectDisplayName } from './project-name'

describe('projectDisplayName', () => {
  it('removes a generated customer suffix from a project name', () => {
    expect(projectDisplayName('3.4 kW solar EPC · Aryan Tembhekar', 'Aryan Tembhekar')).toBe('3.4 kW solar EPC')
  })

  it('preserves custom project names and meaningful separators', () => {
    expect(projectDisplayName('Phase 1 · Rooftop', 'Aryan Tembhekar')).toBe('Phase 1 · Rooftop')
    expect(projectDisplayName('Commercial rooftop', 'Aryan Tembhekar')).toBe('Commercial rooftop')
  })
})
