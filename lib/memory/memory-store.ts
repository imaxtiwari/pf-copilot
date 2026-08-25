import { getEmbedding } from '@/lib/azure-openai'
import { auditTrail, AuditActionType, AgentId } from '@/lib/audit/audit-trail'
import { MEMORY_TTL_DAYS, MemoryType } from './ttl-config'
import { randomUUID } from 'crypto'
import logger from '@/lib/logger'
import { extractSemanticSummary } from './semantic-summary'

// ─── In-Memory Mock Qdrant Client ─────────────────────────────────────────────

class MockQdrantClient {
  private collections = new Map<string, Array<{ id: string | number; vector: number[]; payload: any }>>()

  async getCollections() {
    return {
      collections: Array.from(this.collections.keys()).map((name) => ({ name })),
    }
  }

  async createCollection(name: string, _config?: Record<string, unknown>) {
    if (!this.collections.has(name)) {
      this.collections.set(name, [])
    }
  }

  async upsert(name: string, data: { points: Array<{ id: string | number; vector: number[]; payload: any }> }) {
    if (!this.collections.has(name)) {
      this.collections.set(name, [])
    }
    const list = this.collections.get(name)!
    for (const point of data.points) {
      const idx = list.findIndex((p) => p.id === point.id)
      if (idx >= 0) {
        list[idx] = point
      } else {
        list.push(point)
      }
    }
  }

  async search(name: string, data: { limit: number; vector?: number[]; filter?: unknown; with_payload?: boolean }) {
    const list = this.collections.get(name) || []
    // Simple mock: return most recent entries regardless of vector similarity.
    return list.slice(0, data.limit).map((p) => ({
      id: p.id,
      score: 1.0,
      payload: {
        ...p.payload,
        source_url: p.payload?.source_url || '',
      },
    }))
  }

  async setPayload(name: string, data: { points: Array<string | number>; payload: any }) {
    const list = this.collections.get(name) || []
    for (const id of data.points) {
      const point = list.find((p) => p.id === id)
      if (point) {
        point.payload = { ...point.payload, ...data.payload }
      }
    }
  }

  async scroll(name: string, data: { limit: number; offset?: any; filter?: unknown; with_payload?: boolean }) {
    const list = this.collections.get(name) || []
    const startIdx = typeof data.offset === 'number' ? data.offset : 0
    const endIdx = startIdx + data.limit
    const sliced = list.slice(startIdx, endIdx)
    return {
      points: sliced.map((p) => ({
        id: p.id,
        payload: p.payload,
      })),
      next_page_offset: endIdx < list.length ? endIdx : null,
    }
  }
}

type QdrantClientLike = InstanceType<typeof MockQdrantClient>

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

async function makeQdrantClient(): Promise<QdrantClientLike> {
  if (isProduction() && process.env.MOCK_LLM === 'true') {
    throw new Error(
      'Mock Qdrant client selection attempted in production. ' +
        'QDRANT_URL must be configured and MOCK_LLM must not be true in production.',
    )
  }

  // In test or mock mode, use the in-memory client so the pipeline does not depend on a live Qdrant server.
  if (process.env.MOCK_LLM === 'true' || process.env.VITEST === 'true' || !process.env.QDRANT_URL) {
    if (process.env.QDRANT_URL) {
      logger.info('AgentMemoryStore: QDRANT_URL set but mock mode active; using in-memory Qdrant client')
    }
    return new MockQdrantClient()
  }

  if (isProduction() && !process.env.QDRANT_URL) {
    throw new Error('QDRANT_URL is not configured in production. Set QDRANT_URL to a real Qdrant endpoint.')
  }

  // Dynamic import keeps the optional dependency out of the build unless Qdrant is actually configured.
  try {
    const { QdrantClient } = await import('@qdrant/js-client-rest')
    return new QdrantClient({ url: process.env.QDRANT_URL }) as unknown as QdrantClientLike
  } catch (err) {
    logger.warn({ err }, 'AgentMemoryStore: @qdrant/js-client-rest not installed; falling back to in-memory client')
    return new MockQdrantClient()
  }
}

/**
 * Lazy Qdrant client proxy.
 *
 * The client is only constructed on first use. This avoids failing Next.js
 * builds (which run with NODE_ENV=production but no real QDRANT_URL) while
 * still enforcing production guards at runtime.
 */
function createLazyQdrantClient(): QdrantClientLike {
  let client: QdrantClientLike | undefined
  return new Proxy({} as QdrantClientLike, {
    get(_target, prop) {
      if (!client) {
        void makeQdrantClient().then((c) => {
          client = c
        })
        // Synchronous proxy return is not usable until the promise resolves;
        // callers must `await` method calls, which works because the proxy returns
        // a function that awaits the real client.
      }
      return async (...args: unknown[]) => {
        if (!client) {
          client = await makeQdrantClient()
        }
        const value = (client as unknown as Record<string | symbol, unknown>)[prop]
        if (typeof value === 'function') {
          return (value as (...a: unknown[]) => unknown).apply(client, args)
        }
        return value
      }
    },
  })
}

export const qdrant = createLazyQdrantClient()

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceTier = 'VERIFIED' | 'INFERRED' | 'ASSUMED'
export type MemoryStatus = 'ACTIVE' | 'STALE' | 'ARCHIVED'

