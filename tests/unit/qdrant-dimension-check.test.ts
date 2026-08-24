import { describe, it, expect, vi } from 'vitest'
import { validateQdrantDimension } from '@/lib/qdrant/dimension-check'

describe('validateQdrantDimension', () => {
  it('returns ok when no collections are configured', async () => {
    const result = await validateQdrantDimension('http://localhost:6333', 1536, [])
    expect(result.ok).toBe(true)
  })

  it('returns ok when collection sizes match', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        result: { config: { params: { vectors: { size: 1536 } } } },
      }),
    } as Response)

    const result = await validateQdrantDimension('http://localhost:6333', 1536, ['memory'])
    expect(result.ok).toBe(true)
  })

  it('returns mismatch when collection size differs', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        result: { config: { params: { vectors: { size: 3072 } } } },
      }),
    } as Response)

    const result = await validateQdrantDimension('http://localhost:6333', 1536, ['memory'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.mismatches).toEqual([{ collection: 'memory', expected: 1536, actual: 3072 }])
    }
  })

  it('returns mismatch when collection info cannot be read', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response)

    const result = await validateQdrantDimension('http://localhost:6333', 1536, ['memory'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.mismatches[0]).toEqual({ collection: 'memory', expected: 1536, actual: -1 })
    }
  })

  it('is skipped when qdrantUrl is not provided', async () => {
    const result = await validateQdrantDimension(undefined, 1536, ['memory'])
    expect(result.ok).toBe(true)
  })
})
