import { describe, it, expect } from 'vitest'
import { computeXIRR, computePortfolioXIRR } from '../../lib/portfolio/xirr'

describe('computeXIRR', () => {
    it('returns null for fewer than 2 cash flows', () => {
        expect(computeXIRR([{ date: new Date('2024-03-31'), amount: -10000 }])).toBeNull()
    })

    it('matches Excel/Google Sheets XIRR for a known series', () => {
        // 10000 invested on 2024-01-01, valued at 11000 on 2024-12-31
        // Expected XIRR ≈ 10%
        const flows = [
            { date: new Date('2024-01-01'), amount: -10000 },
            { date: new Date('2024-12-31'), amount: 11000 },
        ]
        const xirr = computeXIRR(flows)
        expect(xirr).toBeCloseTo(0.1, 2)
    })

    it('handles multiple equal-year growth correctly', () => {
        // 10000 → 12100 over 2 years is ~10% annualized
        const flows = [
            { date: new Date('2022-03-31'), amount: -10000 },
            { date: new Date('2024-03-31'), amount: 12100 },
        ]
        const xirr = computeXIRR(flows)
        expect(xirr).toBeCloseTo(0.1, 2)
    })

    it('decreases with a redemption during the period', () => {
        const baseFlows = [
            { date: new Date('2024-01-01'), amount: -10000 },
            { date: new Date('2024-12-31'), amount: 11000 },
        ]
        const baseXirr = computeXIRR(baseFlows)

        // Redeemed 1000 in July and ended with less overall value => lower IRR
        const withRedemption = [
            { date: new Date('2024-01-01'), amount: -10000 },
            { date: new Date('2024-07-01'), amount: 1000 },
            { date: new Date('2024-12-31'), amount: 9500 },
        ]
        const redeemedXirr = computeXIRR(withRedemption)

        expect(baseXirr).toBeGreaterThan(redeemedXirr ?? Infinity)
    })

    it('returns 0 when total inflows equal total outflows', () => {
        const flows = [
            { date: new Date('2024-01-01'), amount: -10000 },
            { date: new Date('2024-12-31'), amount: 10000 },
        ]
        expect(computeXIRR(flows)).toBe(0)
    })
})

describe('computePortfolioXIRR', () => {
    it('returns null when no snapshots are provided', () => {
        expect(computePortfolioXIRR([])).toBeNull()
    })

    it('returns null with a single snapshot', () => {
        expect(
            computePortfolioXIRR([{ asOfDate: '2024-03-31', totalValue: 10000 }]),
        ).toBeNull()
    })

    it('computes XIRR from first and last snapshot values', () => {
        const snapshots = [
            { asOfDate: '2024-01-01', totalValue: 10000 },
            { asOfDate: '2024-12-31', totalValue: 11000 },
        ]
        const xirr = computePortfolioXIRR(snapshots)
        expect(xirr).toBeCloseTo(0.1, 2)
    })

    it('includes explicit transactions in cash flows', () => {
        const snapshots = [
            { asOfDate: '2024-01-01', totalValue: 10000 },
            { asOfDate: '2024-12-31', totalValue: 10500 },
        ]
        const transactions = [{ date: new Date('2024-07-01'), amount: -1000 }]
        const xirr = computePortfolioXIRR(snapshots, transactions)
        // Net invested 11000, ending 10500 → negative return
        expect(xirr).toBeLessThan(0)
    })
})
