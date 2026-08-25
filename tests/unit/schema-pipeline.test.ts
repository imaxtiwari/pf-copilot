// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'

const getDbUrl = () =>
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pfcopilot'

const USER_SCOPED_TABLES = [
  'pipeline_runs',
  'pipeline_results',
  'portfolio_drafts',
  'deliberation_messages',
  'committee_votes',
  'comparison_reports',
  'compliance_reports',
  'behavioral_fingerprints',
  'pipeline_audit_logs',
  'drift_reports',
  'sip_adherence_reports',
]

const GLOBAL_READ_TABLES = [
  'agent_funds',
  'fund_snapshots',
  'fund_compositions',
  'knowledge_commons',
  'scheduler_locks',
  'scheduler_runs',
]

describe('pipeline schema security', () => {
  let pool: Pool

  beforeAll(() => {
    pool = new Pool({ connectionString: getDbUrl() })
  })

  afterAll(async () => {
    await pool.end()
  })

  it('has RLS enabled on all user-scoped pipeline tables', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, rowsecurity
       FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [USER_SCOPED_TABLES],
    )
    const enabled = new Set(rows.filter((r) => r.rowsecurity).map((r) => r.tablename))
    expect(enabled.size).toBe(USER_SCOPED_TABLES.length)
    for (const table of USER_SCOPED_TABLES) {
      expect(enabled.has(table), `RLS missing on ${table}`).toBe(true)
    }
  })

  it('has RLS enabled on global/reference tables', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, rowsecurity
       FROM pg_tables
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [GLOBAL_READ_TABLES],
    )
    const enabled = new Set(rows.filter((r) => r.rowsecurity).map((r) => r.tablename))
    expect(enabled.size).toBe(GLOBAL_READ_TABLES.length)
  })

  it('has at least one policy on every user-scoped table', async () => {
    const { rows } = await pool.query(
      `SELECT tablename, count(*)::int as cnt
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       GROUP BY tablename`,
      [USER_SCOPED_TABLES],
    )
    const counts = Object.fromEntries(rows.map((r) => [r.tablename, r.cnt]))
    for (const table of USER_SCOPED_TABLES) {
      expect(counts[table] ?? 0, `No policies on ${table}`).toBeGreaterThan(0)
    }
  })

  it('prevents updates and deletes on pipeline_audit_logs via triggers', async () => {
    const { rows } = await pool.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'pipeline_audit_logs'::regclass
       AND NOT tgisinternal`,
    )
    const names = rows.map((r) => r.tgname)
    expect(names).toContain('prevent_update_audit_logs')
    expect(names).toContain('prevent_delete_audit_logs')
  })

  it('audit triggers reject mutation at runtime', async () => {
    // Insert a dummy user and audit log, then try to mutate it.
    const userId = await pool.query(
      `INSERT INTO users (id, created_at) VALUES (gen_random_uuid(), now()) RETURNING id`,
    ).then((r) => r.rows[0].id)

    const runId = await pool.query(
      `INSERT INTO pipeline_runs (client_id, status, stage) VALUES ($1, 'PENDING', 'INTAKE') RETURNING run_id`,
      [userId],
    ).then((r) => r.rows[0].run_id)

    const logId = await pool.query(
      `INSERT INTO pipeline_audit_logs (
        pipeline_run_id, user_id, agent_id, action_type, payload_hash, payload_json
      ) VALUES ($1, $2, 'TEST', 'PIPELINE_START', 'hash', '{}') RETURNING log_id`,
      [runId, userId],
    ).then((r) => r.rows[0].log_id)

    await expect(
      pool.query(`UPDATE pipeline_audit_logs SET payload_json = '{"tampered":true}' WHERE log_id = $1`, [logId]),
    ).rejects.toThrow('AUDIT TRAIL IS IMMUTABLE')

    await expect(
      pool.query(`DELETE FROM pipeline_audit_logs WHERE log_id = $1`, [logId]),
    ).rejects.toThrow('AUDIT TRAIL IS IMMUTABLE')
  })
})
