import { describe, it, expect } from 'vitest'
import { ToolArgSchemas } from '../../lib/tools/arg-schemas'

// ── schema presence ───────────────────────────────────────────────────────────

describe('ToolArgSchemas — all five tools are present', () => {
  const EXPECTED_TOOLS = [
    'get_portfolio',
    'compute_personal_inflation',
    'compute_real_returns',
    'lookup_chat_history',
    'explain_fund',
    'explain_stock',
    'compare_funds',
  ] as const

  for (const tool of EXPECTED_TOOLS) {
    it(`${tool} schema exists`, () => {
      expect(ToolArgSchemas[tool]).toBeDefined()
      expect(typeof ToolArgSchemas[tool].safeParse).toBe('function')
    })
  }

  it('no extra tools are present beyond the known seven', () => {
    expect(Object.keys(ToolArgSchemas)).toHaveLength(7)
  })
})

// ── zero-arg tools ────────────────────────────────────────────────────────────

describe('ToolArgSchemas — zero-arg tools accept {}', () => {
  it('get_portfolio: {} passes', () => {
    expect(ToolArgSchemas.get_portfolio.safeParse({}).success).toBe(true)
  })

  it('compute_personal_inflation: {} passes', () => {
    expect(ToolArgSchemas.compute_personal_inflation.safeParse({}).success).toBe(true)
  })

  it('lookup_chat_history: {} passes', () => {
    expect(ToolArgSchemas.lookup_chat_history.safeParse({}).success).toBe(true)
  })

  it('zero-arg tools strip unknown extra keys without failing (Zod default strip mode)', () => {
    // LLM sometimes adds spurious keys — they should be silently dropped, not rejected
    const result = ToolArgSchemas.get_portfolio.safeParse({ unexpected_key: 'value' })
    expect(result.success).toBe(true)
  })
})

// ── compute_real_returns — scheme_code coercion ───────────────────────────────

describe('ToolArgSchemas — compute_real_returns', () => {
  it('scheme_code as string "119551" passes and remains a string', () => {
    const result = ToolArgSchemas.compute_real_returns.safeParse({ scheme_code: '119551' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_code).toBe('119551')
    expect(typeof result.data.scheme_code).toBe('string')
  })

  it('scheme_code as number 119551 is coerced to string "119551" (z.coerce.string)', () => {
    // LLM frequently returns scheme_code as a JSON number; coerce handles this
    const result = ToolArgSchemas.compute_real_returns.safeParse({ scheme_code: 119551 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_code).toBe('119551')
    expect(typeof result.data.scheme_code).toBe('string')
  })

  it('scheme_code as empty string "" fails (min(1))', () => {
    const result = ToolArgSchemas.compute_real_returns.safeParse({ scheme_code: '' })
    expect(result.success).toBe(false)
  })

  it('scheme_code missing entirely fails', () => {
    const result = ToolArgSchemas.compute_real_returns.safeParse({})
    expect(result.success).toBe(false)
  })
})

// ── compare_funds ─────────────────────────────────────────────────────────────

describe('ToolArgSchemas — compare_funds', () => {
  it('valid array of string scheme_codes + non-empty question passes', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({
      scheme_codes: ['119551', '145001'],
      question: 'Compare these funds',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_codes).toEqual(['119551', '145001'])
    expect(result.data.question).toBe('Compare these funds')
  })

  it('numeric scheme_codes are coerced to strings', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({
      scheme_codes: [119551, 145001],
      question: 'Compare these funds',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_codes).toEqual(['119551', '145001'])
  })

  it('single scheme_code fails because min is 2', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({
      scheme_codes: ['119551'],
      question: 'Compare these funds',
    })
    expect(result.success).toBe(false)
  })

  it('empty scheme_codes array fails', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({
      scheme_codes: [],
      question: 'Compare these funds',
    })
    expect(result.success).toBe(false)
  })

  it('missing question fails', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({ scheme_codes: ['119551', '145001'] })
    expect(result.success).toBe(false)
  })

  it('empty question string fails', () => {
    const result = ToolArgSchemas.compare_funds.safeParse({
      scheme_codes: ['119551', '145001'],
      question: '',
    })
    expect(result.success).toBe(false)
  })
})

