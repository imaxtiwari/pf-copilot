import { QdrantClient } from '@qdrant/js-client-rest'
import { getEmbedding } from '../azure-openai'
import { auditTrail, AuditActionType, AgentId } from '../audit/audit-trail'
import { MEMORY_TTL_DAYS, MemoryType } from './ttl-config'
import { randomUUID } from 'crypto'
import logger from '../logger'

class MockQdrantClient {
  private collections = new Map<string, Array<{ id: string | number; vector: number[]; payload: any }>>()

  async getCollections() {
    return {
      collections: Array.from(this.collections.keys()).map(name => ({ name }))
    }
  }

  async createCollection(name: string) {
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
      const idx = list.findIndex(p => p.id === point.id)
      if (idx >= 0) {
        list[idx] = point
      } else {
        list.push(point)
      }
    }
  }

  async search(name: string, data: { limit: number }) {
    const list = this.collections.get(name) || []
    return list.slice(0, data.limit).map(p => ({
      id: p.id,
      score: 1.0,
      payload: {
        ...p.payload,
        source_url: p.payload?.source_url || ''
      }
    }))
  }

  async setPayload(name: string, data: { points: Array<string | number>; payload: any }) {
    const list = this.collections.get(name) || []
    for (const id of data.points) {
      const point = list.find(p => p.id === id)
      if (point) {
        point.payload = { ...point.payload, ...data.payload }
      }
    }
  }

  async scroll(name: string, data: { limit: number; offset?: any }) {
    const list = this.collections.get(name) || []
    const startIdx = typeof data.offset === 'number' ? data.offset : 0
    const endIdx = startIdx + data.limit
    const sliced = list.slice(startIdx, endIdx)
    return {
      points: sliced.map(p => ({
        id: p.id,
        payload: p.payload
      })),
      next_page_offset: endIdx < list.length ? endIdx : null
    }
  }
}

function makeQdrantClient() {
  if (process.env.MOCK_LLM === 'true' && process.env.VITEST !== 'true') {
    logger.info('AgentMemoryStore: Initialising mock Qdrant client')
    return new MockQdrantClient() as any
  }
  return new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333'
  })
}

export const qdrant = makeQdrantClient()

export type ConfidenceTier = 'VERIFIED' | 'INFERRED' | 'ASSUMED'
export type MemoryStatus = 'ACTIVE' | 'STALE' | 'ARCHIVED'

export interface MemoryEntry {
  content: string
  agent_id: string
  memory_type: MemoryType
  source_url: string
  retrieved_at: string
  ttl_days: number
  confidence_tier: ConfidenceTier
  tags: string[]
  status: MemoryStatus
  created_at: string
  pipeline_run_id?: string
}

