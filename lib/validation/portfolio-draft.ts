import { POLICY } from '@/lib/config/policy'

export type FundAllocation = {
  schemeCode: string
  percentage: number
}

export type PortfolioDraft = {
  allocations: FundAllocation[]
}

export type FundSnapshot = {
  /** SEBI / AMFI category, e.g. "Large Cap Fund" or "Index Fund". */
  category?: string
  /** Whether the fund is an index fund (exempt from single-fund cap). */
  isIndex?: boolean
}

export type PortfolioValidationResult = {
  valid: boolean
  errors: string[]
  normalized?: PortfolioDraft
}

export type ValidatePortfolioDraftOptions = {
  /** Tolerance around 100% allocation (percentage points). */
  allocationTolerancePct?: number
  /** Maximum percentage allowed for a single non-index fund. */
  maxSingleFundConcentrationPct?: number
  /** Whether index funds are exempt from the single-fund cap. */
  indexFundConcentrationExemption?: boolean
  /** Per-category bounds in percentage points, keyed by lower-case category. */
  categoryBounds?: Record<string, { min?: number; max?: number }>
  /** If true, auto-normalize allocations to sum to exactly 100 when within tolerance. */
  autoNormalize?: boolean
}

const EPS = 1e-9

function isIndexFund(snapshot?: FundSnapshot): boolean {
  if (!snapshot) return false
  if (snapshot.isIndex) return true
  const category = snapshot.category?.toLowerCase() ?? ''
  return category.includes('index') || category.includes('etf')
}

function roundPct(value: number, digits = 6): number {
  const factor = 10 ** digits
  return Math.round((value + EPS) * factor) / factor
}

function normalizeAllocations(allocations: FundAllocation[]): FundAllocation[] {
  const total = allocations.reduce((sum, a) => sum + a.percentage, 0)
  if (Math.abs(total - 100) < EPS) return allocations
  const factor = 100 / total
  return allocations.map((a) => ({
    schemeCode: a.schemeCode,
    percentage: roundPct(a.percentage * factor),
  }))
}

/**
 * Deterministic validator for portfolio drafts.
 *
 * Enforces:
 *   1. Allocation percentages sum to 100% ± tolerance.
 *   2. No duplicate scheme codes.
 *   3. Every scheme code exists in the supplied fund universe.
 *   4. Per-category weights stay within configured bounds.
 *   5. No single non-index fund exceeds the concentration cap.
 *
 * The function is pure: it does not call any LLM or database. The caller is
 * responsible for providing the fund universe (e.g. from `amfiSchemeMaster` or
 * a cached fund snapshot table).
 */
export function validatePortfolioDraft(
  draft: PortfolioDraft,
  fundUniverse: Record<string, FundSnapshot>,
  options: ValidatePortfolioDraftOptions = {},
): PortfolioValidationResult {
  const errors: string[] = []

  const allocationTolerancePct =
    options.allocationTolerancePct ?? POLICY.portfolio.allocationTolerancePct
  const maxSingleFundConcentrationPct =
    options.maxSingleFundConcentrationPct ?? POLICY.portfolio.maxSingleFundConcentrationPct
  const indexFundConcentrationExemption =
    options.indexFundConcentrationExemption ?? POLICY.portfolio.indexFundConcentrationExemption
  const categoryBounds = options.categoryBounds ?? {}

  if (!draft.allocations || draft.allocations.length === 0) {
    errors.push('Portfolio draft has no allocations')
    return { valid: false, errors }
  }

  // 1. Duplicate scheme codes.
  const seenCodes = new Set<string>()
  const duplicates = new Set<string>()
  for (const a of draft.allocations) {
    if (seenCodes.has(a.schemeCode)) {
      duplicates.add(a.schemeCode)
    }
    seenCodes.add(a.schemeCode)
  }
  if (duplicates.size > 0) {
    errors.push(`Duplicate scheme codes: ${[...duplicates].sort().join(', ')}`)
  }

  // 2. Every scheme exists in the fund universe.
  const missingCodes = draft.allocations
    .map((a) => a.schemeCode)
    .filter((code) => !fundUniverse[code])
  if (missingCodes.length > 0) {
    errors.push(`Unknown scheme codes: ${[...new Set(missingCodes)].sort().join(', ')}`)
  }

  // 3. Numeric validity.
  for (const a of draft.allocations) {
    if (typeof a.percentage !== 'number' || Number.isNaN(a.percentage)) {
      errors.push(`Allocation for ${a.schemeCode} is not a valid number`)
    } else if (a.percentage < 0) {
      errors.push(`Allocation for ${a.schemeCode} is negative (${a.percentage}%)`)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const total = draft.allocations.reduce((sum, a) => sum + a.percentage, 0)

  // 4. Allocation sum within tolerance.
  const lowerBound = 100 - allocationTolerancePct
  const upperBound = 100 + allocationTolerancePct
  if (total < lowerBound || total > upperBound) {
    errors.push(
      `Allocations sum to ${roundPct(total)}%, expected 100% ± ${allocationTolerancePct}%`,
    )
  }

  // 5. Per-category bounds.
  const categoryWeights: Record<string, number> = {}
  for (const a of draft.allocations) {
    const snapshot = fundUniverse[a.schemeCode]
    const category = (snapshot?.category ?? 'Unknown').toLowerCase()
    categoryWeights[category] = (categoryWeights[category] ?? 0) + a.percentage
  }
  for (const [category, weight] of Object.entries(categoryWeights)) {
    const bounds = categoryBounds[category]
    if (!bounds) continue
    if (bounds.min !== undefined && weight < bounds.min - EPS) {
      errors.push(`${category} allocation ${roundPct(weight)}% is below minimum ${bounds.min}%`)
    }
    if (bounds.max !== undefined && weight > bounds.max + EPS) {
      errors.push(`${category} allocation ${roundPct(weight)}% is above maximum ${bounds.max}%`)
    }
  }

  // 6. Single-fund concentration cap.
  for (const a of draft.allocations) {
    if (a.percentage > maxSingleFundConcentrationPct + EPS) {
      const snapshot = fundUniverse[a.schemeCode]
      const exempt = indexFundConcentrationExemption && isIndexFund(snapshot)
      if (!exempt) {
        errors.push(
          `${a.schemeCode} allocation ${roundPct(a.percentage)}% exceeds single-fund cap of ${maxSingleFundConcentrationPct}%`,
        )
      }
    }
  }

  const valid = errors.length === 0
  if (!valid) {
    return { valid: false, errors }
  }

  let normalized: PortfolioDraft | undefined
  if (options.autoNormalize && Math.abs(total - 100) > EPS) {
    normalized = { allocations: normalizeAllocations(draft.allocations) }
  }

  return { valid: true, errors: [], normalized }
}
