import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, notInArray, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { Dhruv } from '@/lib/agents/dhruv'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import { agentMemoryStore } from '@/lib/memory/memory-store'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import logger from '@/lib/logger'

const OnboardingSchema = z.object({
  age: z.number().int().min(18).max(100),
  city_tier: z.enum(['metro', 'tier2', 'tier3']),
  monthly_rent: z.number().min(0),
  owns_home: z.boolean(),
  dependents: z.enum(['none', 'spouse', 'kids', 'parents', 'multiple']),
  medical_conditions: z.boolean(),
})

const StartPipelineSchema = z.object({
  client_data: OnboardingSchema
})

export async function POST(req: NextRequest) {
  try {
    const { userId } = await resolveOrCreateUserId()

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'INVALID_JSON' },
        { status: 400 }
      )
    }

    const parsed = StartPipelineSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid client onboarding data', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    // Validate: no active pipeline_runs with status=RUNNING exists for this user.
    // Active statuses are any stage except APPROVED, DEADLOCKED, FAILED.
    const activeRuns = await db
      .select()
      .from(schema.pipelineRuns)
      .where(
        and(
          eq(schema.pipelineRuns.clientId, userId),
          notInArray(schema.pipelineRuns.status, ['APPROVED', 'DEADLOCKED', 'FAILED'])
        )
      )
      .limit(1)

    if (activeRuns.length > 0) {
      return NextResponse.json(
        { 
          error: 'An active pipeline run already exists for this user', 
          code: 'ACTIVE_RUN_EXISTS',
          pipeline_run_id: activeRuns[0].runId
        },
        { status: 409 }
      )
    }

    // Initialize Dhruv agent
    const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
    const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, db)

    // Map snake_case client_data keys to camelCase expected by the agents
    const clientData = {
      age: parsed.data.client_data.age,
      cityTier: parsed.data.client_data.city_tier,
      monthlyRent: parsed.data.client_data.monthly_rent,
      ownsHome: parsed.data.client_data.owns_home,
      dependents: parsed.data.client_data.dependents,
      medicalConditions: parsed.data.client_data.medical_conditions,
      yearsToGoal: 10,
      taxBracketPct: 30,
      version: 1
    }

    // Start pipeline
    const runId = await dhruv.startPipeline(userId, clientData)

    // Trigger Phase 1 in background (ONBOARDING -> KIRAN_RISK_PROFILE -> VIKRAM_INTERVIEW)
    dhruv.runPhase1(runId, userId, clientData).catch((err) => {
      logger.error({ err, runId }, 'API-START: Background runPhase1 failed')
    })

    return NextResponse.json({
      pipeline_run_id: runId,
      status: 'STARTED'
    })
  } catch (err) {
    logger.error({ err }, 'API-START: Failed to start pipeline')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
