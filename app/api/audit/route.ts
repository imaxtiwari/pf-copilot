import { NextRequest, NextResponse } from 'next/server'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { auditTrail } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    await resolveOrCreateUserId()

    const { searchParams } = new URL(req.url)
    const pipeline_run_id = searchParams.get('pipeline_run_id') || undefined
    const agent_id = searchParams.get('agent_id') || undefined
    const action_type = searchParams.get('action_type') || undefined
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined

    const filters = {
      pipeline_run_id,
      agent_id: agent_id as any,
      action_type: action_type as any,
      from_timestamp: from,
      to_timestamp: to
    }

    const logs = auditTrail.query(filters)

    return NextResponse.json({
      logs,
      total: logs.length
    })
  } catch (err) {
    logger.error({ err }, 'API-AUDIT: Failed to retrieve audit logs')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
