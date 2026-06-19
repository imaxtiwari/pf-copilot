import { describe, it, expect } from 'vitest'
import { validateRagResponse } from '../../lib/rag/validate-response'

const CHUNK_IDS = [
  { id: 'chunk_1', factsheetDate: '2026-06-01' },
  { id: 'chunk_2', factsheetDate: '2026-06-01' },
  { id: 'chunk_3', factsheetDate: '2026-06-01' },
]

const BASE_VALID = {
  answer: 'The expense ratio is 1.42% [chunk_1].',
  citations: [{ chunk_id: 'chunk_1', factsheet_date: '2025-05-01', section: 'expense_ratio' }],
  refused: false,
  refusal_reason: null,
}

// ── shape checks ─────────────────────────────────────────────────────────────

describe('validateRagResponse — shape', () => {
  it('accepts a valid response', () => {
    expect(validateRagResponse(BASE_VALID, CHUNK_IDS)).toEqual({ ok: true, warnings: [] })
  })

  it('rejects null', () => {
    const r = validateRagResponse(null, CHUNK_IDS)
    expect(r.ok).toBe(false)
  })

  it('rejects missing citations array', () => {
    const bad = { ...BASE_VALID, citations: undefined }
    expect(validateRagResponse(bad, CHUNK_IDS).ok).toBe(false)
  })

  it('rejects refused=true with no refusal_reason (null ok per spec)', () => {
    // refused=true with refusal_reason=null is allowed structurally
    const r = validateRagResponse({ ...BASE_VALID, refused: true, refusal_reason: null }, CHUNK_IDS)
    expect(r.ok).toBe(true)
  })
})

// ── citation grounding checks ─────────────────────────────────────────────────

describe('validateRagResponse — citation grounding', () => {
  it('rejects citation referencing chunk not in retrieved set', () => {
    const r = validateRagResponse(
      { ...BASE_VALID, citations: [{ chunk_id: 'chunk_99', factsheet_date: '2025-05-01', section: 'aum' }] },
      CHUNK_IDS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/chunk_99/)
  })

  it('skips citation check when refused=true', () => {
    const r = validateRagResponse(
      { answer: 'No data', citations: [{ chunk_id: 'chunk_99', factsheet_date: '2025-05-01', section: 'aum' }], refused: true, refusal_reason: 'no data' },
      CHUNK_IDS,
    )
    // citation grounding check is skipped for refused responses
    expect(r.ok).toBe(true)
  })

  it('rejects inline [chunk_id] in answer body not in retrieved set', () => {
    const r = validateRagResponse(
      { ...BASE_VALID, answer: 'The AUM is 12000 Cr [chunk_99].' },
      CHUNK_IDS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('chunk_99'))).toBe(true)
  })

  it('accepts inline refs that are in retrieved set', () => {
    const r = validateRagResponse(
      {
        answer: 'AUM is 12000 Cr [chunk_2]. ER is 1.42% [chunk_3].',
        citations: [
          { chunk_id: 'chunk_2', factsheet_date: '2025-05-01', section: 'aum' },
          { chunk_id: 'chunk_3', factsheet_date: '2025-05-01', section: 'expense_ratio' },
        ],
        refused: false,
        refusal_reason: null,
      },
      CHUNK_IDS,
    )
    expect(r.ok).toBe(true)
  })
})

// ── forbidden word checks ─────────────────────────────────────────────────────

describe('validateRagResponse — forbidden words', () => {
  it('rejects "buy" in answer body', () => {
    const r = validateRagResponse({ ...BASE_VALID, answer: 'You may buy this fund.' }, CHUNK_IDS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/buy/)
  })

  it('rejects "should" in answer body', () => {
    const r = validateRagResponse({ ...BASE_VALID, answer: 'You should hold this fund.' }, CHUNK_IDS)
    expect(r.ok).toBe(false)
  })

  it('rejects "recommend" in answer body', () => {
    const r = validateRagResponse({ ...BASE_VALID, answer: 'Experts recommend this scheme.' }, CHUNK_IDS)
    expect(r.ok).toBe(false)
  })

  it('rejects "best fund" in answer body', () => {
    const r = validateRagResponse({ ...BASE_VALID, answer: 'This is the best fund for you.' }, CHUNK_IDS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0]).toMatch(/best fund/)
  })
})

// ── <user_question> exclusion (acceptance criterion 6) ───────────────────────

describe('validateRagResponse — <user_question> exclusion', () => {
  it('does NOT flag forbidden word inside <user_question> wrapper', () => {
    const answer =
      `<user_question>Should I buy this fund?</user_question> ` +
      `Based on the factsheet data [chunk_1], the expense ratio is 1.42%.`
    const r = validateRagResponse({ ...BASE_VALID, answer }, CHUNK_IDS)
    expect(r.ok).toBe(true)
  })

  it('does NOT flag inline [chunk_id] inside <user_question> wrapper', () => {
    // Even if the user mentions [chunk_99] in their phrasing, it should be excluded
    const answer =
      `<user_question>Can you explain [chunk_99] for me?</user_question> ` +
      `The fund holds HDFC Bank at 8.2% [chunk_1].`
    const r = validateRagResponse({ ...BASE_VALID, answer }, CHUNK_IDS)
    expect(r.ok).toBe(true)
  })

  it('DOES flag forbidden word in answer body even when user_question wrapper present', () => {
    const answer =
      `<user_question>Should I buy?</user_question> ` +
      `You should consider this fund.` // "should" in body
    const r = validateRagResponse({ ...BASE_VALID, answer }, CHUNK_IDS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('should'))).toBe(true)
  })

  it('DOES flag unknown inline ref in answer body even when user_question wrapper present', () => {
    const answer =
      `<user_question>What about chunk_99?</user_question> ` +
      `The AUM is 12000 Cr [chunk_99].` // chunk_99 in body
    const r = validateRagResponse({ ...BASE_VALID, answer }, CHUNK_IDS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('chunk_99'))).toBe(true)
  })

  it('handles multiple <user_question> blocks correctly', () => {
    const answer =
      `<user_question>Should I buy?</user_question> ` +
      `The expense ratio is 0.6% [chunk_1]. ` +
      `<user_question>Is it the best fund?</user_question> ` +
      `Performance data from [chunk_2] shows strong returns.`
    const r = validateRagResponse(
      {
        answer,
        citations: [
          { chunk_id: 'chunk_1', factsheet_date: '2025-05-01', section: 'expense_ratio' },
          { chunk_id: 'chunk_2', factsheet_date: '2025-05-01', section: 'returns' },
        ],
        refused: false,
        refusal_reason: null,
      },
      CHUNK_IDS,
    )
    expect(r.ok).toBe(true)
  })
})

// ── refused response passthrough ─────────────────────────────────────────────

describe('validateRagResponse — refused passthrough', () => {
  it('passes a well-formed refusal with no citations', () => {
    const r = validateRagResponse(
      { answer: "I don't have factsheet data for this.", citations: [], refused: true, refusal_reason: 'no_factsheet_data' },
      CHUNK_IDS,
    )
    expect(r.ok).toBe(true)
  })
})
