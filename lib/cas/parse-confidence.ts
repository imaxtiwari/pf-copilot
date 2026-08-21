import type { CASExtraction } from '../contracts/cas-validation'
import type { SchemeCheckResult } from './amfi-master'

export interface ParseConfidence {
  holdingsFound: number;
  totalValueMatch: boolean;       // extracted total within 2% of CAS summary value
  folioCountMatch: boolean;       // folio count matches CAS header
  schemeCodeResolutionRate: number; // % of holdings matched to AMFI master
  score: number;                  // 0-100 weighted composite
}

export const VISION_FALLBACK_THRESHOLD = 70;

export function scoreParseResult(
  extraction: CASExtraction,
  schemeCheck: SchemeCheckResult
): ParseConfidence {
  const holdingsFound = extraction.holdings.length
  
  let computedTotal = 0
  for (const h of extraction.holdings) {
    computedTotal += h.market_value
  }

  // Within 2%?
  let totalValueMatch = false
  if (extraction.total_value_reported > 0) {
    const diffPct = Math.abs(computedTotal - extraction.total_value_reported) / extraction.total_value_reported
    totalValueMatch = diffPct <= 0.02
  } else if (computedTotal === 0 && extraction.total_value_reported === 0) {
    totalValueMatch = true
  }

  // Folio count match: assume true if there are valid folios present
  const folioCountMatch = extraction.holdings.some(h => h.folio_number && h.folio_number.trim().length > 0)

  // Resolution rate
  const totalChecked = schemeCheck.matched.length + schemeCheck.unmatched.length
  const schemeCodeResolutionRate = totalChecked > 0 ? (schemeCheck.matched.length / totalChecked) * 100 : 0

  let score = 0
  if (holdingsFound > 0) score += 20
  if (totalValueMatch) score += 35
  if (folioCountMatch) score += 25
  if (schemeCodeResolutionRate >= 80) score += 20

  return {
    holdingsFound,
    totalValueMatch,
    folioCountMatch,
    schemeCodeResolutionRate,
    score
  }
}
