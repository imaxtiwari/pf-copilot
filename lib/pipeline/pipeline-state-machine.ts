import { z } from 'zod'
import { eq, asc } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'
import type { DbClient } from '@/lib/db'

// Educational-simulation stages for the DHRUV committee pipeline.
export const PipelineStageSchema = z.enum([
  'INTAKE',
  'RIYA_BEHAVIORAL_PROFILING',
  'PROFILING_AND_GOAL_ASSESSMENT',
  'SOMA_FUND_UNIVERSE',
  'VIKRAM_STRATEGY',
  'KIRAN_HEDGE_MAP',
  'ARIA_PREFLIGHT',
  'PRIYA_BUILD',
  'SEBI_COMPLIANCE',
  'DELIBERATION',
  'COMMITTEE_VOTE',
  'REVISION',
  'ATLAS_COMPARISON',
  'PDF_GENERATION',
  'COMPLETED',
  'DEADLOCKED',
  'FAILED',
])

export type PipelineStage = z.infer<typeof PipelineStageSchema>

export const LEGAL_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  INTAKE: ['RIYA_BEHAVIORAL_PROFILING', 'PROFILING_AND_GOAL_ASSESSMENT', 'FAILED'],
  RIYA_BEHAVIORAL_PROFILING: ['PROFILING_AND_GOAL_ASSESSMENT', 'FAILED'],
  PROFILING_AND_GOAL_ASSESSMENT: ['SOMA_FUND_UNIVERSE', 'REVISION', 'FAILED'],
  SOMA_FUND_UNIVERSE: ['VIKRAM_STRATEGY', 'FAILED'],
  VIKRAM_STRATEGY: ['KIRAN_HEDGE_MAP', 'FAILED'],
  KIRAN_HEDGE_MAP: ['ARIA_PREFLIGHT', 'FAILED'],
  ARIA_PREFLIGHT: ['PRIYA_BUILD', 'DEADLOCKED', 'FAILED'],
  PRIYA_BUILD: ['SEBI_COMPLIANCE', 'DELIBERATION', 'DEADLOCKED', 'FAILED'],
  SEBI_COMPLIANCE: ['DELIBERATION', 'REVISION', 'DEADLOCKED', 'FAILED'],
  DELIBERATION: ['COMMITTEE_VOTE', 'DEADLOCKED', 'FAILED'],
  COMMITTEE_VOTE: ['COMPLETED', 'ATLAS_COMPARISON', 'PDF_GENERATION', 'REVISION', 'DEADLOCKED', 'FAILED'],
  REVISION: ['PRIYA_BUILD', 'PROFILING_AND_GOAL_ASSESSMENT', 'COMMITTEE_VOTE', 'SEBI_COMPLIANCE', 'DEADLOCKED', 'FAILED'],
  ATLAS_COMPARISON: ['COMPLETED', 'PDF_GENERATION', 'FAILED'],
  PDF_GENERATION: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  DEADLOCKED: [],
  FAILED: [],
}

export interface TransitionContext {
  pipelineRunId: string
  userId?: string
  note?: string
}

export class PipelineStateMachine {
  private db: DbClient
  private currentStages: Map<string, PipelineStage> = new Map()

  constructor(db: DbClient) {
    this.db = db
  }

  getCurrentStage(pipelineRunId: string): PipelineStage {
    return this.currentStages.get(pipelineRunId) ?? 'INTAKE'
  }

  async transition(
    from: PipelineStage,
    to: PipelineStage,
    ctx: TransitionContext,
  ): Promise<void> {
    const { pipelineRunId, userId, note } = ctx
    let current: PipelineStage = 'INTAKE'

    try {
      const [run] = await this.db
        .select({ stage: schema.pipelineRuns.stage, status: schema.pipelineRuns.status })
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
        .limit(1)
      if (run?.stage) {
        current = PipelineStageSchema.parse(run.stage)
      } else {
        current = this.currentStages.get(pipelineRunId) ?? 'INTAKE'
      }
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'StateMachine: Failed to fetch current stage from DB, falling back to memory')
      current = this.currentStages.get(pipelineRunId) ?? 'INTAKE'
    }

    if (current !== from) {
      const errMsg = `Illegal transition attempt for run ${pipelineRunId}: expected current stage to be ${from}, but found ${current}`
      logger.error(errMsg)
      throw new Error(errMsg)
    }

    const allowed = LEGAL_TRANSITIONS[from] ?? []
    if (!allowed.includes(to)) {
      const errMsg = `Illegal stage transition: ${from} cannot transition directly to ${to}`
      logger.error({ from, to, pipelineRunId }, errMsg)
      throw new Error(errMsg)
    }

    this.currentStages.set(pipelineRunId, to)

    // Update database
    try {
      await this.db
        .update(schema.pipelineRuns)
        .set({ stage: to, status: to === 'COMPLETED' ? 'COMPLETED' : to === 'FAILED' ? 'FAILED' : 'RUNNING', updatedAt: new Date() })
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      logger.info({ pipelineRunId, from, to }, 'Pipeline run stage updated in database')
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'Failed to update pipeline run stage in DB')
      throw err
    }

    // Audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: userId,
      agent_id: 'SYSTEM',
      action_type: to === 'COMPLETED' ? AuditActionType.PIPELINE_END : AuditActionType.PIPELINE_STAGE_TRANSITION,
      oracle_confidence: undefined,
      payload: {
        transition: `${from} -> ${to}`,
        note,
        message: `Pipeline run transitioned from ${from} to ${to}`,
      },
    })
  }

  async checkConvergence(pipelineRunId: string): Promise<boolean> {
    try {
      const drafts = await this.db
        .select()
        .from(schema.portfolioDrafts)
        .where(eq(schema.portfolioDrafts.pipelineRunId, pipelineRunId))

      drafts.sort((a, b) => a.version - b.version)

      if (drafts.length < 2) return false

      const previous = drafts[drafts.length - 2]
      const current = drafts[drafts.length - 1]

      const prevConf = previous.confidenceScore ? Number.parseFloat(String(previous.confidenceScore)) : 0
      const currConf = current.confidenceScore ? Number.parseFloat(String(current.confidenceScore)) : 0

      if (currConf < prevConf) {
        auditTrail.log({
          pipeline_run_id: pipelineRunId,
          agent_id: 'SYSTEM',
          action_type: AuditActionType.CONFIDENCE_DIVERGING,
          payload: { type: 'CONFIDENCE_DIVERGING', cycle: current.version, delta: currConf - prevConf },
        })

        if (current.version >= 3) {
          logger.warn({ pipelineRunId }, 'Pipeline is thrashing — escalating to DHRUV for early deadlock consideration')
          return true
        }
      }
      return false
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'Failed to check convergence')
      return false
    }
  }

  async forceSetStage(
    pipelineRunId: string,
    stage: PipelineStage,
    ctx: TransitionContext,
    callerMustBe: 'DHRUV' = 'DHRUV',
  ): Promise<void> {
    await this.db
      .update(schema.pipelineRuns)
      .set({ stage, status: stage === 'COMPLETED' ? 'COMPLETED' : stage === 'FAILED' ? 'FAILED' : 'RUNNING', updatedAt: new Date() })
      .where(eq(schema.pipelineRuns.runId, pipelineRunId))

    this.currentStages.set(pipelineRunId, stage)

    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      user_id: ctx.userId,
      agent_id: 'SYSTEM',
      action_type: AuditActionType.FORCE_STAGE_SET,
      payload: {
        stage,
        caller: callerMustBe,
        note: ctx.note,
        warning: 'Transition validation bypassed — use only in deadlock recovery',
      },
    })
  }
}
