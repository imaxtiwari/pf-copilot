import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '../../../lib/db'
import { userProfile } from '../../../db/schema'
import { ok, err } from '../../../lib/contracts/error-envelope'
import { getCurrentUser } from '../../../lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorizedResponse()
    const userId = user.userId

    const profile = await db.query.userProfile.findFirst({
      where: eq(userProfile.userId, userId),
    })

    return NextResponse.json(ok({ userId, profile: profile ?? null }))
  } catch (e) {
    return NextResponse.json(
      err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
      { status: 500 },
    )
  }
}
