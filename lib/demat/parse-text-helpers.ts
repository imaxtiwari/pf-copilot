import type { DematHolding } from '../contracts/demat-validation'

// Strip Indian-format number commas: "1,23,456.78" → 123456.78
export function parseNumber(s: string): number {
    return parseFloat(s.replace(/,/g, ''))
}

// Convert DD-MMM-YYYY or DD/MM/YYYY to YYYY-MM-DD
export function parseDate(s: string): string | null {
    const months: Record<string, string> = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
    }
    const m1 = s.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/)
    if (m1) {
        const mm = months[m1[2].toLowerCase()]
        if (mm) return `${m1[3]}-${mm}-${m1[1].padStart(2, '0')}`
    }
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    return null
}

export function detectSource(text: string): 'NSDL' | 'CDSL' | null {
    if (/NSDL/i.test(text)) return 'NSDL'
    if (/CDSL/i.test(text)) return 'CDSL'
    return null
}

export function extractTotal(text: string): number {
    const m = text.match(/total\s+(?:portfolio\s+)?value[:\s]+([0-9,]+\.?\d*)/i)
    return m ? parseNumber(m[1]) : 0
}

export function extractDate(text: string): string | null {
    const periodMatch = text.match(
        /statement\s+period.*?(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4})\s+to\s+(\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{4})/i,
    )
    if (periodMatch) return parseDate(periodMatch[2])
    const asOnMatch = text.match(/as\s+(?:on|of)[:\s]+(\d{1,2}[-/\s][A-Za-z0-9]{2,3}[-/\s]\d{4})/i)
    if (asOnMatch) return parseDate(asOnMatch[1])
    const dateMatch = text.match(/date[:\s]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{4})/i)
    if (dateMatch) return parseDate(dateMatch[1])
    return null
}

const ISIN_RE = /([A-Z]{2}[0-9A-Z]{10})\b/

function isHeaderLike(line: string): boolean {
    return /\b(isin|company\s*name|quantity|price|value|closing|scrip|no\.?|sl\.?|total|sub.?total)\b/i.test(
        line,
    )
}

function cleanCompanyName(raw: string): string {
    return raw.replace(ISIN_RE, '').replace(/\s+/g, ' ').replace(/-\s*$/, '').trim()
}

// NSDL demat statements commonly lay holdings out as rows with:
//   ISIN  Company Name  Quantity  Closing Price  Value
// CDSL variants use fixed-width columns. We try both.
export function parseHoldings(text: string): DematHolding[] {
    const holdings: DematHolding[] = []
    const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)

    // Try regex-based row extraction first.
    for (const line of lines) {
        if (isHeaderLike(line)) continue
        const isinMatch = line.match(ISIN_RE)
        if (!isinMatch) continue

        // Remove the ISIN, then look for three numeric fields nearby.
        const withoutIsin = line.replace(isinMatch[0], ' ')
        const numbers = [...withoutIsin.matchAll(/([0-9,]+\.?\d*)/g)].map((m) => parseNumber(m[1]))
        if (numbers.length < 3) continue

        const [quantity, price, value] = [numbers[0], numbers[1], numbers[2]]
        if (quantity <= 0 || price <= 0) continue

        let companyName = cleanCompanyName(withoutIsin)
        // If the line is too sparse, try the previous non-numeric line as company name.
        if (!companyName || companyName.length < 3) {
            const idx = lines.indexOf(line)
            for (let j = idx - 1; j >= Math.max(0, idx - 4); j--) {
                const candidate = lines[j]
                if (
                    candidate &&
                    !candidate.match(/^\d/) &&
                    !candidate.match(ISIN_RE) &&
                    !isHeaderLike(candidate)
                ) {
                    companyName = cleanCompanyName(candidate)
                    break
                }
            }
        }

        if (!companyName || companyName.length < 2) continue
        holdings.push({
            isin: isinMatch[1],
            company_name: companyName,
            quantity,
            price,
            value,
        })
    }

    if (holdings.length > 0) return dedupe(holdings)

    // CDSL-style fixed-width fallback: glue multi-line rows together.
    const merged: { isin?: string; company?: string; numbers: number[] }[] = []
    let current: { isin?: string; company?: string; numbers: number[] } = { numbers: [] }

    for (const line of lines) {
        if (isHeaderLike(line)) continue
        const isinMatch = line.match(ISIN_RE)
        const numbers = [...line.matchAll(/([0-9,]+(?:\.\d+)?)/g)].map((m) => parseNumber(m[1]))

        if (isinMatch && current.isin) {
            merged.push(current)
            current = { numbers: [] }
        }

        if (isinMatch) current.isin = isinMatch[1]

        if (!isinMatch && !line.match(/^\d/) && line.length > 3) {
            current.company = current.company ? `${current.company} ${line}` : line
        }

        if (numbers.length > 0) current.numbers.push(...numbers)
    }
    if (current.isin) merged.push(current)

    for (const row of merged) {
        if (!row.isin || !row.company || row.numbers.length < 3) continue
        const [quantity, price, value] = [row.numbers[0], row.numbers[1], row.numbers[2]]
        if (quantity <= 0 || price <= 0) continue
        holdings.push({
            isin: row.isin,
            company_name: cleanCompanyName(row.company),
            quantity,
            price,
            value,
        })
    }

    return dedupe(holdings)
}

function dedupe(holdings: DematHolding[]): DematHolding[] {
    const seen = new Set<string>()
    return holdings.filter((h) => {
        const key = `${h.isin}::${h.company_name.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}
