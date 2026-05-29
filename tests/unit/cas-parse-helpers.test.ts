import { describe, it, expect } from 'vitest'
import {
  parseNumber,
  parseDate,
  detectSource,
  extractTotal,
  extractDate,
  parseHoldings,
} from '../../lib/cas/parse-text-helpers'

// ── parseNumber ───────────────────────────────────────────────────────────────

describe('parseNumber', () => {
  it('Indian lakh format: "1,23,456.78" → 123456.78', () => {
    expect(parseNumber('1,23,456.78')).toBe(123456.78)
  })

  it('standard thousands comma: "1,234.56" → 1234.56', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56)
  })

  it('no commas: "45.6789" → 45.6789', () => {
    expect(parseNumber('45.6789')).toBe(45.6789)
  })

  it('integer string: "5000" → 5000', () => {
    expect(parseNumber('5000')).toBe(5000)
  })

  it('zero: "0.00" → 0', () => {
    expect(parseNumber('0.00')).toBe(0)
  })

  it('large crore value: "1,23,45,678.90" → 12345678.90', () => {
    expect(parseNumber('1,23,45,678.90')).toBeCloseTo(12345678.9, 2)
  })
})

// ── parseDate ─────────────────────────────────────────────────────────────────

describe('parseDate', () => {
  it('DD-MMM-YYYY: "31-Mar-2024" → "2024-03-31"', () => {
    expect(parseDate('31-Mar-2024')).toBe('2024-03-31')
  })

  it('DD MMM YYYY (space separator): "31 Mar 2024" → "2024-03-31"', () => {
    expect(parseDate('31 Mar 2024')).toBe('2024-03-31')
  })

  it('DD/MM/YYYY: "31/03/2024" → "2024-03-31"', () => {
    expect(parseDate('31/03/2024')).toBe('2024-03-31')
  })

  it('YYYY-MM-DD passthrough: "2024-03-31" → "2024-03-31"', () => {
    expect(parseDate('2024-03-31')).toBe('2024-03-31')
  })

  it('unknown format → null', () => {
    expect(parseDate('March 31, 2024')).toBeNull()
  })

  it('single-digit day is zero-padded: "1-Jan-2024" → "2024-01-01"', () => {
    expect(parseDate('1-Jan-2024')).toBe('2024-01-01')
  })

  it('month name is case-insensitive: "31-MAR-2024" → "2024-03-31"', () => {
    expect(parseDate('31-MAR-2024')).toBe('2024-03-31')
  })

  it('all months map correctly: Dec → 12', () => {
    expect(parseDate('25-Dec-2023')).toBe('2023-12-25')
  })

  it('all months map correctly: Sep → 09', () => {
    expect(parseDate('15-Sep-2023')).toBe('2023-09-15')
  })

  it('YYYY-MM-DD passthrough does NOT match with extra chars: "2024-03-31 extra" → null', () => {
    // passthrough uses anchored regex ^...$, so trailing chars break it
    // but DD-MMM-YYYY won't match either — result is null
    expect(parseDate('2024-03-31 extra')).toBeNull()
  })

  it('unknown 3-letter month abbreviation matched by regex but not in map → null (line 18 false branch)', () => {
    // "31-Xyz-2024" matches /(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/ so m1 is non-null,
    // but months["xyz"] is undefined → if (mm) is false → falls through to null
    expect(parseDate('31-Xyz-2024')).toBeNull()
  })
})

// ── detectSource ──────────────────────────────────────────────────────────────

describe('detectSource', () => {
  it('"NSDL" in text → \'NSDL\'', () => {
    expect(detectSource('NSDL Consolidated Account Statement')).toBe('NSDL')
  })

  it('"CDSL" in text → \'CDSL\'', () => {
    expect(detectSource('CDSL e-CAS for the period 01-Apr-2023 to 31-Mar-2024')).toBe('CDSL')
  })

  it('neither → null', () => {
    expect(detectSource('Some generic PDF text with no depository marker')).toBeNull()
  })

  it('case-insensitive: "nsdl" → \'NSDL\'', () => {
    expect(detectSource('nsdl statement')).toBe('NSDL')
  })

  it('case-insensitive: "cdsl" → \'CDSL\'', () => {
    expect(detectSource('cdsl account')).toBe('CDSL')
  })

  it('NSDL takes priority when both appear (unlikely but well-defined by code order)', () => {
    expect(detectSource('NSDL and CDSL both mentioned')).toBe('NSDL')
  })
})

// ── extractTotal ──────────────────────────────────────────────────────────────

describe('extractTotal', () => {
  it('"Total Value: 1,23,456.78" → 123456.78', () => {
    expect(extractTotal('Total Value: 1,23,456.78')).toBeCloseTo(123456.78, 2)
  })

  it('"Total Portfolio Value: 50000" → 50000', () => {
    expect(extractTotal('Total Portfolio Value: 50000')).toBe(50000)
  })

  it('no match → 0', () => {
    expect(extractTotal('No totals here')).toBe(0)
  })

  it('case-insensitive: "TOTAL VALUE: 100.50" → 100.50', () => {
    expect(extractTotal('TOTAL VALUE: 100.50')).toBe(100.5)
  })

  it('embedded in a larger text block', () => {
    const text = 'Some header\nFolio details...\nTotal Value: 2,50,000.00\nFooter'
    expect(extractTotal(text)).toBe(250000)
  })
})

// ── extractDate ───────────────────────────────────────────────────────────────