export interface WriteMemoryInput {
  content: string
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

export async function initQdrant() {
  const agents = ['aria', 'kiran', 'soma', 'vikram', 'priya', 'dhruv']
  const collections = agents.map(a => `agent_memory_${a}`).concat(['knowledge_commons'])

  try {
    const existing = await qdrant.getCollections()
    const existingNames = existing.collections.map((c: any) => c.name)

    for (const coll of collections) {
      if (!existingNames.includes(coll)) {
        await qdrant.createCollection(coll, {
          vectors: { size: 1536, distance: 'Cosine' }
        })
        logger.info({ collection: coll }, 'Created Qdrant collection')
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Qdrant collections')
  }
}

export class AgentMemoryStore {
  
  private computeStatus(entry: MemoryEntry): { newStatus: MemoryStatus, changed: boolean } {
    if (entry.ttl_days === Infinity) {
      return { newStatus: 'ACTIVE', changed: entry.status !== 'ACTIVE' }
    }
    
    const ageMs = Date.now() - new Date(entry.created_at).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    
    let newStatus: MemoryStatus = 'ACTIVE'
    if (ageDays >= entry.ttl_days * 3) {
      newStatus = 'ARCHIVED'
    } else if (ageDays >= entry.ttl_days) {
      newStatus = 'STALE'
    }

    return { newStatus, changed: newStatus !== entry.status }
  }

  async write(agentId: AgentId, entry: WriteMemoryInput): Promise<string> {
    const vector = await getEmbedding(entry.content)
    const id = randomUUID()
    const now = new Date().toISOString()
    
    const payload: MemoryEntry = {
      content: entry.content,
      agent_id: agentId,
      memory_type: entry.memory_type,
      source_url: entry.source_url,
      retrieved_at: now,
      ttl_days: MEMORY_TTL_DAYS[entry.memory_type],
      confidence_tier: entry.confidence_tier,
      tags: entry.tags,
      status: 'ACTIVE',
      created_at: now,
      pipeline_run_id: entry.pipeline_run_id
    }
    
    await qdrant.upsert(`agent_memory_${agentId.toLowerCase()}`, {
      wait: true,
      points: [{ id, vector, payload: payload as unknown as Record<string, unknown> }]
    })

    auditTrail.log({
      pipeline_run_id: entry.pipeline_run_id || 'UNKNOWN',
      agent_id: agentId,
      action_type: AuditActionType.MEMORY_WRITE,
      payload: { memory_id: id, memory_type: entry.memory_type, agent_id: agentId }
    })

    return id
  }

  async recall(agentId: AgentId, query: string, options?: RecallOptions): Promise<MemoryEntry[]> {
    const vector = await getEmbedding(query)
    const limit = options?.limit || 5
    const collectionName = `agent_memory_${agentId.toLowerCase()}`

    const results = await qdrant.search(collectionName, {
      vector,
      limit: limit * 3, // overfetch to account for filtered out stale/archived items
      with_payload: true
    })

    const finalEntries: MemoryEntry[] = []
    const pointsToUpdate: { id: string | number, status: MemoryStatus }[] = []

    for (const res of results) {
      const payload = res.payload as unknown as MemoryEntry
      const { newStatus, changed } = this.computeStatus(payload)
      
      if (changed) {
        payload.status = newStatus
        pointsToUpdate.push({ id: res.id, status: newStatus })
      }

      if (newStatus === 'ACTIVE') {
        finalEntries.push(payload)
      } else if (newStatus === 'STALE' && options?.include_stale) {
        const ageMs = Date.now() - new Date(payload.created_at).getTime()
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
        payload.content = `[STALE — ${ageDays} days ago] ${payload.content}`
        finalEntries.push(payload)
      }
    }

    if (pointsToUpdate.length > 0) {
      // Lazy background update
      Promise.all(pointsToUpdate.map(update => 
        qdrant.setPayload(collectionName, {
          points: [update.id],
          payload: { status: update.status }
        })
      )).catch(err => logger.error({ err }, 'Lazy Qdrant TTL update failed'))
    }

    auditTrail.log({
      pipeline_run_id: options?.pipeline_run_id || 'UNKNOWN',
      agent_id: agentId,
      action_type: AuditActionType.MEMORY_READ,
      payload: { query, returned_count: Math.min(finalEntries.length, limit), agent_id: agentId }
    })

    return finalEntries.slice(0, limit)
  }

  async writeToKnowledgeCommons(entry: WriteMemoryInput & { agent_id: AgentId }): Promise<string> {
    const vector = await getEmbedding(entry.content)
    const id = randomUUID()
    const now = new Date().toISOString()
    
    const payload: MemoryEntry = {
      content: entry.content,
      agent_id: entry.agent_id,
      memory_type: entry.memory_type,
      source_url: entry.source_url,
      retrieved_at: now,
      ttl_days: MEMORY_TTL_DAYS[entry.memory_type],
      confidence_tier: entry.confidence_tier,
      tags: entry.tags,
      status: 'ACTIVE',
      created_at: now,
      pipeline_run_id: entry.pipeline_run_id
    }
    
    await qdrant.upsert('knowledge_commons', {
      wait: true,
      points: [{ id, vector, payload: payload as unknown as Record<string, unknown> }]
    })

    auditTrail.log({
      pipeline_run_id: entry.pipeline_run_id || 'UNKNOWN',
      agent_id: entry.agent_id,
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: { memory_id: id, memory_type: entry.memory_type }
    })

    return id
  }

  async recallFromKnowledgeCommons(query: string, options?: RecallOptions & { caller_agent_id: AgentId }): Promise<MemoryEntry[]> {
    const vector = await getEmbedding(query)
    const limit = options?.limit || 5

    const results = await qdrant.search('knowledge_commons', {
      vector,
      limit: limit * 3,
      with_payload: true
    })

    const finalEntries: MemoryEntry[] = []
    const pointsToUpdate: { id: string | number, status: MemoryStatus }[] = []

    for (const res of results) {
      const payload = res.payload as unknown as MemoryEntry
      const { newStatus, changed } = this.computeStatus(payload)
      
      if (changed) {
        payload.status = newStatus
        pointsToUpdate.push({ id: res.id, status: newStatus })
      }

      if (newStatus === 'ACTIVE') {
        finalEntries.push(payload)
      } else if (newStatus === 'STALE' && options?.include_stale) {
        const ageMs = Date.now() - new Date(payload.created_at).getTime()
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
        payload.content = `[STALE — ${ageDays} days ago] ${payload.content}`
        finalEntries.push(payload)
      }
    }

    if (pointsToUpdate.length > 0) {
      Promise.all(pointsToUpdate.map(update => 
        qdrant.setPayload('knowledge_commons', {
          points: [update.id],
          payload: { status: update.status }
        })
      )).catch(err => logger.error({ err }, 'Lazy Qdrant TTL update failed'))
    }

    auditTrail.log({
      pipeline_run_id: options?.pipeline_run_id || 'UNKNOWN',
      agent_id: options?.caller_agent_id || 'SYSTEM',
      action_type: AuditActionType.MEMORY_READ,
      payload: { query, returned_count: Math.min(finalEntries.length, limit), source: 'knowledge_commons' }
    })

    return finalEntries.slice(0, limit)
  }

  async getStaleEntries(agentId: AgentId): Promise<MemoryEntry[]> {
    const collectionName = `agent_memory_${agentId.toLowerCase()}`
    const stale: MemoryEntry[] = []
    
    let next_page_offset: string | number | undefined = undefined;
    
    do {
      const res = await qdrant.scroll(collectionName, {
        limit: 100,
        offset: next_page_offset,
        with_payload: true
      })
      
      for (const point of res.points) {
        const payload = point.payload as unknown as MemoryEntry
        const { newStatus } = this.computeStatus(payload)
        if (newStatus === 'STALE' || newStatus === 'ARCHIVED') {
          stale.push(payload)
        }
      }
      
      next_page_offset = res.next_page_offset as string | number | undefined
    } while (next_page_offset !== null && next_page_offset !== undefined)

    return stale
  }
}

export const agentMemoryStore = new AgentMemoryStore()
