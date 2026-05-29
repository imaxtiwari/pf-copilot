import type { CASHolding } from '../contracts/cas-validation'

// Strip Indian-format number commas: "1,23,456.78" → 123456.78
export function parseNumber(s: string): number {
  return parseFloat(s.replace(/,/g, ''))
}

// Convert DD-MMM-YYYY or DD/MM/YYYY or similar to YYYY-MM-DD
export function parseDate(s: string): string | null {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }
  // DD-MMM-YYYY or DD MMM YYYY
  const m1 = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/)
  if (m1) {
    const mm = months[m1[2].toLowerCase()]
    if (mm) return `${m1[3]}-${mm}-${m1[1].padStart(2, '0')}`
  }
  // DD/MM/YYYY
  const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`
  // YYYY-MM-DD passthrough
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

export function detectSource(text: string): 'NSDL' | 'CDSL' | null {
  if (/NSDL/i.test(text)) return 'NSDL'
  if (/CDSL/i.test(text)) return 'CDSL'
  return null
}

// Extract total portfolio value from footer lines like "Total Value: 1,23,456.78"
export function extractTotal(text: string): number {
  const m = text.match(/total\s+(?:portfolio\s+)?value[:\s]+([0-9,]+\.?\d*)/i)
  return m ? parseNumber(m[1]) : 0
}

// Extract as_of_date from header lines
export function extractDate(text: string): string | null {
  // "Statement Period: 01-Apr-2023 to 31-Mar-2024" → take the END date (second capture group)
  const periodMatch = text.match(
    /statement\s+period.*?(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4})\s+to\s+(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4})/i,
  )
  if (periodMatch) return parseDate(periodMatch[2])
  // "As On: 31-Mar-2024"
  const asOnMatch = text.match(/as\s+(?:on|of)[:\s]+(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{4})/i)
  if (asOnMatch) return parseDate(asOnMatch[1])
  // Any date near "date"
  const dateMatch = text.match(/date[:\s]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{4})/i)
  if (dateMatch) return parseDate(dateMatch[1])
  return null
}

// Parse individual holding blocks from CAS text.
//
// NSDL format (primary path):
//   Folio No: 12345678 / [Registrar]
//   Scheme Name - ISIN
//   1,234.5678   23.4567   28,945.78    ← units  nav  market_value
//
// CDSL format (fallback):
//   Scheme Name   1,234.5678   23.4567   28,945.78   (fixed-width / space-aligned)
export function parseHoldings(text: string): CASHolding[] {
  const holdings: CASHolding[] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  let currentFolio = ''
  let i = 0
  while (i < lines.length) {
    const folioMatch = lines[i].match(/Folio\s+No[.:\s]+([A-Z0-9/]+)/i)
    if (folioMatch) {
      currentFolio = folioMatch[1].trim()
      i++
      continue
    }

    // Value line: three numbers separated by whitespace (units  nav  market_value)
    const valueLineMatch = lines[i].match(
      /^([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d,]+\.?\d*)$/,
    )
    if (valueLineMatch && currentFolio && i > 0) {
      const units = parseNumber(valueLineMatch[1])
      const nav = parseNumber(valueLineMatch[2])
      const marketValue = parseNumber(valueLineMatch[3])
      // Scheme name is the nearest preceding line that isn't a folio/ISIN/number line
      let schemeName = ''
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const candidate = lines[j]
        if (
          candidate &&
          !candidate.match(/^Folio/i) &&
          !candidate.match(/^\d/) &&
          !candidate.match(/^[A-Z]{2,4}\d/) && // ISIN prefix (e.g. INF040A01726)
          !candidate.match(/^[A-Z]{2}[0-9]{10}$/) // full ISIN (12-char)
        ) {
          schemeName = candidate.replace(/\s*-\s*INF\w+$/, '').trim()
          break
        }
      }
      if (schemeName && units > 0 && nav > 0) {
        holdings.push({ folio_number: currentFolio, scheme_name: schemeName, units, nav, market_value: marketValue })
      }
    }
    i++
  }

  // Fallback: CDSL-style space-aligned table
  if (holdings.length === 0) {
    const tableRow = /([A-Za-z0-9/ ]{5,60})\s{2,}([\d,]+\.\d{2,4})\s{2,}([\d,]+\.\d{2,4})\s{2,}([\d,]+\.?\d*)/g
    let match
    while ((match = tableRow.exec(text)) !== null) {
      const schemeName = match[1].trim()
      if (/^(scheme|fund|folio|description|total|sub.?total|particulars)/i.test(schemeName)) continue
      const units = parseNumber(match[2])
      const nav = parseNumber(match[3])
      const marketValue = parseNumber(match[4])
      if (units > 0 && nav > 0 && marketValue > 0) {
        holdings.push({ folio_number: currentFolio || 'UNKNOWN', scheme_name: schemeName, units, nav, market_value: marketValue })
      }
    }
  }

  return holdings
}
