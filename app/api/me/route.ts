import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../lib/db'
import { userProfile } from '../../../db/schema'
import { ok } from '../../../lib/contracts/error-envelope'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../lib/auth/dev-user'

export async function GET() {
  const { userId, isNew } = await resolveOrCreateUserId()

  const profile = await db.query.userProfile.findFirst({
    where: eq(userProfile.userId, userId),
  })

  const response = NextResponse.json(ok({ userId, profile: profile ?? null }))
  if (isNew) {
    response.cookies.set(COOKIE_NAME, userId, cookieOptions())
  }
  return response
}
