import { describe, it, expect, afterEach, vi } from 'vitest'

describe('POLICY config', () => {
  const keys = [
    'PORTFOLIO_ALLOCATION_TOLERANCE_PCT',
    'PORTFOLIO_MAX_SINGLE_FUND_PCT',
    'PORTFOLIO_MAX_REVISIONS',
    'ARIA_MINOR_FAULT_LIMIT',
    'KIRAN_MIN_HEDGE_COVERAGE_PCT',
    'EMBEDDING_DIMENSION',
    'QDRANT_COLLECTIONS',
    'STRUCTURED_OUTPUT_MAX_ATTEMPTS',
    'STRUCTURED_OUTPUT_BASE_DELAY_MS',
  ] as const

  const original: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original[key]
      }
    }
  })

  it('provides sensible defaults', async () => {
    for (const key of keys) {
      original[key] = process.env[key]
      delete process.env[key]
    }

    vi.resetModules()
    const { POLICY } = await import('@/lib/config/policy')
    expect(POLICY.portfolio.allocationTolerancePct).toBe(0.5)
    expect(POLICY.portfolio.maxSingleFundConcentrationPct).toBe(25)
    expect(POLICY.portfolio.indexFundConcentrationExemption).toBe(true)
    expect(POLICY.portfolio.maxRevisions).toBe(5)
    expect(POLICY.aria.minorFaultLimit).toBe(3)
    expect(POLICY.kiran.minHedgeCoveragePct).toBe(80)
    expect(POLICY.qdrant.embeddingDimension).toBe(1536)
    expect(POLICY.qdrant.collections).toEqual([])
    expect(POLICY.structuredOutput.maxAttempts).toBe(3)
    expect(POLICY.structuredOutput.baseDelayMs).toBe(500)
  })

  it('reads overrides from environment variables', async () => {
    for (const key of keys) {
      original[key] = process.env[key]
    }
    process.env.PORTFOLIO_ALLOCATION_TOLERANCE_PCT = '1.0'
    process.env.PORTFOLIO_MAX_SINGLE_FUND_PCT = '30'
    process.env.PORTFOLIO_MAX_REVISIONS = '7'
    process.env.ARIA_MINOR_FAULT_LIMIT = '5'
    process.env.KIRAN_MIN_HEDGE_COVERAGE_PCT = '85'
    process.env.EMBEDDING_DIMENSION = '3072'
    process.env.QDRANT_COLLECTIONS = 'factsheet_chunks,stock_documents'
    process.env.STRUCTURED_OUTPUT_MAX_ATTEMPTS = '5'

    vi.resetModules()
    const { POLICY } = await import('@/lib/config/policy')
    expect(POLICY.portfolio.allocationTolerancePct).toBe(1.0)
    expect(POLICY.portfolio.maxSingleFundConcentrationPct).toBe(30)
    expect(POLICY.portfolio.maxRevisions).toBe(7)
    expect(POLICY.aria.minorFaultLimit).toBe(5)
    expect(POLICY.kiran.minHedgeCoveragePct).toBe(85)
    expect(POLICY.qdrant.embeddingDimension).toBe(3072)
    expect(POLICY.qdrant.collections).toEqual(['factsheet_chunks', 'stock_documents'])
    expect(POLICY.structuredOutput.maxAttempts).toBe(5)
  })

  it('falls back when env values are invalid', async () => {
    for (const key of keys) {
      original[key] = process.env[key]
      delete process.env[key]
    }
    process.env.PORTFOLIO_ALLOCATION_TOLERANCE_PCT = 'not-a-number'
    process.env.EMBEDDING_DIMENSION = 'also-not-a-number'

    vi.resetModules()
    const { POLICY } = await import('@/lib/config/policy')
    expect(POLICY.portfolio.allocationTolerancePct).toBe(0.5)
    expect(POLICY.qdrant.embeddingDimension).toBe(1536)
  })
})
