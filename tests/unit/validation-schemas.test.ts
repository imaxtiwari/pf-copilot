import { describe, it, expect } from 'vitest'
import { CAS_STATUS, FACTSHEET_SECTION, INFLATION_CONFIDENCE } from '@/lib/validation/schemas'

describe('validation schemas', () => {
  it('CAS_STATUS accepts valid statuses', () => {
    expect(CAS_STATUS.parse('validated')).toBe('validated')
    expect(CAS_STATUS.parse('failed_validation')).toBe('failed_validation')
  })

  it('CAS_STATUS rejects invalid statuses', () => {
    expect(() => CAS_STATUS.parse('unknown')).toThrow()
  })

  it('FACTSHEET_SECTION accepts known sections', () => {
    expect(FACTSHEET_SECTION.parse('returns')).toBe('returns')
    expect(FACTSHEET_SECTION.parse('expense_ratio')).toBe('expense_ratio')
  })

  it('INFLATION_CONFIDENCE accepts low/medium/high', () => {
    expect(INFLATION_CONFIDENCE.parse('high')).toBe('high')
    expect(() => INFLATION_CONFIDENCE.parse('extreme')).toThrow()
  })
})