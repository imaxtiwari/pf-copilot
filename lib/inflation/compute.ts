import { SLEEVE_RATES, SLEEVE_NAMES, FALLBACK_RATE } from './constants'
import { inferWeights } from './weights'
import type { Weights } from './weights'

export type { Weights }

export type UserProfileInput = {
  age?: number
  city_tier?: 'metro' | 'tier2' | 'tier3'
  monthly_rent?: number
  owns_home?: boolean
  dependents?: 'none' | 'spouse' | 'kids' | 'parents' | 'multiple'
  medical_conditions?: boolean
}

export type BreakdownItem = {
  sleeve: string
  weight: number      // full precision
  rate: number        // sleeve rate, full precision
  contribution: number // weight × rate, full precision
}

export type InflationResult = {
  rate: number           // ROUNDED to 4 decimals (final, exposed)
  weights: Weights       // full precision
  breakdown: BreakdownItem[]
  confidence: 'low' | 'medium' | 'high'
}

const PROFILE_FIELDS = [
  'age', 'city_tier', 'monthly_rent', 'owns_home', 'dependents', 'medical_conditions',
] as const

function countMissing(profile: UserProfileInput): number {
  return PROFILE_FIELDS.filter((f) => profile[f] === undefined || profile[f] === null).length
}

// Sensible defaults used when fields are absent for medium/high confidence paths
const DEFAULTS = {
  age: 35,
  city_tier: 'tier2' as const,
  monthly_rent: 0,
  owns_home: false,
  dependents: 'none' as const,
  medical_conditions: false,
}

export function computePersonalInflation(profile: UserProfileInput): InflationResult {
  const missing = countMissing(profile)

  // 3+ fields missing: return fallback rate with equal weights.
  // Rate is derived from the breakdown sum (same as the normal path) so the two
  // can never diverge if SLEEVE_RATES change. FALLBACK_RATE is kept as a named
  // constant only for documentation/reference purposes.
  if (missing >= 3) {
    void FALLBACK_RATE // kept for documentation — actual rate computed from breakdown
    const fallbackWeights: Weights = { general: 0.25, medical: 0.25, education: 0.25, lifestyle: 0.25 }
    const breakdown = SLEEVE_NAMES.map((s) => ({
      sleeve: s,
      weight: 0.25,
      rate: SLEEVE_RATES[s],
      contribution: 0.25 * SLEEVE_RATES[s],
    }))
    const fallbackRate = Math.round(
      breakdown.reduce((s, b) => s + b.contribution, 0) * 10000,
    ) / 10000
    return { rate: fallbackRate, weights: fallbackWeights, breakdown, confidence: 'low' }
  }

  const confidence = missing === 0 ? 'high' : 'medium'

  const filled = {
    age: profile.age ?? DEFAULTS.age,
    city_tier: profile.city_tier ?? DEFAULTS.city_tier,
    monthly_rent: profile.monthly_rent ?? DEFAULTS.monthly_rent,
    owns_home: profile.owns_home ?? DEFAULTS.owns_home,
    dependents: profile.dependents ?? DEFAULTS.dependents,
    medical_conditions: profile.medical_conditions ?? DEFAULTS.medical_conditions,
  }

  const weights = inferWeights(filled)
  const breakdown = SLEEVE_NAMES.map((s) => ({
    sleeve: s,
    weight: weights[s],
    rate: SLEEVE_RATES[s],
    contribution: weights[s] * SLEEVE_RATES[s],
  }))

  const rawRate = breakdown.reduce((sum, b) => sum + b.contribution, 0)
  // Round ONLY here — breakdown contributions intentionally stay at full precision
  const rate = Math.round(rawRate * 10000) / 10000

  return { rate, weights, breakdown, confidence }
}
