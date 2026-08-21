import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createReviewSession, type CASConfidence } from '../../lib/cas/review-session'

// Mock pdf2pic fallback path
vi.mock('../../lib/cas/parse-text', () => ({
    parseCASText: vi.fn(),
}))
vi.mock('../../lib/cas/parse-vision', () => ({
    parseCASVision: vi.fn(),
    pdfToImageBuffers: vi.fn().mockResolvedValue([Buffer.from('page1')]),
}))
vi.mock('../../lib/cas/amfi-master', () => ({
    crossCheckSchemes: vi.fn(),
}))

import { parseCASText } from '../../lib/cas/parse-text'
import { parseCASVision } from '../../lib/cas/parse-vision'
import { crossCheckSchemes } from '../../lib/cas/amfi-master'

function makeExtraction() {
    return {
        source: 'NSDL' as const,
        as_of_date: '2024-03-31',
        total_value_reported: 10000,
        holdings: [
            { folio_number: 'F001', scheme_name: 'Fund Alpha', units: 100, nav: 50, market_value: 5000 },
            { folio_number: 'F002', scheme_name: 'Fund Beta', units: 200, nav: 25, market_value: 5000 },
        ],
    }
}

describe('createReviewSession', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    it('returns extraction and confidence when text path validates', async () => {
        vi.mocked(parseCASText).mockResolvedValue(makeExtraction())
        vi.mocked(crossCheckSchemes).mockResolvedValue({ matched: ['Fund Alpha', 'Fund Beta'], unmatched: [] })

        const result = await createReviewSession(Buffer.from('pdf'))

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.source).toBe('text')
        expect(result.extraction.holdings).toHaveLength(2)
        expect(result.confidence.source).toBe('text')
        expect(result.confidence.overallConfidence).toBe('high')
        expect(Array.isArray(result.thumbnails)).toBe(true)
    })

    it('falls back to vision when text extraction fails', async () => {
        vi.mocked(parseCASText).mockResolvedValue(null)
        vi.mocked(parseCASVision).mockResolvedValue(makeExtraction())
        vi.mocked(crossCheckSchemes).mockResolvedValue({ matched: ['Fund Alpha'], unmatched: ['Fund Beta'] })

        const result = await createReviewSession(Buffer.from('pdf'))

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.source).toBe('vision')
        expect(result.confidence.source).toBe('vision')
        // Scheme match drops to medium because 1 of 2 matched
        expect(result.confidence.schemeMatchConfidence).toBe('medium')
    })

    it('returns low schemeMatchConfidence when AMFI master is empty', async () => {
        vi.mocked(parseCASText).mockResolvedValue(makeExtraction())
        vi.mocked(crossCheckSchemes).mockResolvedValue({ matched: [], unmatched: [] })

        const result = await createReviewSession(Buffer.from('pdf'))

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.confidence.schemeMatchConfidence).toBe('low')
        expect(result.confidence.overallConfidence).toBe('low')
    })

    it('fails when both text and vision return null', async () => {
        vi.mocked(parseCASText).mockResolvedValue(null)
        vi.mocked(parseCASVision).mockResolvedValue(null)

        const result = await createReviewSession(Buffer.from('pdf'))

        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.errors[0]).toContain('Both text and vision extraction failed')
    })

    it('exposes only known confidence levels', async () => {
        vi.mocked(parseCASText).mockResolvedValue(makeExtraction())
        vi.mocked(crossCheckSchemes).mockResolvedValue({ matched: ['Fund Alpha', 'Fund Beta'], unmatched: [] })

        const result = await createReviewSession(Buffer.from('pdf'))

        expect(result.ok).toBe(true)
        if (!result.ok) return
        const levels: Array<CASConfidence[keyof CASConfidence]> = [
            result.confidence.dateConfidence,
            result.confidence.mathCheckConfidence,
            result.confidence.schemeMatchConfidence,
            result.confidence.overallConfidence,
            result.confidence.source,
        ]
        expect(levels.every((l) => ['high', 'medium', 'low', 'text', 'vision'].includes(String(l)))).toBe(true)
    })
})
