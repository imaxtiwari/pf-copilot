import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { ok, err } from '@/lib/contracts/error-envelope'
import { db } from '@/lib/db'
import { getGpt4oMini, getEmbedding } from '@/lib/azure-openai'

export async function GET() {
  const checks = {
    db: false,
    azure_chat: false,
    azure_embedding: false,
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

  if (checks.db && checks.azure_chat && checks.azure_embedding) {
    return NextResponse.json(ok(checks))
  }

  return NextResponse.json(
    err('health_check_failed', 'One or more health checks failed', { checks, errors }),
    { status: 503 },
  )
}
