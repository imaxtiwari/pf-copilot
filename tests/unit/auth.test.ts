import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCurrentUser, requireAuth, linkLegacyUserId } from '@/lib/auth/user'
import { unauthorizedResponse, forbiddenResponse } from '@/lib/auth/errors'
import { withAuthContext, db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq } from 'drizzle-orm'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockCookiesGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/supabase', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: () => mockGetUser(),
    },
  })),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => mockCookiesGet(name),
    getAll: () => [],
    set: vi.fn(),
  })),
}))

describe('getCurrentUser', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockCookiesGet.mockReset()
    delete process.env.ALLOW_LEGACY_DEV_USER
    process.env.NODE_ENV = 'test'
  })

  it('returns null when there is no authenticated user and no legacy fallback', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') })
    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it('returns the Supabase user id when authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'auth-user-1', email: 'test@example.com' } },
      error: null,
    })
    const user = await getCurrentUser()
    expect(user).toEqual({ userId: 'auth-user-1', isNew: false, email: 'test@example.com' })
  })

  it('falls back to legacy cookie when ALLOW_LEGACY_DEV_USER is true', async () => {
    process.env.ALLOW_LEGACY_DEV_USER = 'true'
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') })
    mockCookiesGet.mockReturnValue({ value: 'legacy-user-1' })
    const user = await getCurrentUser()
    expect(user).toEqual({ userId: 'legacy-user-1', isNew: false })
  })

  it('does not fall back to legacy cookie in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_LEGACY_DEV_USER = 'true'
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') })
    mockCookiesGet.mockReturnValue({ value: 'legacy-user-1' })
    const user = await getCurrentUser()
    expect(user).toBeNull()
  })

  it('requireAuth throws UnauthorizedError when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('no session') })
    await expect(requireAuth()).rejects.toThrow('Unauthorized')
  })

  it('requireAuth returns the user when authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'auth-user-2', email: 'test@example.com' } },
      error: null,
    })
    const user = await requireAuth()
    expect(user.userId).toBe('auth-user-2')
  })
})

describe('auth error envelopes', () => {
  it('unauthorizedResponse returns a 401 envelope', async () => {
    const response = unauthorizedResponse()
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('unauthorized')
  })

  it('forbiddenResponse returns a 403 envelope', async () => {
    const response = forbiddenResponse()
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('forbidden')
  })
})

describe('linkLegacyUserId', () => {
  it('updates the legacy_user_id column for a user', async () => {
    const updateSpy = vi.spyOn(db, 'update').mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as ReturnType<typeof db.update>)

    await linkLegacyUserId('auth-user-3', 'legacy-uuid')

    expect(updateSpy).toHaveBeenCalledWith(schema.users)
    updateSpy.mockRestore()
  })
})

describe('RLS policies', () => {
  const shouldRun = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost:5432/test'))

  it.runIf(shouldRun)('blocks cross-user reads via withAuthContext', async () => {
    const [owner] = await db.insert(schema.users).values({}).returning({ id: schema.users.id })
    const [other] = await db.insert(schema.users).values({}).returning({ id: schema.users.id })

    await db.insert(schema.casUploads).values({
      userId: owner.id,
      fileHash: 'owner-hash',
      status: 'pending',
      visionUsed: false,
    })

    // Owner should see their own upload inside an auth context.
    const ownerRows = await withAuthContext(owner.id, async (authDb) => {
      return authDb.select().from(schema.casUploads)
    })
    expect(ownerRows).toHaveLength(1)

    // Other user should see none because of RLS.
    const otherRows = await withAuthContext(other.id, async (authDb) => {
      return authDb.select().from(schema.casUploads)
    })
    expect(otherRows).toHaveLength(0)

    // Cleanup
    await db.delete(schema.casUploads).where(eq(schema.casUploads.userId, owner.id))
    await db.delete(schema.users).where(eq(schema.users.id, owner.id))
    await db.delete(schema.users).where(eq(schema.users.id, other.id))
  })
})
