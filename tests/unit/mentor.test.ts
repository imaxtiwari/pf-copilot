import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Mentor } from '../../lib/agents/mentor'
import { KnowledgeCommons } from '../../lib/research/knowledge-commons'
import { auditTrail, AuditActionType } from '../../lib/audit/audit-trail'

// Variable to control mock GPT response
let mockGptResponse = '{}'

// Mock Azure OpenAI
vi.mock('../../lib/azure-openai', () => {
  return {
    getGpt4o: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => ({
            choices: [{ message: { content: mockGptResponse } }]
          }))
        }
      }
    })),
    getEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0))
  }
})

// Mock KnowledgeCommons
const mockContribute = vi.fn()
vi.mock('../../lib/research/knowledge-commons', () => {
  return {
    KnowledgeCommons: class {
      contribute = mockContribute
    }
  }
})

// Mock auditTrail
vi.mock('../../lib/audit/audit-trail', () => {
  return {
    auditTrail: {
      log: vi.fn()
    },
    AuditActionType: {
      KNOWLEDGE_COMMONS_WRITE: 'KNOWLEDGE_COMMONS_WRITE'
    }
  }
})

describe('Mentor Post-Pipeline Analysis Unit Tests', () => {
  const mockRoom = { receiveThread: vi.fn().mockResolvedValue([]) } as any
  const mockMemory = {} as any

  beforeEach(() => {
    mockGptResponse = '{}'
    mockContribute.mockReset()
    vi.clearAllMocks()
  })

  it('should successfully run post-pipeline analysis and contribute learnings', async () => {
    mockGptResponse = JSON.stringify({
      learnings: [
        {
          agent: 'ARIA',
          learning: 'ARIA needs to be less conservative on sector limits.',
          reason: 'Voted REJECT multiple times due to sector overlap which was resolved.',
          tags: ['concentration', 'sector_limits']
        },
        {
          agent: 'KIRAN',
          learning: 'KIRAN should refine macro stress testing rules.',
          reason: 'Initial draft had issues with high beta allocations under bear scenarios.',
          tags: ['macro_risk', 'stress_test']
        }
      ]
    })

    let whereCallCount = 0
    let limitCallCount = 0

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(function(this: any) {
        whereCallCount++
        if (whereCallCount === 2) {
          // returns critique messages
          return Promise.resolve([
            { messageId: 'm1', sender: 'ARIA', messageType: 'CRITIQUE', payload: { observation: 'concentration too high' } }
          ])
        }
        if (whereCallCount === 5) {
          // returns root messages
          return Promise.resolve([])
        }
        return this
      }),
      orderBy: vi.fn().mockResolvedValue([
        { voteId: 'v1', voter: 'ARIA', vote: 'APPROVE', reasoning: 'looks good' }
      ]),
      limit: vi.fn().mockImplementation(() => {
        limitCallCount++
        if (limitCallCount === 1) {
          return Promise.resolve([{ resultId: 'r1', pipelineRunId: 'test-run-123' }])
        }
        return Promise.resolve([{ runId: 'test-run-123', revisionCycle: 3 }])
      })
    } as any

    const mentor = new Mentor(mockRoom, mockMemory, mockDb)
    await mentor.runPostPipelineAnalysis('test-run-123', 'APPROVED')

    // Assert contribute was called exactly twice
    expect(mockContribute).toHaveBeenCalledTimes(2)
    expect(mockContribute).toHaveBeenNthCalledWith(1, 'ARIA', {
      summary: 'ARIA needs to be less conservative on sector limits.',
      source_urls: ['internal://pipeline-run/test-run-123'],
      tags: ['concentration', 'sector_limits', 'mentor_analysis', 'approved', 'MENTOR:pipeline_learnings:undefined:test-run-123'],
      agent: 'ARIA'
    })
    expect(mockContribute).toHaveBeenNthCalledWith(2, 'KIRAN', {
      summary: 'KIRAN should refine macro stress testing rules.',
      source_urls: ['internal://pipeline-run/test-run-123'],
      tags: ['macro_risk', 'stress_test', 'mentor_analysis', 'approved', 'MENTOR:pipeline_learnings:undefined:test-run-123'],
      agent: 'KIRAN'
    })

    // Assert the ARIA learning's tags includes 'mentor_analysis'
    const ariaCall = mockContribute.mock.calls.find(call => call[0] === 'ARIA')
    expect(ariaCall).toBeDefined()
    expect(ariaCall![1].tags).toContain('mentor_analysis')

    expect(auditTrail.log).toHaveBeenCalledWith({
      pipeline_run_id: 'test-run-123',
      agent_id: 'DHRUV',
      action_type: AuditActionType.KNOWLEDGE_COMMONS_WRITE,
      payload: { learnings_count: 2, outcome: 'APPROVED' }
    })
  })

  it('should throw an error and not contribute when LLM response is not valid JSON', async () => {
    mockGptResponse = 'invalid-non-json-response'

    let whereCallCount = 0
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(function(this: any) {
        whereCallCount++
        if (whereCallCount === 2 || whereCallCount === 5) {
          return Promise.resolve([])
        }
        return this
      }),
      orderBy: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockResolvedValue([])
    } as any

    const mentor = new Mentor(mockRoom, mockMemory, mockDb)

    await expect(mentor.runPostPipelineAnalysis('test-run-123', 'DEADLOCKED')).rejects.toThrow('MENTOR analysis response is not valid JSON')
    expect(mockContribute).not.toHaveBeenCalled()
  })
})
