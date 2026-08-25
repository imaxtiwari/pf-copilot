// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import * as schema from '@/db/schema'
import { createTestPool, createTestDb, type TestDb } from './test-db'
import { PipelineStateMachine, LEGAL_TRANSITIONS } from '@/lib/pipeline/pipeline-state-machine'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'

describe.sequential('PipelineStateMachine', () => {
  let pool: Pool
  let db: TestDb
  let userId: string
  let runId: string
  let sm: PipelineStateMachine

  beforeAll(async () => {
    pool = createTestPool()
    db = createTestDb(pool)
    sm = new PipelineStateMachine(db)

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id })
    userId = user.id

    const [run] = await db
      .insert(schema.pipelineRuns)
      .values({ clientId: userId, status: 'PENDING', stage: 'INTAKE' })
      .returning({ runId: schema.pipelineRuns.runId })
    runId = run.runId
  })

  afterAll(async () => {
    // cleanup intentionally skipped — local test DB accumulates rows but UUIDs keep assertions stable
    await pool.end()
  })

  it('has expected educational-simulation stages', () => {
    expect(LEGAL_TRANSITIONS.INTAKE).toContain('RIYA_BEHAVIORAL_PROFILING')
    expect(LEGAL_TRANSITIONS.COMMITTEE_VOTE).toContain('COMPLETED')
    expect(LEGAL_TRANSITIONS.COMPLETED).toEqual([])
  })

  it('transitions through legal stages', async () => {
    await sm.transition('INTAKE', 'RIYA_BEHAVIORAL_PROFILING', { pipelineRunId: runId, userId })
    await sm.transition('RIYA_BEHAVIORAL_PROFILING', 'PROFILING_AND_GOAL_ASSESSMENT', { pipelineRunId: runId, userId })

    const [run] = await db.select({ stage: schema.pipelineRuns.stage }).from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId))
    expect(run?.stage).toBe('PROFILING_AND_GOAL_ASSESSMENT')
  })

  it('rejects illegal transitions', async () => {
    const [freshRun] = await db
      .insert(schema.pipelineRuns)
      .values({ clientId: userId, status: 'PENDING', stage: 'INTAKE' })
      .returning({ runId: schema.pipelineRuns.runId })

    await expect(
      sm.transition('INTAKE', 'COMPLETED', { pipelineRunId: freshRun.runId, userId }),
    ).rejects.toThrow('Illegal stage transition')

    // cleanup intentionally skipped — local test DB accumulates rows but UUIDs keep assertions stable
  })

  it('rejects transitions from wrong current stage', async () => {
    await expect(
      sm.transition('INTAKE', 'SOMA_FUND_UNIVERSE', { pipelineRunId: runId, userId }),
    ).rejects.toThrow('Illegal transition attempt')
  })

  it('forceSetStage bypasses validation', async () => {
    await sm.forceSetStage(runId, 'FAILED', { pipelineRunId: runId, userId })
    const [run] = await db.select({ stage: schema.pipelineRuns.stage }).from(schema.pipelineRuns).where(eq(schema.pipelineRuns.runId, runId))
    expect(run?.stage).toBe('FAILED')
  })
})
