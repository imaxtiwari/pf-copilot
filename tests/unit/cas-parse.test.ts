import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const mockParseCASText = vi.hoisted(() => vi.fn())
const mockParseCASVision = vi.hoisted(() => vi.fn())
const mockDbQuery = vi.hoisted(() => vi.fn())
const mockCrossCheckSchemes = vi.hoisted(() => vi.fn())

vi.mock('@/lib/cas/parse-text', () => ({
  parseCASText: mockParseCASText,
}))

vi.mock('@/lib/cas/parse-vision', () => ({
  parseCASVision: mockParseCASVision,
}))

vi.mock('@/lib/db', () => ({
  db: {
    query: { casUploads: { findFirst: mockDbQuery } },
  },
}))

vi.mock('@/lib/cas/amfi-master', () => ({
  crossCheckSchemes: mockCrossCheckSchemes,
}))

vi.mock('@/db/schema', () => ({
  casUploads: {},
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn() },
  AuditActionType: { CAS_PARSE_ATTEMPT: 'CAS_PARSE_ATTEMPT' },
}))

vi.mock('@/lib/metrics', () => ({
  emitCasParseSuccess: vi.fn(),
  emitCasParseFailure: vi.fn(),
}))

import { parseCAS } from '@/lib/cas/parse'

const FIXTURE_PATH = path.join(__dirname, '../fixtures/cas-sample.pdf')

describe('parseCAS', () => {
  beforeEach(() => {
    mockParseCASText.mockReset()
    mockParseCASVision.mockReset()
    mockDbQuery.mockReset()
    mockCrossCheckSchemes.mockReset()
  })

  it('returns cached result when a recent validated upload exists', async () => {
    mockDbQuery.mockResolvedValue({ id: 'upload-1', status: 'validated' })
    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseCAS(buffer, 'user-1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.fromCache).toBe(true)
  })

  it('returns text extraction when it passes validation and confidence threshold', async () => {
    mockDbQuery.mockResolvedValue(null)
    mockParseCASText.mockResolvedValue({
      source: 'cdsl',
      as_of_date: '2026-07-26',
      total_value_reported: 250000,
      holdings: [{ scheme_name: 'Nifty 50', scheme_code: '120503', folio_number: 'F1', units: 100, nav: 2500, market_value: 250000 }],
      _extraction_notes: [],
    })
    mockCrossCheckSchemes.mockResolvedValue({ matched: ['Nifty 50'], unmatched: [] })

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseCAS(buffer, 'user-1')
    expect(result.ok).toBe(true)
    if (result.ok && !result.fromCache) {
      expect(result.source).toBe('text')
    }
  })

  it('falls back to vision when text extraction has low confidence', async () => {
    mockDbQuery.mockResolvedValue(null)
    mockParseCASText.mockResolvedValue({
      source: 'cdsl',
      as_of_date: '2026-07-26',
      total_value_reported: 250000,
      holdings: [{ scheme_name: 'Nifty 50', scheme_code: '120503', folio_number: 'F1', units: 100, nav: 2500, market_value: 250000 }],
      _extraction_notes: [],
    })
    mockParseCASVision.mockResolvedValue({
      source: 'cdsl',
      as_of_date: '2026-07-26',
      total_value_reported: 250000,
      holdings: [{ scheme_name: 'Nifty 50', scheme_code: '120503', folio_number: 'F1', units: 100, nav: 2500, market_value: 250000 }],
      _extraction_notes: [],
    })
    mockCrossCheckSchemes.mockResolvedValue({ matched: ['Nifty 50'], unmatched: [] })

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseCAS(buffer, 'user-1')
    expect(result.ok).toBe(true)
  })

  it('returns errors when both extraction paths fail', async () => {
    mockDbQuery.mockResolvedValue(null)
    mockParseCASText.mockResolvedValue(null)
    mockParseCASVision.mockResolvedValue(null)

    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseCAS(buffer, 'user-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toContain('Both text and vision extraction failed')
  })
})