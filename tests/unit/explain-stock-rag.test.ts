import { describe, it, expect } from 'vitest'
import { validateRagResponse } from '../../lib/rag/validate-response'

const CHUNK_IDS = ['chunk_1', 'chunk_2']

const BASE_STOCK = {
    answer: 'Reliance Industries reported revenue of ₹6,60,000 crore in FY24 [chunk_1].',
    citations: [{ chunk_id: 'chunk_1', factsheet_date: '2024-05-15', section: 'financials' }],
    refused: false,
    refusal_reason: null,
}

describe('validateRagResponse — explain_stock adherence', () => {
    it('accepts valid stock explanation with cited revenue', () => {
        const r = validateRagResponse(BASE_STOCK, CHUNK_IDS)
        expect(r.ok).toBe(true)
    })

    it('rejects "buy" advise language', () => {
        const r = validateRagResponse(
            { ...BASE_STOCK, answer: 'You can buy Reliance shares at current levels [chunk_1].' },
            CHUNK_IDS,
        )
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors.some((e) => e.includes('buy'))).toBe(true)
    })

    it('rejects "should" guidance', () => {
        const r = validateRagResponse(
            { ...BASE_STOCK, answer: 'You should hold Reliance for the long term [chunk_1].' },
            CHUNK_IDS,
        )
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors.some((e) => e.includes('should'))).toBe(true)
    })

    it('rejects "good stock" recommendation', () => {
        const r = validateRagResponse(
            { ...BASE_STOCK, answer: 'Reliance is a good stock for any portfolio [chunk_1].' },
            CHUNK_IDS,
        )
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors.some((e) => e.includes('good stock'))).toBe(true)
    })

    it('allows user-quoted advisory words inside <user_question>', () => {
        const answer =
            '<user_question>Should I buy Reliance?</user_question> ' +
            'Reliance reported revenue of ₹6,60,000 crore in FY24 [chunk_1].'
        const r = validateRagResponse({ ...BASE_STOCK, answer }, CHUNK_IDS)
        expect(r.ok).toBe(true)
    })

    it('rejects numeric claim without inline chunk citation', () => {
        const r = validateRagResponse(
            { ...BASE_STOCK, answer: 'Reliance revenue is ₹6,60,000 crore.' },
            CHUNK_IDS,
        )
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errors.some((e) => e.includes('not cited'))).toBe(true)
    })

    it('rejects citation to chunk not in retrieved set', () => {
        const r = validateRagResponse(
            {
                ...BASE_STOCK,
                citations: [{ chunk_id: 'chunk_99', factsheet_date: '2024-05-15', section: 'financials' }],
            },
            CHUNK_IDS,
        )
        expect(r.ok).toBe(false)
    })
})
