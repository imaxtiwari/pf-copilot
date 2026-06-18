import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from '@/app/api/pipeline/start/route'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

let activeRunsMock: any[] = []

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => activeRunsMock)
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ runId: 'mock-new-run-id' }])
      }))
    })),
  }
}))

// Mock the auth module
vi.mock('@/lib/auth/dev-user', () => ({
  resolveOrCreateUserId: vi.fn().mockResolvedValue({ userId: 'test-user-id' })
}))

// Mock background phase 1 so we don't actually trigger agents
vi.mock('@/lib/agents/dhruv', () => {
  return {
    Dhruv: class MockDhruv {
      startPipeline = vi.fn().mockResolvedValue('new-run-id')
      runPhase1 = vi.fn().mockResolvedValue(undefined)
    }
  }
})

describe('Pipeline Idempotency Tests', () => {
  beforeEach(async () => {
    activeRunsMock = []
  })

  afterEach(async () => {
    activeRunsMock = []
  })

  it('Second POST /api/pipeline/start while run IN_PROGRESS -> 409 with existing run ID', async () => {
    // Set mock to return an active run
    activeRunsMock = [{ runId: 'existing-run-id' }]

    const body = {
      client_data: {
        age: 30,
        city_tier: 'metro',
        monthly_rent: 20000,
        owns_home: false,
        dependents: 'spouse',
        medical_conditions: false
      }
    }

    const req = new NextRequest('http://localhost:3000/api/pipeline/start', {
      method: 'POST',
      body: JSON.stringify(body)
    })

    const res = await POST(req)
    expect(res.status).toBe(409)

    const json = await res.json()
    expect(json.pipeline_run_id).toBe('existing-run-id')
    expect(json.code).toBe('ACTIVE_RUN_EXISTS')
  })

  it('POST /api/pipeline/start after run COMPLETED -> 200, new run created', async () => {
    // Set mock to return no active runs (as if they were completed)
    activeRunsMock = []

    const body = {
      client_data: {
        age: 30,
        city_tier: 'metro',
        monthly_rent: 20000,
        owns_home: false,
        dependents: 'spouse',
        medical_conditions: false
      }
    }

    const req = new NextRequest('http://localhost:3000/api/pipeline/start', {
      method: 'POST',
      body: JSON.stringify(body)
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.pipeline_run_id).toBe('new-run-id')
    expect(json.status).toBe('STARTED')
  })
})