// ── explain_stock ─────────────────────────────────────────────────────────────

describe('ToolArgSchemas — explain_stock', () => {
  it('valid ISIN + question passes', () => {
    const result = ToolArgSchemas.explain_stock.safeParse({
      isin: 'INE002A01018',
      question: 'What is the revenue?',
    })
    expect(result.success).toBe(true)
  })

  it('coerces isin to uppercase? no — regex is case-insensitive', () => {
    const result = ToolArgSchemas.explain_stock.safeParse({
      isin: 'ine002a01018',
      question: 'What is the revenue?',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ISIN length', () => {
    const result = ToolArgSchemas.explain_stock.safeParse({
      isin: 'INE002A0101',
      question: 'What is the revenue?',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing question', () => {
    const result = ToolArgSchemas.explain_stock.safeParse({ isin: 'INE002A01018' })
    expect(result.success).toBe(false)
  })

  it('language defaults to "en"', () => {
    const result = ToolArgSchemas.explain_stock.safeParse({
      isin: 'INE002A01018',
      question: 'What is the revenue?',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.language).toBe('en')
  })
})

// ── explain_fund ──────────────────────────────────────────────────────────────

describe('ToolArgSchemas — explain_fund', () => {
  it('valid scheme_code + non-empty question passes', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: 'What is the expense ratio?',
    })
    expect(result.success).toBe(true)
  })

  it('parsed data preserves both fields', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: 'What is the expense ratio?',
    })
    if (!result.success) return
    expect(result.data.scheme_code).toBe('119551')
    expect(result.data.question).toBe('What is the expense ratio?')
  })

  it('scheme_code as number coerces correctly in explain_fund too', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: 119551,
      question: 'What is the AUM?',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_code).toBe('119551')
  })

  it('missing question field fails', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({ scheme_code: '119551' })
    expect(result.success).toBe(false)
  })

  it('empty string question "" fails (min(1))', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: '',
    })
    expect(result.success).toBe(false)
  })

  it('missing scheme_code fails', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      question: 'What is the expense ratio?',
    })
    expect(result.success).toBe(false)
  })

  it('empty scheme_code "" fails', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '',
      question: 'What is the expense ratio?',
    })
    expect(result.success).toBe(false)
  })

  it('both fields missing fails', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({})
    expect(result.success).toBe(false)
  })

  it('language defaults to "en" when omitted', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: 'What is the expense ratio?',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.language).toBe('en')
  })

  it('language "hi-en" is accepted', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: 'What is the expense ratio?',
      language: 'hi-en',
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.language).toBe('hi-en')
  })

  it('invalid language is rejected', () => {
    const result = ToolArgSchemas.explain_fund.safeParse({
      scheme_code: '119551',
      question: 'What is the expense ratio?',
      language: 'es',
    })
    expect(result.success).toBe(false)
  })
})

// ── coercion edge cases ───────────────────────────────────────────────────────

describe('ToolArgSchemas — z.coerce.string edge cases', () => {
  it('scheme_code as float 119551.0 coerces to "119551"', () => {
    const result = ToolArgSchemas.compute_real_returns.safeParse({ scheme_code: 119551.0 })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_code).toBe('119551')
  })

  it('scheme_code as boolean true coerces to "true" (z.coerce.string is permissive)', () => {
    // z.coerce.string() calls String() on any value — boolean becomes "true"
    // This documents the behaviour; the min(1) guard still passes for "true"
    const result = ToolArgSchemas.compute_real_returns.safeParse({ scheme_code: true })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.scheme_code).toBe('true')
  })
})
