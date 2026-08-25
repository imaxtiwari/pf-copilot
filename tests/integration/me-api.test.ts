// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetCurrentUser = vi.hoisted(() => vi.fn())
const mockDbQuery = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/dev-user', () => ({
  getCurrentUser: mockGetCurrentUser,
}))

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      userProfile: { findFirst: mockDbQuery },
      users: { findFirst: mockDbQuery },
    },
  },
}))

vi.mock('@/db/schema', () => ({
  userProfile: {},
  users: {},
}))

import { GET as getMe } from '@/app/api/me/route'
import { GET as getUsage } from '@/app/api/me/usage/route'

describe('Me API routes', () => {
  beforeEach(() => {
    mockGetCurrentUser.mockReset()
    mockDbQuery.mockReset()
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('GET /api/me returns the user profile', async () => {
    mockDbQuery.mockResolvedValue({ id: 'p1', age: 35, cityTier: 'metro' })
    const response = await getMe()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.userId).toBe('user-1')
    expect(body.data.profile.age).toBe(35)
  })

  it('GET /api/me/usage returns monthly usage', async () => {
    mockDbQuery.mockResolvedValue({ monthlyTokens: 1000, monthlyCost: '0.50' })
    const response = await getUsage()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.data.monthlyTokens).toBe(1000)
    expect(body.data.monthlyCost).toBe(0.5)
  })

  it('GET /api/me/usage returns 404 when user row missing', async () => {
    mockDbQuery.mockResolvedValue(null)
    const response = await getUsage()
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('USER_NOT_FOUND')
  })
})