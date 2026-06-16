import { tavily } from '@tavily/core'
import { AgentMemoryStore, WriteMemoryInput } from '../memory/memory-store'
import { MEMORY_TTL_DAYS, MemoryType } from '../memory/ttl-config'
import { oracleMiddleware } from '../oracle/oracle'
import { auditTrail, AuditActionType } from '../audit/audit-trail'
import { scoreConfidence } from '../oracle/confidence-scorer'
import { DeliberationRoom } from '../deliberation/deliberation-room'
import { DeliberationMessage, AgentId } from '../deliberation/message-schema'
import { randomUUID } from 'crypto'
import logger from '../logger'

// ─── Approved Domains ─────────────────────────────────────────────────────────

export const APPROVED_DOMAINS = [
  'amfiindia.com',
  'sebi.gov.in',
  'nseindia.com',
  'bseindia.com',
  'rbi.org.in',
  'finmin.nic.in',
  'mospi.gov.in',
  'moneycontrol.com',
  'economictimes.com',
  'livemint.com',
  'federalreserve.gov',
  'imf.org',
  'worldbank.org'
]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResearchQuery {
  query_text: string
  intent: string
  freshness_required_days: number
  max_sources: number
  approved_domains?: string[]
  memory_type: MemoryType
}

export interface ResearchResult {
  url: string
  title: string
  content_snippet: string
  retrieved_at: string
  confidence_tier: 'VERIFIED' | 'INFERRED' | 'ASSUMED'
  oracle_flags: string[]
  memory_id: string
}

// ─── Cache hit similarity threshold ──────────────────────────────────────────
const CACHE_SIMILARITY_THRESHOLD = 0.92

// ─── Web Research Tool ────────────────────────────────────────────────────────

export class WebResearchTool {
  private agentId: AgentId
  private memoryStore: AgentMemoryStore
  private deliberationRoom: DeliberationRoom

  constructor(agentId: AgentId, memoryStore: AgentMemoryStore, deliberationRoom: DeliberationRoom) {
    this.agentId = agentId
    this.memoryStore = memoryStore
    this.deliberationRoom = deliberationRoom
  }

