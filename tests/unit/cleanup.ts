import type { Pool } from 'pg'

/**
 * Brute-force truncate tables used by pipeline tests. The audit-log immutability
 * trigger is disabled locally so tests can clean up after themselves.
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
