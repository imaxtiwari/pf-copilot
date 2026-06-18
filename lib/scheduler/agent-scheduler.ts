import cron from 'node-cron'
import { randomUUID } from 'crypto'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import logger from '../logger'
import { Dhruv } from '../agents/dhruv'
import { Kiran } from '../agents/kiran'
import { Soma } from '../agents/soma'
import { Aria } from '../agents/aria'
import { Vikram } from '../agents/vikram'
import { Priya } from '../agents/priya'
import { acquireLock, releaseLock, logRun } from './mutex'

export type AllAgents = {
  dhruv: Dhruv
  kiran: Kiran
  soma: Soma
  aria: Aria
  vikram: Vikram
  priya: Priya
}

export interface JobState {
  name: string
  cron: string
  last_run_at: string | null
  next_run_at: string | null
  last_status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PENDING'
}

export const jobStates = new Map<string, JobState>()

function getNextRunDate(cronExpr: string): Date {
  const now = new Date()
  const result = new Date(now)
  result.setSeconds(0)
  result.setMilliseconds(0)

  if (cronExpr === '0 7 * * *') {
    // Daily at 7:00 AM
    result.setHours(7, 0)
    if (result.getTime() <= now.getTime()) {
      result.setDate(result.getDate() + 1)
    }
  } else if (cronExpr === '0 6 * * 0') {
    // Sunday 6:00 AM
    result.setHours(6, 0)
    const day = result.getDay()
    const diff = (7 - day) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  } else if (cronExpr === '0 8 * * 1') {
    // Monday 8:00 AM
    result.setHours(8, 0)
    const day = result.getDay()
    const diff = (1 - day + 7) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  } else if (cronExpr === '0 8 * * 2') {
    // Tuesday 8:00 AM
    result.setHours(8, 0)
    const day = result.getDay()
    const diff = (2 - day + 7) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  } else if (cronExpr === '0 8 * * 3') {
    // Wednesday 8:00 AM
    result.setHours(8, 0)
    const day = result.getDay()
    const diff = (3 - day + 7) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  } else if (cronExpr === '0 8 * * 4') {
    // Thursday 8:00 AM
    result.setHours(8, 0)
    const day = result.getDay()
    const diff = (4 - day + 7) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  } else if (cronExpr === '0 10 * * 5') {
    // Friday 10:00 AM
    result.setHours(10, 0)
    const day = result.getDay()
    const diff = (5 - day + 7) % 7
    result.setDate(result.getDate() + (diff === 0 && result.getTime() <= now.getTime() ? 7 : diff))
  }
  return result
}

const jobsConfig = [
  { name: 'Kiran Daily Macro Scan', cron: '0 7 * * *', agentId: 'KIRAN' },
  { name: 'Soma Weekly Sweep', cron: '0 6 * * 0', agentId: 'SOMA' },
  { name: 'Aria Weekly Research', cron: '0 8 * * 1', agentId: 'ARIA' },
  { name: 'Vikram Weekly Research', cron: '0 8 * * 2', agentId: 'VIKRAM' },
  { name: 'Priya Weekly Research', cron: '0 8 * * 3', agentId: 'PRIYA' },
  { name: 'Dhruv Governance Research', cron: '0 8 * * 4', agentId: 'DHRUV' },
  { name: 'Dhruv Knowledge Consolidation', cron: '0 10 * * 5', agentId: 'DHRUV' }
]

// Initialize job states
jobsConfig.forEach(cfg => {
  jobStates.set(cfg.name, {
    name: cfg.name,
    cron: cfg.cron,
    last_run_at: null,
    next_run_at: getNextRunDate(cfg.cron).toISOString(),
    last_status: 'PENDING'
  })
})

async function runJob(name: string, cronExpr: string, agentId: string, fn: () => Promise<void>) {
  if (!(await acquireLock(name))) return;

  const state = jobStates.get(name)
  if (state) {
    state.last_status = 'RUNNING'
    state.last_run_at = new Date().toISOString()
  }

  const jobRunId = randomUUID()
  logger.info({ name, jobRunId }, `AGENT-SCHEDULER: Job ${name} started`)

  // Log to audit trail on start
  auditTrail.log({
    pipeline_run_id: jobRunId,
    agent_id: agentId as any,
    action_type: AuditActionType.AGENT_WEEKLY_RESEARCH_COMPLETE,
    payload: {
      message: `Job ${name} started via scheduler`,
      cron: cronExpr
    }
  })

  const start = Date.now()
  try {
    await fn()
    await logRun(name, 'success', Date.now() - start)
    if (state) {
      state.last_status = 'SUCCESS'
      state.next_run_at = getNextRunDate(cronExpr).toISOString()
    }
    logger.info({ name, jobRunId }, `AGENT-SCHEDULER: Job ${name} completed successfully`)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await logRun(name, 'failed', Date.now() - start, errorMsg)
    if (state) {
      state.last_status = 'FAILED'
      state.next_run_at = getNextRunDate(cronExpr).toISOString()
    }
    logger.error({ err, name, jobRunId }, `AGENT-SCHEDULER: Job ${name} failed`)
  } finally {
    await releaseLock(name)
  }
}

export function startAgentScheduler(agents: AllAgents): void {
  logger.info('AGENT-SCHEDULER: Registering scheduled cron jobs')

  // 1. Kiran Daily Macro Scan
  cron.schedule('0 7 * * *', async () => {
    await runJob('Kiran Daily Macro Scan', '0 7 * * *', 'KIRAN', async () => {
      await agents.kiran.runDailyMacroScan(undefined)
    })
  })

  // 2. Soma Weekly Sweep
  cron.schedule('0 6 * * 0', async () => {
    await runJob('Soma Weekly Sweep', '0 6 * * 0', 'SOMA', async () => {
      await agents.soma.runWeeklySweep()
    })
  })

  // 3. Aria Weekly Research
  cron.schedule('0 8 * * 1', async () => {
    await runJob('Aria Weekly Research', '0 8 * * 1', 'ARIA', async () => {
      await agents.aria.runWeeklyResearch()
    })
  })

  // 4. Vikram Weekly Research
  cron.schedule('0 8 * * 2', async () => {
    await runJob('Vikram Weekly Research', '0 8 * * 2', 'VIKRAM', async () => {
      await agents.vikram.runWeeklyResearch()
    })
  })

  // 5. Priya Weekly Research
  cron.schedule('0 8 * * 3', async () => {
    await runJob('Priya Weekly Research', '0 8 * * 3', 'PRIYA', async () => {
      await agents.priya.runWeeklyResearch()
    })
  })

  // 6. Dhruv Governance Research
  cron.schedule('0 8 * * 4', async () => {
    await runJob('Dhruv Governance Research', '0 8 * * 4', 'DHRUV', async () => {
      await agents.dhruv.runWeeklyResearch()
    })
  })

  // 7. Dhruv Knowledge Consolidation
  cron.schedule('0 10 * * 5', async () => {
    await runJob('Dhruv Knowledge Consolidation', '0 10 * * 5', 'DHRUV', async () => {
      await agents.dhruv.runWeeklyKnowledgeConsolidation()
    })
  })
}

export function getSchedulerJobs(): JobState[] {
  return Array.from(jobStates.values())
}
