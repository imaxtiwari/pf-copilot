import { describe, it, expect } from 'vitest'
import { computeConfidenceScore } from '../../lib/agents/priya'

describe('Portfolio Confidence Score Unit Tests', () => {
  it('should return a score of 100 when all 5 components are present and passing', () => {
    const result = computeConfidenceScore({
      dataFresh: true,
      achievabilityVerdict: 'ACHIEVABLE',
      overallHedgeCoveragePct: 85,
      critiqueFaults: [],
      backtestPeriodYears: 6,
      backtestCompletenessPct: 80
    })

    expect(result.total).toBe(100)
    expect(result.breakdown.data_freshness).toBe(20)
    expect(result.breakdown.goal_achievability).toBe(20)
    expect(result.breakdown.hedge_completeness).toBe(20)
    expect(result.breakdown.critique_severity).toBe(20)
    expect(result.breakdown.backtest_quality).toBe(20)
    expect(result.blocking_reasons).toHaveLength(0)
  })

  it('should return a score of 40 and list blocking reasons for ACHIEVABLE verdict + CRITICAL fault', () => {
    const result = computeConfidenceScore({
      dataFresh: true, // +20
      achievabilityVerdict: 'ACHIEVABLE', // +20
      overallHedgeCoveragePct: 75, // +0 (blocked)
      critiqueFaults: [{ severity: 'CRITICAL' }], // +0 (blocked)
      backtestPeriodYears: 4, // +0
      backtestCompletenessPct: 80
    })

    expect(result.total).toBe(40)
    expect(result.blocking_reasons).toContain('Aria Critique contains blocking CRITICAL faults.')
    expect(result.blocking_reasons).toContain('Hedge Map coverage is below 80% (75%).')
  })

  it('should return a score of 90 and be allowed for REVISED verdict + no faults + full backtest', () => {
    const result = computeConfidenceScore({
      dataFresh: true, // +20
      achievabilityVerdict: 'REVISED', // +10
      overallHedgeCoveragePct: 85, // +20
      critiqueFaults: [], // +20
      backtestPeriodYears: 5, // +20
      backtestCompletenessPct: 75
    })

    expect(result.total).toBe(90)
    expect(result.blocking_reasons).toHaveLength(0)
  })

  it('should set goal_achievability to 0 regardless of other components for IMPOSSIBLE verdict', () => {
    const result = computeConfidenceScore({
      dataFresh: true,
      achievabilityVerdict: 'IMPOSSIBLE',
      overallHedgeCoveragePct: 90,
      critiqueFaults: [],
      backtestPeriodYears: 7,
      backtestCompletenessPct: 90
    })

    expect(result.breakdown.goal_achievability).toBe(0)
    expect(result.total).toBe(80)
    expect(result.blocking_reasons).toContain('Stated goal achievability verdict is IMPOSSIBLE.')
  })

  it('should verify boundary conditions: score exactly 60 is allowed, score below 60 is blocked', () => {
    const score60 = computeConfidenceScore({
      dataFresh: true, // +20
      achievabilityVerdict: 'REVISED', // +10
      overallHedgeCoveragePct: 85, // +20
      critiqueFaults: [{ severity: 'MAJOR' }], // +10
      backtestPeriodYears: 4, // +0
      backtestCompletenessPct: 50
    })
    expect(score60.total).toBe(60)
    expect(score60.blocking_reasons).toHaveLength(0) // No blockers (no critical faults, coverage >= 80, freshness = true, verdict != IMPOSSIBLE)

    const score40 = computeConfidenceScore({
      dataFresh: true, // +20
      achievabilityVerdict: 'REVISED', // +10
      overallHedgeCoveragePct: 70, // +0 (blocked)
      critiqueFaults: [{ severity: 'MAJOR' }], // +10
      backtestPeriodYears: 4, // +0
      backtestCompletenessPct: 50
    })
    expect(score40.total).toBe(40)
    expect(score40.blocking_reasons).toContain('Hedge Map coverage is below 80% (70%).')
  })
})