export interface MemoryEntry {
  payload: any
  _key?: string
  _summary: string
  _storedAt: string
  _agentId: string
  memory_type: MemoryType
  source_url: string
  retrieved_at: string
  ttl_days: number
  confidence_tier: ConfidenceTier
  tags: string[]
  status: MemoryStatus
  created_at: string
  content?: string
  pipeline_run_id?: string
}

export interface WriteMemoryInput {
  content: any
  memory_type: MemoryType
  source_url: string
  confidence_tier: ConfidenceTier
  tags: string[]
  pipeline_run_id?: string
}

export interface RecallOptions {
  limit?: number
  include_stale?: boolean
  pipeline_run_id?: string
}

export function makePipelineKey(agent: string, key: string, userId: string, runId: string): string {
  return `${agent}:${key}:${userId}:${runId}`
}

export function makeGlobalKey(agent: string, key: string): string {
  return `${agent}:${key}:global`
}

export async function initQdrant() {
  const agents = ['aria', 'kiran', 'soma', 'vikram', 'priya', 'dhruv', 'riya', 'mentor', 'atlas']
  const collections = agents.map((a) => `agent_memory_${a}`).concat(['knowledge_commons'])

  try {
    for (const coll of collections) {
      try {
        await qdrant.createCollection(coll, {
          vectors: { size: 1536, distance: 'Cosine' },
        })
      } catch (e: any) {
        // Qdrant returns 400 Bad Request for "already exists" in some versions, or 409 in others.
        const isExists = e.status === 409 || (e.status === 400 && JSON.stringify(e.data || e).includes('already exists'))
        if (!isExists) throw e
      }
      logger.info(`Qdrant collection ${coll}: ready`)
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Qdrant collections')
  }
}

function isExpired(entry: MemoryEntry): boolean {
  if (entry.ttl_days === Infinity) return false
  const stored = new Date(entry._storedAt).getTime()
  const ttlMs = entry.ttl_days * 24 * 60 * 60 * 1000
  return Date.now() - stored > ttlMs
}

/**
 * Write a memory entry to the agent's Qdrant collection.
 * Each entry is scoped by `user_id` in the payload for row-level security filtering.
 */
export async function writeMemory(
  agentId: AgentId,
  key: string,
  input: WriteMemoryInput,
  userId?: string,
): Promise<MemoryEntry> {
  const collection = `agent_memory_${agentId.toLowerCase()}`
  const storedAt = new Date().toISOString()
  const ttlDays = MEMORY_TTL_DAYS[input.memory_type] ?? 30

  const summary = extractSemanticSummary(input.content, key)
  const vector = await getEmbedding(summary).catch((err) => {
    logger.warn({ err, agentId, key }, 'Memory store failed to generate embedding; using zero vector')
    return new Array(1536).fill(0)
  })

  const entry: MemoryEntry = {
    payload: {
      ...input.content,
      user_id: userId,
      pipeline_run_id: input.pipeline_run_id,
    },
    _key: key,
    _summary: summary,
    _storedAt: storedAt,
    _agentId: agentId,
    memory_type: input.memory_type,
    source_url: input.source_url,
    retrieved_at: storedAt,
    ttl_days: ttlDays,
    confidence_tier: input.confidence_tier,
    tags: input.tags,
    status: 'ACTIVE',
    created_at: storedAt,
    content: typeof input.content === 'string' ? input.content : JSON.stringify(input.content),
    pipeline_run_id: input.pipeline_run_id,
  }

  await qdrant.upsert(collection, {
    points: [
      {
        id: key,
        vector,
        payload: entry,
      },
    ],
  })

  auditTrail.log({
    pipeline_run_id: input.pipeline_run_id || 'MEMORY_GLOBAL',
    user_id: userId,
    agent_id: agentId,
    action_type: AuditActionType.MEMORY_WRITE,
    payload: { key, memory_type: input.memory_type, source_url: input.source_url },
  })

  return entry
}

/**
 * Recall memories for an agent by semantic similarity to a query text.
 * Filters out expired entries unless `include_stale` is true.
 */
export async function recallMemory(
  agentId: AgentId,
  queryText: string,
  userId?: string,
  options: RecallOptions = {},
): Promise<MemoryEntry[]> {
  const collection = `agent_memory_${agentId.toLowerCase()}`
  const limit = options.limit ?? 5

  let vector: number[]
  try {
    vector = await getEmbedding(queryText)
  } catch (err) {
    logger.warn({ err, agentId, queryText }, 'Memory recall failed to generate embedding; using zero vector')
    vector = new Array(1536).fill(0)
  }

  const response = (await qdrant.search(collection, {
    vector,
    limit,
    with_payload: true,
  })) as Array<{ id: string | number; score?: number; payload?: MemoryEntry }>

  const entries = response
    .map((r) => r.payload)
    .filter((entry): entry is MemoryEntry => entry !== undefined)
    .filter((entry) => !userId || entry.payload?.user_id === userId)
    .filter((entry) => !options.pipeline_run_id || entry.pipeline_run_id === options.pipeline_run_id)
    .filter((entry) => options.include_stale || !isExpired(entry))

  auditTrail.log({
    pipeline_run_id: options.pipeline_run_id || 'MEMORY_GLOBAL',
    user_id: userId,
    agent_id: agentId,
    action_type: AuditActionType.MEMORY_READ,
    payload: { query: queryText, results: entries.length },
  })

  return entries
}