describe('extractDate', () => {
  it('Statement Period → takes the END date (not start)', () => {
    expect(extractDate('Statement Period: 01-Apr-2023 to 31-Mar-2024')).toBe('2024-03-31')
  })

  it('Statement Period start date is NOT returned', () => {
    const result = extractDate('Statement Period: 01-Apr-2023 to 31-Mar-2024')
    expect(result).not.toBe('2023-04-01')
  })

  it('"As On: 31-Mar-2024" → "2024-03-31"', () => {
    expect(extractDate('As On: 31-Mar-2024')).toBe('2024-03-31')
  })

  it('"As Of: 31-Mar-2024" → "2024-03-31"', () => {
    expect(extractDate('As Of: 31-Mar-2024')).toBe('2024-03-31')
  })

  it('"Date: 01/03/2024" → "2024-03-01"', () => {
    expect(extractDate('Date: 01/03/2024')).toBe('2024-03-01')
  })

  it('no recognisable date → null', () => {
    expect(extractDate('This text has no date information whatsoever')).toBeNull()
  })

  it('Statement Period pattern in a multiline block', () => {
    const text = [
      'NSDL Consolidated Account Statement',
      'Statement Period: 01-Apr-2023 to 31-Mar-2024',
      'Investor Name: John Doe',
    ].join('\n')
    expect(extractDate(text)).toBe('2024-03-31')
  })
})

// ── parseHoldings — NSDL primary path ────────────────────────────────────────

describe('parseHoldings — NSDL primary path', () => {
  it('minimal: folio + scheme name + value line → one holding', () => {
    const text = [
      'Folio No: 12345678',
      'HDFC Top 100 Fund - Growth',
      '123.4567   45.6789   5635.17',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].folio_number).toBe('12345678')
    expect(result[0].scheme_name).toBe('HDFC Top 100 Fund - Growth')
    expect(result[0].units).toBeCloseTo(123.4567, 4)
    expect(result[0].nav).toBeCloseTo(45.6789, 4)
    expect(result[0].market_value).toBeCloseTo(5635.17, 2)
  })

  it('ISIN suffix on scheme name line is stripped', () => {
    const text = [
      'Folio No: 99999999',
      'SBI Blue Chip Fund - INF200K01LU8',
      '50.0000   100.0000   5000.00',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].scheme_name).toBe('SBI Blue Chip Fund')
  })

  it('ISIN line between scheme name and value line is skipped over', () => {
    // Real CAS: scheme line, then standalone ISIN line, then value line
    const text = [
      'Folio No: 12345678',
      'Axis Long Term Equity Fund',
      'INF846K01DP8',
      '200.0000   75.5000   15100.00',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].scheme_name).toBe('Axis Long Term Equity Fund')
  })

  it('multiple folios → multiple holdings', () => {
    const text = [
      'Folio No: 11111111',
      'HDFC Top 100 Fund',
      '100.0000   50.0000   5000.00',
      'Folio No: 22222222',
      'SBI Blue Chip Fund',
      '200.0000   25.0000   5000.00',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(2)
    expect(result[0].folio_number).toBe('11111111')
    expect(result[1].folio_number).toBe('22222222')
  })

  it('Indian-comma units and nav are correctly parsed', () => {
    const text = [
      'Folio No: 12345678',
      'Mirae Asset Large Cap Fund',
      '1,234.5678   1,00.0000   1,23,456.78',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].units).toBeCloseTo(1234.5678, 4)
    expect(result[0].nav).toBeCloseTo(100.0, 4)
  })

  it('empty text → empty array', () => {
    expect(parseHoldings('')).toHaveLength(0)
  })

  it('text with no folio and no table → empty array', () => {
    expect(parseHoldings('Just some random text with no financial data')).toHaveLength(0)
  })

  it('value line with no valid scheme name in preceding lines → holding excluded (line 102 false branch)', () => {
    // The only line before the value line is the Folio line itself, which is filtered out
    // by the /^Folio/i guard. schemeName stays '' → if (schemeName && ...) is false.
    const text = [
      'Folio No: 12345678',
      '100.0000   50.0000   5000.00',
    ].join('\n')
    expect(parseHoldings(text)).toHaveLength(0)
  })
})

// ── parseHoldings — CDSL fallback path ───────────────────────────────────────

describe('parseHoldings — CDSL space-aligned table fallback', () => {
  it('space-aligned table → one holding', () => {
    // No "Folio No:" line so NSDL primary path finds nothing → fallback runs
    const text = [
      'Scheme Name                  Units        NAV          Value',
      'HDFC Top 100 Fund            123.4567     45.6789      5635.17',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].scheme_name).toBe('HDFC Top 100 Fund')
    expect(result[0].units).toBeCloseTo(123.4567, 4)
    expect(result[0].nav).toBeCloseTo(45.6789, 4)
  })

  it('header row starting with "Scheme" is skipped', () => {
    const text = [
      'Scheme Name                  Units        NAV          Value',
      'SBI Blue Chip                50.0000      100.0000     5000.00',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].scheme_name).toBe('SBI Blue Chip')
  })

  it('summary row starting with "Total" is skipped', () => {
    const text = [
      'HDFC Top 100 Fund            123.4567     45.6789      5635.17',
      'Total                        123.4567     45.6789      5635.17',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
    expect(result[0].scheme_name).toBe('HDFC Top 100 Fund')
  })

  it('summary row starting with "Sub Total" is skipped', () => {
    const text = [
      'Axis Long Term Equity        200.0000     75.5000      15100.00',
      'Sub Total                    200.0000     75.5000      15100.00',
    ].join('\n')
    const result = parseHoldings(text)
    expect(result).toHaveLength(1)
  })

  it('non-header CDSL row with zero market_value → excluded (line 119 false branch)', () => {
    // Row passes the header-skip check but marketValue=0 → if (... && marketValue > 0) is false
    const text = 'HDFC Top 100 Fund            123.4567     45.6789      0.00'
    expect(parseHoldings(text)).toHaveLength(0)
  })
})
