import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '../../../lib/db'
import { userProfile } from '../../../db/schema'
import { ok, err } from '../../../lib/contracts/error-envelope'
import { computePersonalInflation } from '../../../lib/inflation/compute'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../lib/auth/dev-user'
import { GoalTypeSchema } from '../../../lib/types/goal-types'
import logger from '../../../lib/logger'

const OnboardingSchema = z.object({
  age: z.number().int().min(18).max(100),
  city_tier: z.enum(['metro', 'tier2', 'tier3']),
  monthly_rent: z.number().min(0),
  owns_home: z.boolean(),
  dependents: z.enum(['none', 'spouse', 'kids', 'parents', 'multiple']),
  medical_conditions: z.boolean(),
  goals: z.array(z.object({
    type: GoalTypeSchema,
    amount: z.number(),
    timeline: z.number()
  })).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const { userId, isNew } = await resolveOrCreateUserId()

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(err('invalid_json', 'Request body must be valid JSON'), { status: 400 })
    }

    const parsed = OnboardingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        err('validation_error', 'Invalid onboarding data', parsed.error.issues),
        { status: 400 },
      )
    }

    const data = parsed.data
    const inflation = computePersonalInflation({
      age: data.age,
      city_tier: data.city_tier,
      monthly_rent: data.monthly_rent,
      owns_home: data.owns_home,
      dependents: data.dependents,
      medical_conditions: data.medical_conditions,
    })

    const now = new Date()
    await db
      .insert(userProfile)
      .values({
        userId,
        age: data.age,
        cityTier: data.city_tier,
        monthlyRent: String(data.monthly_rent),
        ownsHome: data.owns_home,
        dependents: data.dependents,
        medicalConditions: data.medical_conditions,
        inflationRate: String(inflation.rate),
        inflationBreakdown: inflation.breakdown,
        inflationConfidence: inflation.confidence,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: userProfile.userId,
        set: {
          age: data.age,
          cityTier: data.city_tier,
          monthlyRent: String(data.monthly_rent),
          ownsHome: data.owns_home,
          dependents: data.dependents,
          medicalConditions: data.medical_conditions,
          inflationRate: String(inflation.rate),
          inflationBreakdown: inflation.breakdown,
          inflationConfidence: inflation.confidence,
          computedAt: now,
        },
      })

    logger.info({ userId, rate: inflation.rate, confidence: inflation.confidence }, 'onboarding completed')

    const response = NextResponse.json(ok({ userId, inflation }))
    if (isNew) {
      response.cookies.set(COOKIE_NAME, userId, cookieOptions())
    }
    return response
  } catch (e) {
    logger.error({ err: e }, 'onboarding: database error')
    return NextResponse.json(
      err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
      { status: 500 },
    )
  }
}
