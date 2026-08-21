export type DematHolding = {
    isin: string
    company_name: string
    quantity: number
    price: number
    value: number
}

export type DematExtraction = {
    source: 'NSDL' | 'CDSL'
    as_of_date: string // YYYY-MM-DD
    total_value_reported: number
    holdings: DematHolding[]
    _extraction_notes?: string[]
}

export type ValidationResult =
    | { ok: true; extraction: DematExtraction }
    | { ok: false; errors: string[] }

const VALUE_TOLERANCE_PCT = 0.01 // ±1% of reported value per holding
const TOTAL_TOLERANCE_PCT = 0.01 // ±1% of total

function isValidPositiveNumber(n: unknown): n is number {
    return typeof n === 'number' && isFinite(n) && n > 0
}

function isValidNonNegativeNumber(n: unknown): n is number {
    return typeof n === 'number' && isFinite(n) && n >= 0
}

export function validateDemat(extraction: DematExtraction): ValidationResult {
    const errors: string[] = []

    if (!extraction.holdings || extraction.holdings.length === 0) {
        return { ok: false, errors: ['Holdings array is empty'] }
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const asOf = new Date(extraction.as_of_date + 'T00:00:00Z')
    if (isNaN(asOf.getTime())) {
        errors.push(`Invalid as_of_date: "${extraction.as_of_date}"`)
    } else if (asOf > today) {
        errors.push(`as_of_date ${extraction.as_of_date} is in the future`)
    }

    let computedTotal = 0
    for (const h of extraction.holdings) {
        if (
            !isValidPositiveNumber(h.quantity) ||
            !isValidPositiveNumber(h.price) ||
            !isValidNonNegativeNumber(h.value)
        ) {
            errors.push(
                `${h.company_name}: quantity or price is zero/NaN/Infinity, or value is NaN/Infinity`,
            )
            continue
        }

        const expected = h.quantity * h.price
        const tolerance = Math.max(expected * VALUE_TOLERANCE_PCT, 0.01)
        if (Math.abs(expected - h.value) > tolerance) {
            errors.push(
                `${h.company_name}: quantity×price=${expected.toFixed(2)} but value=${h.value.toFixed(2)} (diff ${Math.abs(expected - h.value).toFixed(2)} > ${tolerance.toFixed(2)})`,
            )
        }
        computedTotal += h.value
    }

    if (extraction.total_value_reported > 0) {
        const pct =
            Math.abs(computedTotal - extraction.total_value_reported) /
            extraction.total_value_reported
        if (pct > TOTAL_TOLERANCE_PCT) {
            errors.push(
                `Portfolio total mismatch: reported=${extraction.total_value_reported.toFixed(2)} computed=${computedTotal.toFixed(2)} (${(pct * 100).toFixed(2)}% > 1%)`,
            )
        }
    }

    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, extraction }
}
