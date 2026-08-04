import { hashFileContent } from './hash'
import { parseCASText } from './parse-text'
import { parseCASVision, pdfToImageBuffers } from './parse-vision'
import { validateCAS } from '../contracts/cas-validation'
import { crossCheckSchemes } from './amfi-master'
import type { CASExtraction } from '../contracts/cas-validation'
import type { SchemeCheckResult } from './amfi-master'
import logger from '../logger'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type CASConfidence = {
    source: 'text' | 'vision'
    dateConfidence: ConfidenceLevel
    mathCheckConfidence: ConfidenceLevel
    schemeMatchConfidence: ConfidenceLevel
    overallConfidence: ConfidenceLevel
}

export type ReviewSessionResult =
    | {
        ok: true
        extraction: CASExtraction
        source: 'text' | 'vision'
        confidence: CASConfidence
        schemeCheck: SchemeCheckResult
        thumbnails: string[] // base64 PNG data URLs
        hash: string
    }
    | { ok: false; errors: string[]; source: 'text' | 'vision' | 'none'; hash: string }

function pickLevel(pct: number): ConfidenceLevel {
    if (pct >= 0.8) return 'high'
    if (pct >= 0.5) return 'medium'
    return 'low'
}

function computeConfidence(
    extraction: CASExtraction,
    source: 'text' | 'vision',
    schemeCheck: SchemeCheckResult,
): CASConfidence {
    // Date confidence: text extraction has a reliable date; vision often does too.
    // For now, treat any present non-fallback date as high for text, medium for vision.
    const dateConfidence: ConfidenceLevel = source === 'text' ? 'high' : 'medium'

    // Math check confidence: ratio of holdings that satisfy units*nav ≈ market_value.
    // validateCAS already enforces this, but we can measure tightness.
    const NAV_TOLERANCE = 0.5
    let mathPassed = 0
    for (const h of extraction.holdings) {
        const expected = h.units * h.nav
        if (Math.abs(expected - h.market_value) <= NAV_TOLERANCE) mathPassed++
    }
    const mathCheckConfidence = pickLevel(mathPassed / extraction.holdings.length)

    // Scheme match confidence: ratio of scheme names matched to AMFI master.
    const matchedCount = extraction.holdings.filter((h) =>
        schemeCheck.matched.some((m) => m.toLowerCase().includes(h.scheme_name.toLowerCase().slice(0, 30))),
    ).length
    const schemeMatchConfidence =
        schemeCheck.matched.length === 0 && schemeCheck.unmatched.length === 0
            ? 'low' // empty master
            : pickLevel(matchedCount / extraction.holdings.length)

    // Overall confidence: the worst of the three, because any weak signal warrants review.
    const levels: ConfidenceLevel[] = [dateConfidence, mathCheckConfidence, schemeMatchConfidence]
    const rank = { low: 0, medium: 1, high: 2 }
    const overall = levels.reduce((worst, cur) => (rank[cur] < rank[worst] ? cur : worst), 'high' as ConfidenceLevel)

    return {
        source,
        dateConfidence,
        mathCheckConfidence,
        schemeMatchConfidence,
        overallConfidence: overall,
    }
}

export async function createReviewSession(buffer: Buffer): Promise<ReviewSessionResult> {
    const hash = hashFileContent(buffer)

    // Text extraction path
    const textResult = await parseCASText(buffer)
    if (textResult) {
        const validation = validateCAS(textResult)
        if (validation.ok) {
            const schemeCheck = await crossCheckSchemes(validation.extraction.holdings.map((h) => h.scheme_name))
            const confidence = computeConfidence(validation.extraction, 'text', schemeCheck)
            const thumbnails = await renderThumbnails(buffer)
            return { ok: true, extraction: validation.extraction, source: 'text', confidence, schemeCheck, thumbnails, hash }
        }
        logger.info({ errors: validation.errors }, 'review-session: text extraction failed validation')
    }

    // Vision fallback
    logger.info({ hash }, 'review-session: falling back to vision extraction')
    const visionResult = await parseCASVision(buffer)
    if (visionResult) {
        const validation = validateCAS(visionResult)
        if (validation.ok) {
            const schemeCheck = await crossCheckSchemes(validation.extraction.holdings.map((h) => h.scheme_name))
            const confidence = computeConfidence(validation.extraction, 'vision', schemeCheck)
            const thumbnails = await renderThumbnails(buffer)
            return { ok: true, extraction: validation.extraction, source: 'vision', confidence, schemeCheck, thumbnails, hash }
        }
        return { ok: false, errors: validation.errors, source: 'vision', hash }
    }

    return { ok: false, errors: ['Both text and vision extraction failed'], source: 'none', hash }
}

async function renderThumbnails(buffer: Buffer): Promise<string[]> {
    try {
        const pages = await pdfToImageBuffers(buffer)
        return pages.map((buf) => `data:image/png;base64,${buf.toString('base64')}`)
    } catch (e) {
        logger.warn({ err: e }, 'review-session: thumbnail rendering failed')
        return []
    }
}
