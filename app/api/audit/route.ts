import { NextRequest, NextResponse } from 'next/server'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { auditTrail } from '@/lib/audit/audit-trail'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import logger from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    await resolveOrCreateUserId()

    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view')
    const pipeline_run_id = searchParams.get('pipelineRunId') || searchParams.get('pipeline_run_id') || undefined

    if (view === 'threaded') {
      if (!pipeline_run_id) {
        return NextResponse.json(
          { error: 'pipelineRunId or pipeline_run_id is required for threaded view', code: 'BAD_REQUEST' },
          { status: 400 }
        )
      }

      const messages = await deliberationRoom.getHistory(pipeline_run_id)

      // Reconstruct tree
      const nodeMap = new Map<string, any>()
      for (const msg of messages) {
        nodeMap.set(msg.message_id, {
          ...msg,
          replies: []
        })
      }

      const roots: any[] = []
      for (const node of nodeMap.values()) {
        const parentId = node.reply_to_message_id
        if (parentId && nodeMap.has(parentId)) {
          nodeMap.get(parentId).replies.push(node)
        } else {
          roots.push(node)
        }
      }

      const sortReplies = (node: any) => {
        node.replies.sort((a: any, b: any) => {
          if ((a.depth ?? 0) !== (b.depth ?? 0)) {
            return (a.depth ?? 0) - (b.depth ?? 0)
          }
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        })
        node.replies.forEach(sortReplies)
      }
      roots.forEach(sortReplies)

      // Sort roots by timestamp
      roots.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      return NextResponse.json({
        tree: roots,
        total: messages.length
      })
    }

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
