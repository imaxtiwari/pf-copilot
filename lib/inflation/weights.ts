import type { SleeveName } from './constants'

export type UserProfile = {
  age: number
  city_tier: 'metro' | 'tier2' | 'tier3'
  monthly_rent: number
  owns_home: boolean
  dependents: 'none' | 'spouse' | 'kids' | 'parents' | 'multiple'
  medical_conditions: boolean
}

export type Weights = Record<SleeveName, number>

const VALID_CITY_TIERS = new Set(['metro', 'tier2', 'tier3'])
const VALID_DEPENDENTS = new Set(['none', 'spouse', 'kids', 'parents', 'multiple'])

function transfer(w: Weights, from: SleeveName, to: SleeveName, amount: number): void {
  const actual = Math.min(amount, w[from])
  w[from] -= actual
  w[to] += actual
}

export function inferWeights(profile: UserProfile): Weights {
  if (!VALID_CITY_TIERS.has(profile.city_tier)) {
    throw new Error(
      `Invalid city_tier: "${profile.city_tier}". Must be one of: metro, tier2, tier3`,
    )
  }
  if (!VALID_DEPENDENTS.has(profile.dependents)) {
    throw new Error(
      `Invalid dependents: "${profile.dependents}". Must be one of: none, spouse, kids, parents, multiple`,
    )
  }

  // Base weights by age band (30–50 inclusive at 50; 50–65 is exclusive at 50)
  let w: Weights
  if (profile.age < 30) {
    w = { general: 0.30, medical: 0.10, education: 0.05, lifestyle: 0.55 }
  } else if (profile.age <= 50) {
    w = { general: 0.35, medical: 0.15, education: 0.20, lifestyle: 0.30 }
  } else if (profile.age <= 65) {
    w = { general: 0.35, medical: 0.30, education: 0.05, lifestyle: 0.30 }
  } else {
    w = { general: 0.25, medical: 0.50, education: 0.00, lifestyle: 0.25 }
  }

  // Adjustments — applied in order; lifestyle is floored at 0 via transfer()
  if (profile.medical_conditions) {
    transfer(w, 'lifestyle', 'medical', 0.10)
  }
  if (profile.dependents === 'kids' && profile.age >= 30 && profile.age <= 50) {
    transfer(w, 'lifestyle', 'education', 0.10)
  }
  if (profile.dependents === 'parents') {
    transfer(w, 'lifestyle', 'medical', 0.05)
  }
  if (profile.owns_home) {
    transfer(w, 'lifestyle', 'general', 0.10)
  }
  if (profile.city_tier === 'metro' && !profile.owns_home) {
    transfer(w, 'general', 'lifestyle', 0.05)
  }

  // Normalize to exactly 1.0 — absorbs any floating-point drift from the transfers
  const total = w.general + w.medical + w.education + w.lifestyle
  w.general /= total
  w.medical /= total
  w.education /= total
  w.lifestyle /= total

  return w
}
