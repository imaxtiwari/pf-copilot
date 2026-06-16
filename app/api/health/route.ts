import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import * as fs from 'fs'
import * as path from 'path'
import { ok, err } from '@/lib/contracts/error-envelope'
import { db } from '@/lib/db'
import { getGpt4oMini, getEmbedding } from '@/lib/azure-openai'
import { qdrant } from '@/lib/memory/memory-store'
import { auditTrail } from '@/lib/audit/audit-trail'

export async function GET() {
  const checks = {
    db: false,
    azure_chat: false,
    azure_embedding: false,
    qdrant_connected: false,
    audit_trail_accessible: false,
    scheduler_running: false,
    latest_macro_bulletin_age_days: null as number | null,
    region: 'unknown',
  }
  const errors: string[] = []

  try {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT
    if (endpoint) checks.region = new URL(endpoint).hostname
  } catch {}

  try {
    await db.execute(sql`SELECT 1`)
    checks.db = true
  } catch (e) {
    errors.push(`db: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI ?? 'gpt-4o-mini'
    const client = getGpt4oMini()
    const response = await client.chat.completions.create({
      model: deployment,
      messages: [{ role: 'user', content: 'respond with OK' }],
      max_tokens: 10,
    })
    if (response.choices[0]?.message?.content) checks.azure_chat = true
  } catch (e) {
    errors.push(`azure_chat: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const vector = await getEmbedding('test')
    if (vector.length === 1536) checks.azure_embedding = true
  } catch (e) {
    errors.push(`azure_embedding: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    await qdrant.getCollections()
    checks.qdrant_connected = true
  } catch (e) {
    errors.push(`qdrant: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    auditTrail.query({ pipeline_run_id: 'HEALTH_CHECK' })
    checks.audit_trail_accessible = true
  } catch (e) {
    errors.push(`audit_trail: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    checks.scheduler_running = globalThis.__schedulerStarted === true
  } catch (e) {
    errors.push(`scheduler: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const filePath = path.join(process.cwd(), 'data', 'macro-bulletin.json')
    if (fs.existsSync(filePath)) {
      const bulletin = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (bulletin.generated_at) {
        const ageMs = Date.now() - new Date(bulletin.generated_at).getTime()
        checks.latest_macro_bulletin_age_days = ageMs / (1000 * 60 * 60 * 24)
      }
    }
  } catch (e) {
    errors.push(`macro_bulletin_age: ${e instanceof Error ? e.message : String(e)}`)
  }

  const allPassed =
    checks.db &&
    checks.azure_chat &&
    checks.azure_embedding &&
    checks.qdrant_connected &&
    checks.audit_trail_accessible

  if (allPassed) {
    return NextResponse.json(ok(checks))
  }

  return NextResponse.json(
    err('health_check_failed', 'One or more health checks failed', { checks, errors }),
    { status: 503 },
  )
}
