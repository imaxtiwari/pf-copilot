import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDbSelect = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@/db/schema', () => ({
  amfiSchemeMaster: {},
}))

import { crossCheckSchemes } from '@/lib/cas/amfi-master'

describe('crossCheckSchemes', () => {
  beforeEach(() => {
    mockDbSelect.mockReset()
  })

  it('returns empty result for empty input', async () => {
    const result = await crossCheckSchemes([])
    expect(result).toEqual({ matched: [], unmatched: [] })
  })

  it('matches schemes found in the AMFI master', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () =>
          Promise.resolve([
            { schemeName: 'Nifty 50 Index Fund - Direct Plan' },
          ]),
      }),
    })

    const result = await crossCheckSchemes(['Nifty 50 Index Fund'])
    expect(result.matched).toContain('Nifty 50 Index Fund')
    expect(result.unmatched).toHaveLength(0)
  })

  it('returns unmatched for schemes not in the AMFI master', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    })

    const result = await crossCheckSchemes(['Unknown Scheme'])
    expect(result.matched).toHaveLength(0)
    expect(result.unmatched).toContain('Unknown Scheme')
  })

  it('fails open when the database query throws', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({
        where: () => Promise.reject(new Error('DB down')),
      }),
    })

    const result = await crossCheckSchemes(['Some Scheme'])
    expect(result.matched).toContain('Some Scheme')
    expect(result.unmatched).toHaveLength(0)
  })
})