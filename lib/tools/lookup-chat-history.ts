import { eq, desc } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'

export type ChatHistoryResult = {
  turns: Array<{
    role: 'user' | 'assistant'
    content: string
    ts: string
  }>
  count: number
}

/** Returns the last 10 user/assistant message pairs (20 rows) in chronological order. */
export async function lookupChatHistory(userId: string): Promise<ChatHistoryResult> {
  const rows = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      ts: schema.chatMessages.ts,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.ts))
    .limit(20)

  // Filter to user/assistant only, reverse to chronological
  const turns = rows
    .filter((r): r is typeof r & { role: 'user' | 'assistant' } =>
      r.role === 'user' || r.role === 'assistant',
    )
    .reverse()
    .map((r) => ({
      role: r.role,
      content: r.content,
      ts: r.ts.toISOString(),
    }))

  return { turns, count: turns.length }
}
