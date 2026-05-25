import { describe, it, expect } from 'vitest'
import { computePersonalInflation } from '../../lib/inflation/compute'
import { inferWeights } from '../../lib/inflation/weights'
import { FALLBACK_RATE, SLEEVE_NAMES } from '../../lib/inflation/constants'

// ── helpers ───────────────────────────────────────────────────────────────────

const VALID_CITY_TIERS = ['metro', 'tier2', 'tier3'] as const
const VALID_DEPENDENTS = ['none', 'spouse', 'kids', 'parents', 'multiple'] as const

function sumWeights(w: ReturnType<typeof inferWeights>): number {
  return w.general + w.medical + w.education + w.lifestyle
}

function sumContributions(result: ReturnType<typeof computePersonalInflation>): number {
  return result.breakdown.reduce((s, b) => s + b.contribution, 0)
}

// ── realistic profile tests ────────────────────────────────────────────────────

describe('computePersonalInflation — realistic profiles', () => {
  it('1. 25-yr-old metro renter, no dependents, no medical → rate ~7–8%', () => {
    const r = computePersonalInflation({
      age: 25, city_tier: 'metro', monthly_rent: 20000,
      owns_home: false, dependents: 'none', medical_conditions: false,
    })
    expect(r.rate).toBeGreaterThanOrEqual(0.07)
    expect(r.rate).toBeLessThan(0.08)
    expect(r.confidence).toBe('high')
    // metro renter bonus pushes lifestyle up
    expect(r.weights.lifestyle).toBeGreaterThan(0.55)
  })

  it('2. 35-yr-old tier-2 homeowner with kids, no medical → ~8–9%, education > 0.20', () => {
    const r = computePersonalInflation({
      age: 35, city_tier: 'tier2', monthly_rent: 0,
      owns_home: true, dependents: 'kids', medical_conditions: false,
    })
    expect(r.rate).toBeGreaterThanOrEqual(0.08)
    expect(r.rate).toBeLessThan(0.09)
    expect(r.weights.education).toBeGreaterThan(0.20)
    expect(r.confidence).toBe('high')
  })

  it('3. 55-yr-old metro homeowner, spouse, medical conditions → ~8.5–10%, medical > 0.30', () => {
    const r = computePersonalInflation({
      age: 55, city_tier: 'metro', monthly_rent: 0,
      owns_home: true, dependents: 'spouse', medical_conditions: true,
    })
    expect(r.rate).toBeGreaterThanOrEqual(0.085)
    expect(r.rate).toBeLessThan(0.10)
    expect(r.weights.medical).toBeGreaterThan(0.30)
    expect(r.confidence).toBe('high')
  })

  it('4. 72-yr-old, owns home, spouse, medical conditions → ~10–11%, medical > 0.50', () => {
    const r = computePersonalInflation({
      age: 72, city_tier: 'metro', monthly_rent: 0,
      owns_home: true, dependents: 'spouse', medical_conditions: true,
    })
    expect(r.rate).toBeGreaterThanOrEqual(0.10)
    expect(r.rate).toBeLessThan(0.11)
    expect(r.weights.medical).toBeGreaterThan(0.50)
    expect(r.confidence).toBe('high')
  })
})

// ── confidence tests ──────────────────────────────────────────────────────────

describe('computePersonalInflation — confidence levels', () => {
  it('5. empty profile → FALLBACK_RATE, confidence low', () => {
    const r = computePersonalInflation({})
    expect(r.rate).toBe(FALLBACK_RATE)
    expect(r.confidence).toBe('low')
    expect(r.weights).toEqual({ general: 0.25, medical: 0.25, education: 0.25, lifestyle: 0.25 })
  })

  it('6. 2 fields missing → confidence medium', () => {
    // age + city_tier set; 4 others missing → medium (1–2 missing would be medium, 3+ is low)
    // Provide 4 of 6 fields (2 missing) → medium
    const r = computePersonalInflation({
      age: 30, city_tier: 'metro', owns_home: false, dependents: 'none',
      // monthly_rent and medical_conditions missing
    })
    expect(r.confidence).toBe('medium')
  })

  it('7. all 6 fields set → confidence high', () => {
    const r = computePersonalInflation({
      age: 40, city_tier: 'tier2', monthly_rent: 30000,
      owns_home: false, dependents: 'spouse', medical_conditions: false,
    })
    expect(r.confidence).toBe('high')
  })

  it('8. exactly 3 fields missing → confidence low (fallback rate returned)', () => {
    const r = computePersonalInflation({
      age: 35, city_tier: 'metro', medical_conditions: false,
      // owns_home, dependents, monthly_rent missing = 3 missing
    })
    expect(r.confidence).toBe('low')
    expect(r.rate).toBe(FALLBACK_RATE)
  })
})

