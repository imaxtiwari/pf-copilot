import { createClient } from './supabase'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export type CurrentUserResult = {
  userId: string
  isNew: false
  email?: string
}

/**
 * Resolve the currently authenticated user from Supabase Auth.
 *
 * In non-production environments, if `ALLOW_LEGACY_DEV_USER=true` is set and a
 * legacy `pf_user_id` cookie is present, the legacy UUID is returned. This is
 * intended only for staged migration and must not be enabled in production.
 */
export async function getCurrentUser(): Promise<CurrentUserResult | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    // Fallback to legacy cookie only when explicitly allowed (local migrations).
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_LEGACY_DEV_USER === 'true') {
      const legacyId = await getLegacyUserId()
      if (legacyId) return { userId: legacyId, isNew: false }
    }
    return null
  }

  return {
    userId: user.id,
    isNew: false,
    email: user.email,
  }
}

/**
 * Require an authenticated user. Returns the user or throws a 401-style error.
 * Route handlers should catch this and return an unauthorized envelope.
 */
export async function requireAuth(): Promise<CurrentUserResult> {
  const user = await getCurrentUser()
  if (!user) {
    const error = new Error('Unauthorized')
    error.name = 'UnauthorizedError'
    throw error
  }
  return user
}

async function getLegacyUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    return cookieStore.get('pf_user_id')?.value ?? null
  } catch {
    return null
  }
}

/**
 * Link a legacy dev-user UUID to a Supabase Auth identity by storing it on the
 * users table. Call this once after the user's first Supabase login if a legacy
 * cookie is present and you need to preserve pre-existing data.
 */
export async function linkLegacyUserId(supabaseUserId: string, legacyUserId: string): Promise<void> {
  await db
    .update(users)
    .set({ legacyUserId })
    .where(eq(users.id, supabaseUserId))
}
