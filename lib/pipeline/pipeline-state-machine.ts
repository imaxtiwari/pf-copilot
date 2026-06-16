import { eq } from 'drizzle-orm'
import { PipelineStage } from '../agents/types/dhruv-types'
import * as schema from '../../db/schema'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import logger from '../logger'

const LEGAL_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  ONBOARDING: ['KIRAN_RISK_PROFILE', 'FAILED'],
  KIRAN_RISK_PROFILE: ['VIKRAM_INTERVIEW', 'FAILED'],
  VIKRAM_INTERVIEW: ['VIKRAM_GOAL_ASSESSMENT', 'FAILED'],
  VIKRAM_GOAL_ASSESSMENT: ['SOMA_FUND_UNIVERSE', 'REVISION', 'FAILED'],
  SOMA_FUND_UNIVERSE: ['VIKRAM_STRATEGY', 'FAILED'],
  VIKRAM_STRATEGY: ['KIRAN_HEDGE_MAP', 'FAILED'],
  KIRAN_HEDGE_MAP: ['PRIYA_BUILD', 'FAILED'],
  PRIYA_BUILD: ['DELIBERATION', 'FAILED'],
  DELIBERATION: ['COMMITTEE_VOTE', 'FAILED'],
  COMMITTEE_VOTE: ['APPROVED', 'REVISION', 'DEADLOCKED', 'FAILED'],
  REVISION: ['PRIYA_BUILD', 'VIKRAM_GOAL_ASSESSMENT', 'FAILED'],
  APPROVED: [],
  DEADLOCKED: [],
  FAILED: [],
}

export class PipelineStateMachine {
  private db: any
  private currentStages: Map<string, PipelineStage> = new Map()

  constructor(db: any) {
    this.db = db
  }

  getCurrentStage(pipelineRunId: string): PipelineStage {
    return this.currentStages.get(pipelineRunId) || 'ONBOARDING'
  }

  async transition(
    from: PipelineStage,
    to: PipelineStage,
    pipelineRunId: string
  ): Promise<void> {
    let current: PipelineStage = 'ONBOARDING'
    try {
      const [run] = await this.db
        .select()
        .from(schema.pipelineRuns)
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
        .limit(1)
      if (run && run.status) {
        current = run.status as PipelineStage
      } else {
        current = this.currentStages.get(pipelineRunId) || 'ONBOARDING'
      }
    } catch (err) {
      logger.warn({ err, pipelineRunId }, 'StateMachine: Failed to fetch current stage from DB, falling back to memory')
      current = this.currentStages.get(pipelineRunId) || 'ONBOARDING'
    }

    if (current !== from) {
      const errMsg = `Illegal transition attempt for run ${pipelineRunId}: expected current stage to be ${from}, but found ${current}`
      logger.error(errMsg)
      throw new Error(errMsg)
    }

    const allowed = LEGAL_TRANSITIONS[from] || []
    if (!allowed.includes(to)) {
      const errMsg = `Illegal stage transition: ${from} cannot transition directly to ${to}`
      logger.error({ from, to, pipelineRunId }, errMsg)
      throw new Error(errMsg)
    }

    this.currentStages.set(pipelineRunId, to)

    // Update in database
    try {
      await this.db
        .update(schema.pipelineRuns)
        .set({ status: to })
        .where(eq(schema.pipelineRuns.runId, pipelineRunId))
      logger.info({ pipelineRunId, from, to }, 'Pipeline runs status updated in database')
    } catch (err) {
      logger.error({ err, pipelineRunId }, 'Failed to update pipeline run stage in DB')
    }

    // Log to audit trail
    auditTrail.log({
      pipeline_run_id: pipelineRunId,
      agent_id: 'SYSTEM',
      action_type: to === 'APPROVED' ? AuditActionType.PIPELINE_END : AuditActionType.PIPELINE_START,
      payload: {
        transition: `${from} -> ${to}`,
        message: `Pipeline run transitioned from ${from} to ${to}`
      }
    })
  }
}
