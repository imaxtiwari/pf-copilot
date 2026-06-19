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
import { Riya } from '@/lib/agents/riya'

import { StructuredInterviewAnswersSchema, EssentialAnswersSchema } from '@/lib/agents/types/vikram-types'

const InterviewSchema = z.union([
  // Structured mode: client sends pre-validated structured object
  z.object({ mode: z.literal('structured'), answers: StructuredInterviewAnswersSchema }),
  // Legacy mode: freeform key-value (backward compatible, triggers LLM extraction)
  z.object({ mode: z.literal('freeform').optional(), answers: z.record(z.string(), z.string()) }),
  // Hypothesis mode
  z.object({
    mode: z.literal('hypothesis'),
    essential_answers: EssentialAnswersSchema,
    corrections: z.array(z.string()).optional(),
    finalize: z.boolean().optional()
  }),
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

    // Verify current stage is PROFILING_AND_GOAL_ASSESSMENT
    if (run.status !== 'PROFILING_AND_GOAL_ASSESSMENT') {
      return NextResponse.json(
        { error: `Pipeline is currently in stage ${run.status}, expected PROFILING_AND_GOAL_ASSESSMENT`, code: 'INVALID_STAGE' },
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

    let providedAnswers: any
    let isHypothesisMode = false

    if (parsed.data.mode === 'hypothesis') {
      isHypothesisMode = true
      const finalize = parsed.data.finalize ?? false
      const vikram = new Vikram(deliberationRoom, agentMemoryStore, new WebResearchTool('VIKRAM', agentMemoryStore, deliberationRoom), db)
      
      if (!finalize) {
        const riya = new Riya(deliberationRoom, agentMemoryStore, new WebResearchTool('RIYA', agentMemoryStore, deliberationRoom), db)
        const fingerprint = await riya.getOrGenerateFingerprint(userId, runId, [])
        const hypothesis = await vikram.generateHypothesis(parsed.data.essential_answers, clientData, runId, fingerprint)
        return NextResponse.json({
          pipeline_run_id: runId,
          status: 'HYPOTHESIS_GENERATED',
          hypothesis
        })
      }

      const assessment = await vikram.runHypothesisInterview({
        userId,
        clientData,
        essentialAnswers: parsed.data.essential_answers,
        userCorrections: parsed.data.corrections,
      }, runId)
      providedAnswers = {
        goalAssessment: assessment,
        goalHypothesisCorrections: parsed.data.corrections || []
      }
    } else if (parsed.data.mode === 'structured') {
      const sa = parsed.data.answers  // StructuredInterviewAnswers
      providedAnswers = {
        monthly_income_lakh: sa.monthly_income_lakh,
        monthly_expenses_lakh: sa.monthly_expenses_lakh,
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
    dhruv.runPhase2(runId, userId, clientData, providedAnswers, isHypothesisMode).catch((err) => {
      logger.error({ err, runId }, 'API-INTERVIEW: Background runPhase2 failed')
    })

    return NextResponse.json({
      pipeline_run_id: runId,
      status: 'INTERVIEW_ACCEPTED',
      stage: 'SOMA_FUND_UNIVERSE'
    })
  } catch (err) {
    logger.error({ err }, 'API-INTERVIEW: Failed to submit interview answers')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

export async function GET(
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

    if (run.clientId !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized access to this pipeline run', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const memoryKey = `VIKRAM:goal_hypothesis:${userId}:${runId}`
    let hypothesis = null

    try {
      const recalled = await agentMemoryStore.recall('VIKRAM', memoryKey, {
        limit: 1,
        pipeline_run_id: runId
      })
      if (recalled.length > 0) {
        hypothesis = JSON.parse(recalled[0].content)
      }
    } catch (err) {
      logger.warn({ err, runId }, 'API-INTERVIEW: Failed to recall hypothesis from memory')
    }

    return NextResponse.json({
      hypothesis,
      stage: run.status
    })
  } catch (err) {
    logger.error({ err }, 'API-INTERVIEW: Failed to fetch interview hypothesis')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