  async research(input: ResearchQuery, pipeline_run_id?: string): Promise<ResearchResult[]> {
    const runId = pipeline_run_id || 'STANDALONE'
    const domains = input.approved_domains?.length
      ? input.approved_domains
      : APPROVED_DOMAINS
    const maxSources = Math.min(input.max_sources, 10)

    // ── STEP a: Cache Check ──────────────────────────────────────────────────
    try {
      const cachedResults = await this.memoryStore.recall(this.agentId, input.query_text, {
        limit: maxSources,
        pipeline_run_id: runId
      })

      // Filter by freshness
      const freshCached = cachedResults.filter(entry => {
        const ageDays = (Date.now() - new Date(entry.retrieved_at).getTime()) / (1000 * 60 * 60 * 24)
        return ageDays <= input.freshness_required_days
      })

      if (freshCached.length > 0) {
        logger.info(
          { agentId: this.agentId, query: input.query_text, cacheHits: freshCached.length },
          'WebResearchTool: cache hit — skipping Tavily API call'
        )
        return freshCached.map(entry => ({
          url: entry.source_url,
          title: entry.content.split('\n')[0] ?? entry.content.slice(0, 80),
          content_snippet: entry.content,
          retrieved_at: entry.retrieved_at,
          confidence_tier: entry.confidence_tier,
          oracle_flags: [],
          memory_id: 'cached'
        }))
      }
    } catch (cacheErr) {
      logger.warn({ cacheErr }, 'WebResearchTool: cache check failed — proceeding with Tavily')
    }

    // ── STEP b: Audit WEB_RESEARCH_QUERY ─────────────────────────────────────
    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: this.agentId,
      action_type: AuditActionType.WEB_RESEARCH_QUERY,
      payload: {
        query_text: input.query_text,
        intent: input.intent,
        domains,
        max_sources: maxSources,
        memory_type: input.memory_type
      }
    })

    // ── STEP c: Tavily Search ─────────────────────────────────────────────────
    let tavilyResults: Array<{ url: string; title: string; content: string; published_date?: string }> = []

    try {
      const tavilyApiKey = process.env.TAVILY_API_KEY
      if (!tavilyApiKey) throw new Error('TAVILY_API_KEY is not set')

      const client = tavily({ apiKey: tavilyApiKey })
      const response = await client.search(input.query_text, {
        maxResults: maxSources,
        includeDomains: domains,
        searchDepth: 'advanced',
      })

      tavilyResults = (response.results ?? []).slice(0, maxSources)
    } catch (tavilyErr) {
      logger.error({ tavilyErr, agentId: this.agentId }, 'WebResearchTool: Tavily search failed')
      return []
    }

    // ── STEPS d-g: Parse → ORACLE → Memory → Return ───────────────────────────
    const results: ResearchResult[] = []
    const now = new Date().toISOString()

    for (const raw of tavilyResults) {
      try {
        const url = raw.url ?? ''
        const title = raw.title ?? ''
        const content_snippet = raw.content ?? ''
        const retrieved_at = now

        // ── STEP d: ORACLE Validation ───────────────────────────────────────
        const mockPipelineRunId = randomUUID()
        const mockMsg: DeliberationMessage = {
          message_id: randomUUID(),
          pipeline_run_id: mockPipelineRunId,
          timestamp: now,
          sender: this.agentId,
          message_type: 'FUND_REPORT' as const,
          recipient: 'ORACLE' as const,
          payload: {
            source_url: url,
            content_snippet,
            title
          },
          oracle_validation: { status: 'PENDING' as const, flags: [] },
          references: []
        }

        let oracleFlags: string[] = []
        let oracleStatus: 'PASSED' | 'FLAGGED' | 'PENDING' = 'PENDING'
        try {
          const validated = await oracleMiddleware(mockMsg)
          oracleFlags = validated.oracle_validation.flags
          oracleStatus = validated.oracle_validation.status
        } catch (oracleErr) {
          logger.warn({ oracleErr }, 'WebResearchTool: ORACLE validation failed for result')
          oracleStatus = 'PENDING'
        }

        // Derive confidence tier from oracle status
        const confidence_tier = scoreConfidence({
          content: content_snippet,
          source_url: url,
          retrieved_at,
          ttl_days: MEMORY_TTL_DAYS[input.memory_type],
          has_contradictions: oracleStatus === 'FLAGGED'
        })

        // ── STEP e: Memory Write ────────────────────────────────────────────
        const writeInput: WriteMemoryInput = {
          content: `${title}\n${content_snippet}`,
          memory_type: input.memory_type,
          source_url: url,
          confidence_tier,
          tags: [input.intent, this.agentId, input.memory_type],
          pipeline_run_id: runId
        }

        let memory_id = 'write-failed'
        try {
          memory_id = await this.memoryStore.write(this.agentId, writeInput)
        } catch (memErr) {
          logger.warn({ memErr, url }, 'WebResearchTool: memory write failed for result')
        }

        results.push({
          url,
          title,
          content_snippet,
          retrieved_at,
          confidence_tier,
          oracle_flags: oracleFlags,
          memory_id
        })
      } catch (resultErr) {
        logger.warn({ resultErr }, 'WebResearchTool: failed to process individual result — skipping')
      }
    }

    // ── STEP f: Audit WEB_RESEARCH_RESULT ────────────────────────────────────
    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: this.agentId,
      action_type: AuditActionType.WEB_RESEARCH_RESULT,
      payload: {
        query_text: input.query_text,
        results_count: results.length,
        flagged_count: results.filter(r => r.oracle_flags.length > 0).length,
        memory_type: input.memory_type
      }
    })

    logger.info(
      { agentId: this.agentId, query: input.query_text, resultsCount: results.length },
      'WebResearchTool: research complete'
    )

    return results
  }
}
