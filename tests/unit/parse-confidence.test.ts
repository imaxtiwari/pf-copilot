import { describe, it, expect } from 'vitest'
import { scoreParseResult, VISION_FALLBACK_THRESHOLD } from '@/lib/cas/parse-confidence'
import type { CASExtraction } from '@/lib/contracts/cas-validation'
import type { SchemeCheckResult } from '@/lib/cas/amfi-master'

describe('CAS Parse Confidence Unit Tests', () => {
  it('All holdings match, total value within 2% -> score >= 70, no fallback', () => {
    const extraction: CASExtraction = {
      holdings: Array(5).fill({ scheme_name: 'Fund', market_value: 20000, folio_number: '123' }),
      total_value_reported: 99000 // computed is 100k, diff 1%
    } as any
    const schemeCheck: SchemeCheckResult = {
      matched: Array(5).fill({}),
      unmatched: []
    }

    const result = scoreParseResult(extraction, schemeCheck)
    
    expect(result.holdingsFound).toBe(5)
    expect(result.totalValueMatch).toBe(true)
    expect(result.folioCountMatch).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(VISION_FALLBACK_THRESHOLD)
  })

  it('3 of 12 holdings found -> score < 70, vision fallback triggered', () => {
    const extraction: CASExtraction = {
      holdings: Array(3).fill({ scheme_name: 'Fund', market_value: 10000, folio_number: '123' }),
      total_value_reported: 120000
    } as any
    const schemeCheck: SchemeCheckResult = {
      matched: Array(1).fill({}),
      unmatched: Array(2).fill({})
    } // 33% resolution

    const result = scoreParseResult(extraction, schemeCheck)
    
    expect(result.holdingsFound).toBe(3)
    expect(result.totalValueMatch).toBe(false)
    expect(result.score).toBeLessThan(VISION_FALLBACK_THRESHOLD)
  })

  it('Total value off by 5% -> totalValueMatch false, score drops', () => {
    const extraction: CASExtraction = {
      holdings: Array(5).fill({ scheme_name: 'Fund', market_value: 20000, folio_number: '123' }),
      total_value_reported: 105000 // off by 5%
    } as any
    const schemeCheck: SchemeCheckResult = {
      matched: Array(5).fill({}),
      unmatched: []
    }

    const result = scoreParseResult(extraction, schemeCheck)
    
    expect(result.totalValueMatch).toBe(false)
    expect(result.folioCountMatch).toBe(true)
    expect(result.score).toBeLessThan(VISION_FALLBACK_THRESHOLD)
  })
})
