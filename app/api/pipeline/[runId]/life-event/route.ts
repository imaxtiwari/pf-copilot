import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { Dhruv } from '@/lib/agents/dhruv'
import { Vikram } from '@/lib/agents/vikram'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import { agentMemoryStore } from '@/lib/memory/memory-store'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { LifeEventSchema, MAJOR_LIFE_EVENTS } from '@/lib/agents/types/life-event-types'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'

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

    // Fetch the pipeline_runs record for runId
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

    // Verify run.status === 'APPROVED'
    if (run.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Pipeline run is not APPROVED', code: 'PIPELINE_NOT_COMPLETE' },
        { status: 400 }
      )
    }

    // Parse and Zod-validate LifeEvent from request body
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'INVALID_JSON' },
        { status: 400 }
      )
    }

    const parsed = LifeEventSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid life event data', code: 'VALIDATION_ERROR', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const lifeEvent = parsed.data

    // Log to audit trail
    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: 'SYSTEM',
      action_type: AuditActionType.LIFE_EVENT_RECEIVED,
      payload: {
        event_type: lifeEvent.event_type,
        description: lifeEvent.description,
        financial_impact_lakh: lifeEvent.financial_impact_lakh,
        new_monthly_income_lakh: lifeEvent.new_monthly_income_lakh,
        effective_date: lifeEvent.effective_date
      }
    })

    // Instantiate Vikram agent to assess impact
    const vikramResearchTool = new WebResearchTool('VIKRAM', agentMemoryStore, deliberationRoom)
    const vikram = new Vikram(deliberationRoom, agentMemoryStore, vikramResearchTool, db)

    // Call assessLifeEventImpact
    const impactAssessment = await vikram.assessLifeEventImpact(lifeEvent, runId, runId)

    if (impactAssessment.requires_pipeline_restart) {
      // Fetch user profile to reconstruct client data
      const [profile] = await db
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.userId, userId))
        .limit(1)

      const reconstructedClientData = {
        age: profile?.age ?? 35,
        cityTier: profile?.cityTier ?? 'metro',
        monthlyRent: profile?.monthlyRent ? parseFloat(profile.monthlyRent) : 0,
        ownsHome: profile?.ownsHome ?? false,
        dependents: profile?.dependents ?? 'none',
        medicalConditions: profile?.medicalConditions ?? false,
        yearsToGoal: 10,
        taxBracketPct: 30,
        version: 1
      }

      // Initialize Dhruv agent
      const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)
      const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, db)

      // Start new pipeline run
      const newRunId = await dhruv.startPipeline(userId, reconstructedClientData)

      // Trigger Phase 1 in background (ONBOARDING -> KIRAN_RISK_PROFILE -> VIKRAM_INTERVIEW)
      dhruv.runPhase1(newRunId, userId, reconstructedClientData).catch((err) => {
        logger.error({ err, newRunId }, 'API-LIFE-EVENT: Background runPhase1 failed')
      })

      return NextResponse.json({
        restart_initiated: true,
        new_run_id: newRunId,
        impact_assessment: impactAssessment
      })
    } else {
      return NextResponse.json({
        restart_initiated: false,
        impact_assessment: impactAssessment,
        guidance: impactAssessment.guidance
      })
    }
  } catch (err) {
    logger.error({ err }, 'API-LIFE-EVENT: Failed to process life event')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
