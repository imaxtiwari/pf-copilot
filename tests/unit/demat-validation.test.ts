import { describe, it, expect } from 'vitest'
import { validateDemat } from '../../lib/contracts/demat-validation'

const BASE: Parameters<typeof validateDemat>[0] = {
    source: 'NSDL',
    as_of_date: '2024-03-31',
    total_value_reported: 102000,
    holdings: [
        {
            isin: 'INE002A01018',
            company_name: 'Reliance Industries Ltd.',
            quantity: 100,
            price: 1020,
            value: 102000,
        },
    ],
}

describe('validateDemat', () => {
    it('passes a valid extraction', () => {
        const r = validateDemat(BASE)
        expect(r.ok).toBe(true)
    })

    it('rejects empty holdings', () => {
        const r = validateDemat({ ...BASE, holdings: [] })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors[0]).toMatch(/empty/)
    })

    it('rejects future as_of_date', () => {
        const future = new Date().toISOString().slice(0, 10)
        const r = validateDemat({ ...BASE, as_of_date: future })
        expect(r.ok).toBe(true) // today is allowed
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
        const r2 = validateDemat({ ...BASE, as_of_date: tomorrow })
        expect(r2.ok).toBe(false)
        if (!r2.ok) expect(r2.errors[0]).toMatch(/future/)
    })

    it('rejects quantity * price mismatch beyond tolerance', () => {
        const r = validateDemat({
            ...BASE,
            holdings: [{ ...BASE.holdings[0], value: 200000 }],
        })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors[0]).toMatch(/quantity×price/)
    })

    it('allows small rounding differences within 1%', () => {
        const r = validateDemat({
            ...BASE,
            holdings: [{ ...BASE.holdings[0], value: 102010 }], // ₹10 diff on ₹102k
        })
        expect(r.ok).toBe(true)
    })

    it('rejects total mismatch beyond 1%', () => {
        const r = validateDemat({ ...BASE, total_value_reported: 110000 })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors[0]).toMatch(/total mismatch/)
    })

    it('rejects zero quantity', () => {
        const r = validateDemat({
            ...BASE,
            holdings: [{ ...BASE.holdings[0], quantity: 0 }],
        })
        expect(r.ok).toBe(false)
    })
})
