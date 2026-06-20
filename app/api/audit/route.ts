import { NextRequest, NextResponse } from 'next/server'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { auditTrail } from '@/lib/audit/audit-trail'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import logger from '@/lib/logger'
import { db } from '@/lib/db'
import { deliberationMessages } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    await resolveOrCreateUserId()

    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view')
    const pipeline_run_id = searchParams.get('pipelineRunId') || searchParams.get('pipeline_run_id') || undefined
    const check = searchParams.get('check')

    if (check === 'threading') {
      if (!pipeline_run_id) {
        return NextResponse.json(
          { error: 'pipelineRunId is required for threading check', code: 'BAD_REQUEST' },
          { status: 400 }
        )
      }
      
      const messages = await db.select().from(deliberationMessages).where(eq(deliberationMessages.pipelineRunId, pipeline_run_id))
      const totalMessages = messages.length
      const linkedMessages = messages.filter(m => m.replyToMessageId !== null).length
      const messageIds = new Set(messages.map(m => m.messageId))
      const orphanedMessages = messages.filter(m => m.replyToMessageId !== null && !messageIds.has(m.replyToMessageId)).length
      const threadingIntegrityScore = totalMessages > 0 ? (linkedMessages / totalMessages) * 100 : 100

      return NextResponse.json({
        totalMessages,
        linkedMessages,
        orphanedMessages,
        threadingIntegrityScore
      })
    }

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

    const rawLogs = auditTrail.query(filters)
    const logs = rawLogs.map((log: any) => {
      if (log.action_type === 'ORACLE_CROSS_RUN_ANOMALY') {
        try {
          const payload = JSON.parse(log.payload_json)
          return {
            ...log,
            visualMessage: formatCrossRunAnomalyMessage(payload)
          }
        } catch (e) {
          // ignore
        }
      }
      return log
    })

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

function formatCrossRunAnomalyMessage(payload: any): string {
  const agentId = payload.agentId || 'SOMA'
  const field = payload.field || ''
  const schemeName = payload.schemeName || 'Axis Bluechip'
  const currentVal = payload.currentValue
  const prevVal = payload.previousValue
  const delta = payload.delta
  const actionTaken = payload.actionTaken || 'rejected'

  let fieldDisplayName = field
  let currentValStr = String(currentVal)
  let prevValStr = String(prevVal)
  let deltaStr = String(delta)

  if (field.includes('return')) {
    fieldDisplayName = field.replace('fund_', '').replace('_return', ' return')
    currentValStr = `${currentVal}%`
    prevValStr = `${prevVal}%`
    deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`
  } else if (field === 'expense_ratio') {
    fieldDisplayName = 'expense ratio'
    currentValStr = `${currentVal}%`
    prevValStr = `${prevVal}%`
    deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}pp`
  } else if (field === 'aum') {
    fieldDisplayName = 'AUM'
    currentValStr = `${currentVal} Cr`
    prevValStr = `${prevVal} Cr`
    const pct = delta * 100
    deltaStr = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
  } else if (field.includes('ratio')) {
    fieldDisplayName = field.replace('_ratio', ' ratio')
    currentValStr = String(currentVal)
    prevValStr = String(prevVal)
    deltaStr = `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`
  }

  const actionText = actionTaken === 'rejected' ? 'Source re-fetch forced.' : 'Flagged for review.'

  return `⚠️ Cross-run anomaly: ${agentId} reported ${fieldDisplayName} of ${currentValStr} for ${schemeName}. Previous run reported ${prevValStr}. Delta: ${deltaStr}. ${actionText}`
}