// ── numeric invariants ────────────────────────────────────────────────────────

describe('inferWeights — numeric invariants', () => {
  it('9. weights sum to exactly 1.0 for a simple profile', () => {
    const w = inferWeights({
      age: 35, city_tier: 'tier2', monthly_rent: 0,
      owns_home: false, dependents: 'none', medical_conditions: false,
    })
    expect(Math.abs(sumWeights(w) - 1.0)).toBeLessThan(1e-12)
  })

  it('10. no weight is negative for any valid input', () => {
    // Enumerate all combinations that could stress lifestyle to zero
    const stressProfiles = [
      { age: 35, city_tier: 'metro' as const, monthly_rent: 0, owns_home: true, dependents: 'kids' as const, medical_conditions: true },
      { age: 45, city_tier: 'tier2' as const, monthly_rent: 0, owns_home: true, dependents: 'parents' as const, medical_conditions: true },
      { age: 60, city_tier: 'metro' as const, monthly_rent: 0, owns_home: true, dependents: 'multiple' as const, medical_conditions: true },
      { age: 70, city_tier: 'tier3' as const, monthly_rent: 0, owns_home: true, dependents: 'spouse' as const, medical_conditions: true },
    ]
    for (const p of stressProfiles) {
      const w = inferWeights(p)
      expect(w.general).toBeGreaterThanOrEqual(0)
      expect(w.medical).toBeGreaterThanOrEqual(0)
      expect(w.education).toBeGreaterThanOrEqual(0)
      expect(w.lifestyle).toBeGreaterThanOrEqual(0)
    }
  })

  it('11. lifestyle stays ≥ 0 when owns_home + medical_conditions both active', () => {
    // 30-50 with both: lifestyle starts 0.30, -0.10 (medical) -0.10 (owns_home) = 0.10 left
    const w = inferWeights({
      age: 40, city_tier: 'tier2', monthly_rent: 0,
      owns_home: true, dependents: 'spouse', medical_conditions: true,
    })
    expect(w.lifestyle).toBeGreaterThanOrEqual(0)
    expect(Math.abs(sumWeights(w) - 1.0)).toBeLessThan(1e-12)
  })

  it('12. property test: 100 random valid profiles → weights always sum to 1.0', () => {
    for (let i = 0; i < 100; i++) {
      const age = Math.floor(Math.random() * 80) + 15
      const city_tier = VALID_CITY_TIERS[Math.floor(Math.random() * 3)]
      const dependents = VALID_DEPENDENTS[Math.floor(Math.random() * 5)]
      const owns_home = Math.random() > 0.5
      const medical_conditions = Math.random() > 0.5
      const w = inferWeights({ age, city_tier, monthly_rent: 0, owns_home, dependents, medical_conditions })
      expect(Math.abs(sumWeights(w) - 1.0)).toBeLessThan(1e-12)
      expect(w.general).toBeGreaterThanOrEqual(0)
      expect(w.medical).toBeGreaterThanOrEqual(0)
      expect(w.education).toBeGreaterThanOrEqual(0)
      expect(w.lifestyle).toBeGreaterThanOrEqual(0)
    }
  })
})

// ── rounding rule ─────────────────────────────────────────────────────────────

describe('computePersonalInflation — rounding rule', () => {
  it('13. breakdown contributions sum to rate ± 0.00005 (only final rate is rounded)', () => {
    const profiles = [
      { age: 25, city_tier: 'metro' as const, monthly_rent: 0, owns_home: false, dependents: 'none' as const, medical_conditions: false },
      { age: 35, city_tier: 'tier2' as const, monthly_rent: 0, owns_home: true, dependents: 'kids' as const, medical_conditions: false },
      { age: 72, city_tier: 'metro' as const, monthly_rent: 0, owns_home: true, dependents: 'spouse' as const, medical_conditions: true },
    ]
    for (const p of profiles) {
      const r = computePersonalInflation(p)
      const contributionSum = sumContributions(r)
      expect(Math.abs(contributionSum - r.rate)).toBeLessThanOrEqual(0.00005)
    }
  })

  it('14. fallback rate: contributions also sum to FALLBACK_RATE (equal weights × sleeve rates = 0.09)', () => {
    const r = computePersonalInflation({})
    expect(sumContributions(r)).toBeCloseTo(FALLBACK_RATE, 10)
  })
})

