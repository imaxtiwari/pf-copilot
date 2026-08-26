import { tavily } from '@tavily/core'
import { AgentId } from '@/lib/audit/audit-trail'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { recallMemory, writeMemory, WriteMemoryInput } from '@/lib/memory/memory-store'
import { MEMORY_TTL_DAYS, MemoryType } from '@/lib/memory/ttl-config'
import { auditTrail, AuditActionType } from '@/lib/audit/audit-trail'
import logger from '@/lib/logger'

/**
 * Web Research Tool — retrieves online sources for agent research.
 *
 * Security guardrails:
 *   - All searched domains are intersected with APPROVED_DOMAINS.
 *   - No request is made unless at least one approved domain remains.
 *   - Tavily API key is read from the TAVILY_API_KEY env var only.
 *   - Network calls are wrapped in a timeout so a slow source cannot hang an agent.
 */

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
  'worldbank.org',
]

const DEFAULT_TIMEOUT_MS = 15_000
const MAX_SOURCES = 10

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
  memory_id: string
}

export class WebResearchTool {
  private agentId: AgentId
  private deliberationRoom: DeliberationRoom

  constructor(agentId: AgentId, deliberationRoom: DeliberationRoom) {
    this.agentId = agentId
    this.deliberationRoom = deliberationRoom
  }

  /**
   * Resolve the effective domain allowlist.
   * If the caller supplied approved_domains, we intersect it with the global
   * approved list. This prevents any agent from searching arbitrary URLs.
   */
  private resolveDomains(requested?: string[]): string[] {
    if (!requested || requested.length === 0) {
      return APPROVED_DOMAINS
    }
    const intersection = requested.filter((d) => APPROVED_DOMAINS.includes(d))
    if (intersection.length === 0) {
      logger.warn(
        { agentId: this.agentId, requested },
        'WebResearchTool: requested domains do not intersect with allowlist; falling back to defaults',
      )
      return APPROVED_DOMAINS
    }
    return intersection
  }

  async research(input: ResearchQuery, pipeline_run_id?: string): Promise<ResearchResult[]> {
    const runId = pipeline_run_id || 'STANDALONE'
    const domains = this.resolveDomains(input.approved_domains)
    const maxSources = Math.min(input.max_sources || 3, MAX_SOURCES)

    // ── Cache check ───────────────────────────────────────────────────────────
    try {
      const cached = await recallMemory(this.agentId, input.query_text, undefined, {
        limit: maxSources,
        pipeline_run_id: runId,
      })
      const ttlDays = input.freshness_required_days / 24
      const freshCached = cached.filter((entry) => {
        const ageDays = (Date.now() - new Date(entry.retrieved_at).getTime()) / (1000 * 60 * 60 * 24)
        return ageDays <= Math.max(ttlDays, MEMORY_TTL_DAYS[input.memory_type] ?? 30)
      })

      if (freshCached.length > 0) {
        logger.info(
          { agentId: this.agentId, query: input.query_text, cacheHits: freshCached.length },
          'WebResearchTool: cache hit — skipping Tavily API call',
        )
        return freshCached.map((entry) => ({
          url: entry.source_url,
          title: String(entry._summary).split('\n')[0] || entry.source_url,
          content_snippet: entry.content || entry._summary || '',
          retrieved_at: entry.retrieved_at,
          confidence_tier: entry.confidence_tier,
          memory_id: entry._key || 'cached',
        }))
      }
    } catch (cacheErr) {
      logger.warn({ cacheErr }, 'WebResearchTool: cache check failed — proceeding with Tavily')
    }

    // ── Audit query ───────────────────────────────────────────────────────────
    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: this.agentId,
      action_type: AuditActionType.WEB_RESEARCH_QUERY,
      payload: {
        query_text: input.query_text,
        intent: input.intent,
        domains,
        max_sources: maxSources,
        memory_type: input.memory_type,
      },
    })

    // ── Tavily search with timeout ────────────────────────────────────────────
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      logger.warn({ agentId: this.agentId }, 'WebResearchTool: TAVILY_API_KEY is not set')
      return []
    }

    let rawResults: Array<{ url?: string; title?: string; content?: string }> = []
    try {
      const client = tavily({ apiKey })
      const searchPromise = client.search(input.query_text, {
        maxResults: maxSources,
        includeDomains: domains,
        searchDepth: 'advanced',
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tavily search timed out')), DEFAULT_TIMEOUT_MS),
      )
      const response = (await Promise.race([searchPromise, timeoutPromise])) as {
        results?: Array<{ url?: string; title?: string; content?: string }>
      }
      rawResults = (response.results ?? []).slice(0, maxSources)
    } catch (tavilyErr) {
      logger.error({ tavilyErr, agentId: this.agentId }, 'WebResearchTool: Tavily search failed or timed out')
      return []
    }

    // ── Process, persist, and return results ──────────────────────────────────
    const results: ResearchResult[] = []
    const now = new Date().toISOString()

    for (const raw of rawResults) {
      try {
        const url = raw.url ?? ''
        const title = raw.title ?? ''
        const content_snippet = raw.content ?? ''
        if (!url) continue

        const confidence_tier: ResearchResult['confidence_tier'] = APPROVED_DOMAINS.some((d) =>
          url.includes(d),
        )
          ? 'VERIFIED'
          : 'INFERRED'

        const writeInput: WriteMemoryInput = {
          content: `${title}\n${content_snippet}`,
          memory_type: input.memory_type,
          source_url: url,
          confidence_tier,
          tags: [input.intent, this.agentId, input.memory_type],
          pipeline_run_id: runId,
        }

        let memory_id = 'write-failed'
        try {
          const entry = await writeMemory(this.agentId, `web-research-${runId}-${url}`, writeInput)
          memory_id = entry._key || 'write-failed'
        } catch (memErr) {
          logger.warn({ memErr, url }, 'WebResearchTool: memory write failed for result')
        }

        results.push({
          url,
          title,
          content_snippet,
          retrieved_at: now,
          confidence_tier,
          memory_id,
        })
      } catch (resultErr) {
        logger.warn({ resultErr }, 'WebResearchTool: failed to process individual result — skipping')
      }
    }

    auditTrail.log({
      pipeline_run_id: runId,
      agent_id: this.agentId,
      action_type: AuditActionType.WEB_RESEARCH_RESULT,
      payload: {
        query_text: input.query_text,
        results_count: results.length,
        memory_type: input.memory_type,
      },
    })

    logger.info(
      { agentId: this.agentId, query: input.query_text, resultsCount: results.length },
      'WebResearchTool: research complete',
    )

    return results
  }
}

