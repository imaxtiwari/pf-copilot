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
  const memUsage = process.memoryUsage()
  const memory = {
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    rssMB: Math.round(memUsage.rss / 1024 / 1024),
    status: (memUsage.heapUsed / memUsage.heapTotal > 0.85) ? 'warning' : 'ok'
  }

  if (memory.status === 'warning') {
    console.warn(`[HEALTH] High memory usage detected: ${memory.heapUsedMB}MB used of ${memory.heapTotalMB}MB total (${Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)}%)`)
  }

  const checks = {
    db: { status: 'pending', message: '' },
    qdrant: { status: 'pending', collections: 0, message: '' },
    azure_chat: false,
    azure_embedding: false,
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
    checks.db = { status: 'ok', message: '' }
  } catch (e: any) {
    checks.db = { status: 'error', message: e.message }
    errors.push(`db: ${e.message}`)
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
  } catch (e: any) {
    errors.push(`azure_chat: ${e.message}`)
  }

  try {
    const vector = await getEmbedding('test')
    if (vector.length === 1536) checks.azure_embedding = true
  } catch (e: any) {
    errors.push(`azure_embedding: ${e.message}`)
  }

  try {
    const r = await qdrant.getCollections()
    checks.qdrant = { status: 'ok', collections: r.collections.length, message: '' }
  } catch (e: any) {
    checks.qdrant = { status: 'error', collections: 0, message: e.message }
    errors.push(`qdrant: ${e.message}`)
  }

  try {
    auditTrail.query({ pipeline_run_id: 'HEALTH_CHECK' })
    checks.audit_trail_accessible = true
  } catch (e: any) {
    errors.push(`audit_trail: ${e.message}`)
  }

  try {
    checks.scheduler_running = globalThis.__schedulerStarted === true
  } catch (e: any) {
    errors.push(`scheduler: ${e.message}`)
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
  } catch (e: any) {
    errors.push(`macro_bulletin_age: ${e.message}`)
  }

  const allPassed =
    checks.db.status === 'ok' &&
    checks.azure_chat &&
    checks.azure_embedding &&
    checks.qdrant.status === 'ok' &&
    checks.audit_trail_accessible

  if (allPassed) {
    return NextResponse.json(ok({ checks, memory }))
  }

  return NextResponse.json(
    err('health_check_failed', 'One or more health checks failed', { checks, memory, errors }),
    { status: 503 },
  )
}
