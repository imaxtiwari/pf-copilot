import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeliberationRoom } from '@/lib/deliberation/deliberation-room'
import { WebResearchTool, APPROVED_DOMAINS } from '@/lib/research/web-research-tool'

const searchMock = vi.fn()

vi.mock('@tavily/core', () => ({
  tavily: vi.fn(() => ({ search: searchMock })),
}))

vi.mock('@/lib/memory/memory-store', () => ({
  recallMemory: vi.fn(async () => []),
  writeMemory: vi.fn(async (agentId, key, input) => ({
    _key: key,
    _summary: String(input.content).slice(0, 80),
    source_url: input.source_url,
    confidence_tier: input.confidence_tier,
    memory_type: input.memory_type,
    retrieved_at: new Date().toISOString(),
    content: String(input.content),
  })),
}))

vi.mock('@/lib/audit/audit-trail', () => ({
  auditTrail: { log: vi.fn(async () => undefined) },
  AuditActionType: {
    WEB_RESEARCH_QUERY: 'WEB_RESEARCH_QUERY',
    WEB_RESEARCH_RESULT: 'WEB_RESEARCH_RESULT',
  },
}))

import { recallMemory, writeMemory } from '@/lib/memory/memory-store'

describe('WebResearchTool', () => {
  const room = new DeliberationRoom()
  const tool = new WebResearchTool('SOMA', room)

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TAVILY_API_KEY
  })

  it('returns empty results when TAVILY_API_KEY is missing', async () => {
    const results = await tool.research({
      query_text: 'SEBI mutual fund regulations',
      intent: 'regulatory_update',
      freshness_required_days: 7,
      max_sources: 3,
      memory_type: 'SOMA_FUND_RESEARCH',
    })
    expect(results).toEqual([])
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('searches approved domains and persists results', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    searchMock.mockResolvedValueOnce({
      results: [
        {
          url: 'https://sebi.gov.in/news/article',
          title: 'SEBI Update',
          content: 'New mutual fund norms.',
        },
      ],
    })

    const results = await tool.research({
      query_text: 'SEBI mutual fund regulations',
      intent: 'regulatory_update',
      freshness_required_days: 7,
      max_sources: 3,
      memory_type: 'SOMA_FUND_RESEARCH',
    })

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://sebi.gov.in/news/article')
    expect(results[0].confidence_tier).toBe('VERIFIED')
    expect(searchMock).toHaveBeenCalledWith(
      'SEBI mutual fund regulations',
      expect.objectContaining({ includeDomains: APPROVED_DOMAINS, maxResults: 3 }),
    )
    expect(writeMemory).toHaveBeenCalled()
  })

  it('intersects caller-supplied domains with the global allowlist', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    searchMock.mockResolvedValueOnce({ results: [] })

    await tool.research({
      query_text: 'RBI policy',
      intent: 'macro_update',
      freshness_required_days: 7,
      max_sources: 2,
      approved_domains: ['rbi.org.in', 'evil.com'],
      memory_type: 'KIRAN_MACRO_BULLETIN',
    })

    const [, options] = searchMock.mock.calls[0]
    expect(options.includeDomains).toEqual(['rbi.org.in'])
    expect(options.includeDomains).not.toContain('evil.com')
  })

  it('returns cached results when fresh cache entries exist', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    const cached = [
      {
        source_url: 'https://amfiindia.com/cached',
        _summary: 'Cached AMFI note',
        content: 'Cached content',
        retrieved_at: new Date().toISOString(),
        confidence_tier: 'VERIFIED' as const,
        _key: 'cached-key',
      },
    ]
    vi.mocked(recallMemory).mockResolvedValueOnce(cached as any)

    const results = await tool.research({
      query_text: 'AMFI data',
      intent: 'fund_data',
      freshness_required_days: 7,
      max_sources: 3,
      memory_type: 'SOMA_NAV_DATA',
    })

    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://amfiindia.com/cached')
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('returns empty results on Tavily error without throwing', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    searchMock.mockRejectedValueOnce(new Error('network down'))

    const results = await tool.research({
      query_text: 'market crash',
      intent: 'risk_scan',
      freshness_required_days: 1,
      max_sources: 3,
      memory_type: 'KIRAN_MACRO_BULLETIN',
    })

    expect(results).toEqual([])
  })

  it('caps max_sources at 10', async () => {
    process.env.TAVILY_API_KEY = 'test-key'
    searchMock.mockResolvedValueOnce({ results: [] })

    await tool.research({
      query_text: 'mutual funds',
      intent: 'scan',
      freshness_required_days: 7,
      max_sources: 100,
      memory_type: 'SOMA_FUND_RESEARCH',
    })

    const [, options] = searchMock.mock.calls[0]
    expect(options.maxResults).toBe(10)
  })
})