// ── compounding and edge cases ────────────────────────────────────────────────

describe('computePersonalInflation — compounding and edge cases', () => {
  it('15. medical_conditions + dependents=parents compounds to higher medical weight than either alone', () => {
    const base = inferWeights({ age: 45, city_tier: 'tier2', monthly_rent: 0, owns_home: false, dependents: 'none', medical_conditions: false })
    const withMedical = inferWeights({ age: 45, city_tier: 'tier2', monthly_rent: 0, owns_home: false, dependents: 'none', medical_conditions: true })
    const withParents = inferWeights({ age: 45, city_tier: 'tier2', monthly_rent: 0, owns_home: false, dependents: 'parents', medical_conditions: false })
    const combined = inferWeights({ age: 45, city_tier: 'tier2', monthly_rent: 0, owns_home: false, dependents: 'parents', medical_conditions: true })
    expect(combined.medical).toBeGreaterThan(withMedical.medical)
    expect(combined.medical).toBeGreaterThan(withParents.medical)
    expect(combined.medical).toBeGreaterThan(base.medical)
  })

  it('16. same profile always produces identical output (determinism)', () => {
    const profile = { age: 38, city_tier: 'metro' as const, monthly_rent: 45000, owns_home: false, dependents: 'kids' as const, medical_conditions: false }
    const r1 = computePersonalInflation(profile)
    const r2 = computePersonalInflation(profile)
    expect(r1).toEqual(r2)
  })

  it('17. output is JSON-serializable', () => {
    const r = computePersonalInflation({
      age: 30, city_tier: 'tier2', monthly_rent: 25000,
      owns_home: false, dependents: 'none', medical_conditions: false,
    })
    expect(() => JSON.stringify(r)).not.toThrow()
    const parsed = JSON.parse(JSON.stringify(r))
    expect(parsed.rate).toBe(r.rate)
    expect(parsed.confidence).toBe(r.confidence)
    expect(parsed.breakdown).toHaveLength(SLEEVE_NAMES.length)
  })

  it('18. throws a clear error on invalid city_tier, not a silent default', () => {
    expect(() =>
      inferWeights({ age: 35, city_tier: 'mumbai' as never, monthly_rent: 0, owns_home: false, dependents: 'none', medical_conditions: false }),
    ).toThrow(/Invalid city_tier/)
  })

  it('19. throws a clear error on invalid dependents value', () => {
    expect(() =>
      inferWeights({ age: 35, city_tier: 'metro', monthly_rent: 0, owns_home: false, dependents: 'sibling' as never, medical_conditions: false }),
    ).toThrow(/Invalid dependents/)
  })

  it('20. medium confidence: age + city_tier missing → defaults applied, result still valid', () => {
    // Covers age ?? DEFAULT and city_tier ?? DEFAULT branches in filled object
    const r = computePersonalInflation({
      monthly_rent: 30000, owns_home: false, dependents: 'none', medical_conditions: false,
      // age and city_tier missing — 2 missing → medium
    })
    expect(r.confidence).toBe('medium')
    expect(r.rate).toBeGreaterThan(0)
    expect(Math.abs(sumContributions(r) - r.rate)).toBeLessThanOrEqual(0.00005)
  })

  it('21. medium confidence: owns_home + dependents missing → defaults applied, result still valid', () => {
    // Covers owns_home ?? DEFAULT and dependents ?? DEFAULT branches in filled object
    const r = computePersonalInflation({
      age: 40, city_tier: 'tier2', monthly_rent: 20000, medical_conditions: false,
      // owns_home and dependents missing — 2 missing → medium
    })
    expect(r.confidence).toBe('medium')
    expect(r.rate).toBeGreaterThan(0)
    expect(Math.abs(sumWeights(r.weights) - 1.0)).toBeLessThan(1e-12)
  })
})
