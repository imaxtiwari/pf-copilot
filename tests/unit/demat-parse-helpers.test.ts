import { describe, it, expect } from 'vitest'
import { parseHoldings, parseNumber, extractDate, extractTotal } from '../../lib/demat/parse-text-helpers'

describe('parseNumber', () => {
    it('strips commas', () => {
        expect(parseNumber('1,23,456.78')).toBe(123456.78)
    })
})

describe('extractDate', () => {
    it('parses DD-MMM-YYYY', () => {
        expect(extractDate('As On: 31-Mar-2024')).toBe('2024-03-31')
    })

    it('parses statement period end date', () => {
        expect(extractDate('Statement Period: 01-Apr-2023 to 31-Mar-2024')).toBe('2024-03-31')
    })
})

describe('extractTotal', () => {
    it('parses total portfolio value', () => {
        expect(extractTotal('Total Portfolio Value: 1,23,456.78')).toBe(123456.78)
    })
})

describe('parseHoldings', () => {
    it('extracts NSDL-style demat rows', () => {
        const text = `
NATIONAL SECURITIES DEPOSITORY LIMITED
Statement Period: 01-Apr-2023 to 31-Mar-2024
ISIN Company Name Quantity Closing Price Value
INE002A01018 Reliance Industries Ltd. 100 2,950.00 2,95,000.00
INE009A01021 Infosys Ltd. 50 1,800.50 90,025.00
Total Portfolio Value: 3,85,025.00
    `.trim()
        const holdings = parseHoldings(text)
        expect(holdings).toHaveLength(2)
        expect(holdings[0].isin).toBe('INE002A01018')
        expect(holdings[0].company_name).toMatch(/Reliance Industries/)
        expect(holdings[0].quantity).toBe(100)
        expect(holdings[0].price).toBe(2950)
        expect(holdings[0].value).toBe(295000)
    })

    it('extracts CDSL-style multi-line rows', () => {
        const text = `
CDSL
ISIN
Company
Qty
Price
Value
INE002A01018
Reliance Industries
100
2,950.00
2,95,000.00
INE009A01021
Infosys Ltd
50
1,800.50
90,025.00
    `.trim()
        const holdings = parseHoldings(text)
        expect(holdings.length).toBeGreaterThanOrEqual(1)
        expect(holdings[0].isin).toBe('INE002A01018')
    })

    it('deduplicates by ISIN + company', () => {
        const text = `
INE002A01018 Reliance Industries Ltd. 100 2,950.00 2,95,000.00
INE002A01018 Reliance Industries Ltd. 100 2,950.00 2,95,000.00
    `.trim()
        const holdings = parseHoldings(text)
        expect(holdings).toHaveLength(1)
    })
})
