import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getRecommendationPacket } from '@/lib/tools/get-recommendation-packet'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

let mockRuns: any[] = []
let mockResults: any[] = []

vi.mock('@/lib/db', () => {
  const queryChain = (tableObj: any) => {
    const mockLimit = vi.fn(() => {
      if (tableObj === schema.pipelineRuns) return mockRuns
      if (tableObj === schema.pipelineResults) return mockResults
      return []
    })
    const mockOrderBy = vi.fn(() => ({
      limit: mockLimit
    }))
    const mockWhere = vi.fn(() => ({
      orderBy: mockOrderBy,
      limit: mockLimit
    }))
    return {
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit
    }
  }
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((tableObj: any) => queryChain(tableObj))
      })),
      insert: vi.fn(),
      delete: vi.fn()
    }
  }
})

describe('Recommendation Packet Tool Unit Tests', () => {
  beforeEach(async () => {
    mockRuns = []
    mockResults = []
  })

  it('Approved pipeline result exists -> tool returns packet with confidence_score', async () => {
    const userId = 'test-packet-user'
    
    // Insert a pipeline run
    mockRuns = [{ runId: 'run-packet-1', status: 'APPROVED' }]

    // Insert an approved packet result
    mockResults = [{
      status: 'approved',
      data: { confidence_score: 95, portfolio_draft: {} },
      createdAt: new Date()
    }]

    const result = await getRecommendationPacket(userId) as any
    expect(result.status).toBe('approved')
    expect(result.confidence_score).toBe(95)
    expect(result.portfolio_draft).toBeDefined()
  })

  it('Pipeline IN_PROGRESS -> returns { status: "pipeline_in_progress" }', async () => {
    const userId = 'test-packet-user'
    
    // Insert a pipeline run in progress
    mockRuns = [{ runId: 'run-packet-2', status: 'IN_PROGRESS' }]
    mockResults = []

    const result = await getRecommendationPacket(userId) as any
    expect(result.status).toBe('pipeline_in_progress')
  })

  it('No pipeline run ever -> returns { status: "no_recommendation_yet" }', async () => {
    mockRuns = []
    mockResults = []
    const userId = 'test-packet-user'
    const result = await getRecommendationPacket(userId) as any
    expect(result.status).toBe('no_recommendation_yet')
  })
})
