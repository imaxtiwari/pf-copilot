import type { Pool } from 'pg'

/**
 * Delete the rows created by a single pipeline test run.
 * Temporarily disables the audit-log immutability triggers so the test DB stays clean.
 */
export async function cleanupRun(pool: Pool, runId: string, userId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE pipeline_audit_logs DISABLE TRIGGER prevent_delete_audit_logs')
    await client.query('ALTER TABLE pipeline_audit_logs DISABLE TRIGGER prevent_update_audit_logs')
    await client.query('DELETE FROM deliberation_messages WHERE pipeline_run_id = $1', [runId])
    await client.query('DELETE FROM pipeline_audit_logs WHERE pipeline_run_id = $1', [runId])
    await client.query('DELETE FROM pipeline_runs WHERE run_id = $1', [runId])
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('ALTER TABLE pipeline_audit_logs ENABLE TRIGGER prevent_delete_audit_logs')
    await client.query('ALTER TABLE pipeline_audit_logs ENABLE TRIGGER prevent_update_audit_logs')
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Brute-force truncate tables used by pipeline tests. The audit-log immutability
 * trigger is disabled locally so tests can clean up after themselves.
 * Prefer cleanupRun() when running tests concurrently to avoid cross-test interference.
 */
export async function truncateTestTables(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('ALTER TABLE pipeline_audit_logs DISABLE TRIGGER prevent_delete_audit_logs')
    await client.query('ALTER TABLE pipeline_audit_logs DISABLE TRIGGER prevent_update_audit_logs')
    await client.query('TRUNCATE TABLE deliberation_messages, pipeline_audit_logs, scheduler_runs, scheduler_locks, pipeline_runs, users RESTART IDENTITY CASCADE')
    await client.query('ALTER TABLE pipeline_audit_logs ENABLE TRIGGER prevent_delete_audit_logs')
    await client.query('ALTER TABLE pipeline_audit_logs ENABLE TRIGGER prevent_update_audit_logs')
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
