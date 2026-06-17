import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { Dhruv } from '@/lib/agents/dhruv'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import { agentMemoryStore } from '@/lib/memory/memory-store'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import logger from '@/lib/logger'
import { Vikram } from '@/lib/agents/vikram'

import { StructuredInterviewAnswersSchema } from '@/lib/agents/types/vikram-types'

const InterviewSchema = z.union([
  // Structured mode: client sends pre-validated structured object
  z.object({ mode: z.literal('structured'), answers: StructuredInterviewAnswersSchema }),
  // Legacy mode: freeform key-value (backward compatible, triggers LLM extraction)
  z.object({ mode: z.literal('freeform').optional(), answers: z.record(z.string(), z.string()) }),
])

export async function POST(
  req: NextRequest,
  context: { params: any }
) {
  try {
    const { userId } = await resolveOrCreateUserId()
    const params = await context.params
    const runId = params.runId

    if (!runId) {
      return NextResponse.json(
        { error: 'Missing run ID', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'INVALID_JSON' },
        { status: 400 }
      )
    }

    const parsed = InterviewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid interview answers format', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const [run] = await db
      .select()
      .from(schema.pipelineRuns)
      .where(eq(schema.pipelineRuns.runId, runId))
      .limit(1)

    if (!run) {
      return NextResponse.json(
        { error: 'Pipeline run not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (run.clientId !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized access to this pipeline run', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    // Verify current stage is VIKRAM_INTERVIEW
    if (run.status !== 'VIKRAM_INTERVIEW') {
      return NextResponse.json(
        { error: `Pipeline is currently in stage ${run.status}, expected VIKRAM_INTERVIEW`, code: 'INVALID_STAGE' },
        { status: 400 }
      )
    }

    // Retrieve user profile to reconstruct demographics
    const [profile] = await db
      .select()
      .from(schema.userProfile)
      .where(eq(schema.userProfile.userId, userId))
      .limit(1)

    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found. Please complete onboarding first.', code: 'PROFILE_NOT_FOUND' },
        { status: 400 }
      )
    }

    const clientData = {
      age: profile.age,
      cityTier: profile.cityTier,
      monthlyRent: Number(profile.monthlyRent || 0),
      ownsHome: profile.ownsHome,
      dependents: profile.dependents,
      medicalConditions: profile.medicalConditions,
      yearsToGoal: 10,
      taxBracketPct: 30,
      version: 1
    }

    let providedAnswers: { monthly_income_lakh: number; stated_goals: string[]; answers: Record<string, string>; goals_data: any[] }
    if (parsed.data.mode === 'structured') {
      const sa = parsed.data.answers  // StructuredInterviewAnswers
      providedAnswers = {
        monthly_income_lakh: sa.monthly_income_lakh,
        stated_goals: sa.goals.map(g => g.description),
        answers: {},  // not needed in structured mode
        goals_data: sa.goals.map(g => ({
          goal_id: randomUUID(),
          goal_type: g.goal_type,
          description: g.description,
          target_corpus_lakh: g.target_corpus_lakh,
          current_corpus_lakh: g.current_corpus_lakh,
          monthly_sip_required_lakh: g.monthly_sip_required_lakh,
          target_date: g.target_date,
        }))
      }
    } else {
      // Freeform mode: use LLM extraction via a new VIKRAM method
      const vikramExtractor = new Vikram(deliberationRoom, agentMemoryStore, new WebResearchTool('VIKRAM', agentMemoryStore, deliberationRoom), db)
      providedAnswers = await vikramExtractor.extractStructuredAnswers(parsed.data.answers, runId)
    }

    // Initialize Dhruv agent
    const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
    const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, db)

    // Trigger Phase 2 in the background (Goal Assessment -> Portfolio Build -> Voting -> End)
    dhruv.runPhase2(runId, userId, clientData, providedAnswers).catch((err) => {
      logger.error({ err, runId }, 'API-INTERVIEW: Background runPhase2 failed')
    })

    return NextResponse.json({
      stage: 'VIKRAM_GOAL_ASSESSMENT',
      message: 'Goals assessment in progress'
    })
  } catch (err) {
    logger.error({ err }, 'API-INTERVIEW: Failed to submit interview answers')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
