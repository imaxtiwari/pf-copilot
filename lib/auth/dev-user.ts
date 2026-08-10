import { cookies } from 'next/headers'
import { db } from '../db'
import { users } from '../../db/schema'

export const COOKIE_NAME = 'pf_user_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export type DevUserResult = {
  userId: string
  isNew: boolean
}

export async function resolveOrCreateUserId(): Promise<DevUserResult> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value
  if (existing) return { userId: existing, isNew: false }

  const [user] = await db.insert(users).values({}).returning({ id: users.id })
  return { userId: user.id, isNew: true }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  }
}
