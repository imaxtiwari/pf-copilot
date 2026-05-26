import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { computePersonalInflation } from '@/lib/inflation/compute'
import type { UserProfileInput } from '@/lib/inflation/compute'
import logger from '@/lib/logger'

const STALENESS_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

export type ComputeInflationResult = {
  inflation_rate: number
  confidence: 'low' | 'medium' | 'high'
  breakdown: Array<{
    sleeve: string
    weight: number
    rate: number
    contribution: number
  }>
  computed_at: string | null
  note: string | null
}

export async function computePersonalInflationTool(userId: string): Promise<ComputeInflationResult> {
  const profile = await db.query.userProfile.findFirst({
    where: eq(schema.userProfile.userId, userId),
  })

  if (!profile) {
    // No profile — compute with empty input (fallback / low confidence)
    const result = computePersonalInflation({})
    return {
      inflation_rate: result.rate,
      confidence: result.confidence,
      breakdown: result.breakdown,
      computed_at: null,
      note: 'No onboarding profile found. Complete onboarding at /onboarding for a personalised rate.',
    }
  }

  // If already computed, return stored value (log a warning if stale)
  if (profile.inflationRate && profile.computedAt) {
    const ageMs = Date.now() - profile.computedAt.getTime()
    if (ageMs > STALENESS_THRESHOLD_MS) {
      logger.warn(
        { userId, computedAt: profile.computedAt.toISOString(), ageDays: Math.floor(ageMs / 86400000) },
        'inflation: stored rate is stale (>90 days) — user should redo onboarding',
      )
    }
    return {
      inflation_rate: Number(profile.inflationRate),
      confidence: (profile.inflationConfidence as 'low' | 'medium' | 'high') ?? 'low',
      breakdown: (profile.inflationBreakdown as ComputeInflationResult['breakdown']) ?? [],
      computed_at: profile.computedAt.toISOString(),
      note: ageMs > STALENESS_THRESHOLD_MS
        ? 'Inflation rate was computed more than 90 days ago. Consider updating your profile at /onboarding.'
        : null,
    }
  }

  // Recompute from profile fields
  const input: UserProfileInput = {
    age: profile.age ?? undefined,
    city_tier: (profile.cityTier as UserProfileInput['city_tier']) ?? undefined,
    monthly_rent: profile.monthlyRent ? Number(profile.monthlyRent) : undefined,
    owns_home: profile.ownsHome ?? undefined,
    dependents: (profile.dependents as UserProfileInput['dependents']) ?? undefined,
    medical_conditions: profile.medicalConditions ?? undefined,
  }
  const result = computePersonalInflation(input)
  return {
    inflation_rate: result.rate,
    confidence: result.confidence,
    breakdown: result.breakdown,
    computed_at: null,
    note: 'Recomputed from profile (not yet stored). Complete onboarding to persist.',
  }
}
