import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { ok, err } from '@/lib/contracts/error-envelope'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) return unauthorizedResponse()
    const userId = user.userId

    const row = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: {
        monthlyTokens: true,
        monthlyCost: true,
      },
    })

    if (!row) {
      return NextResponse.json(err('USER_NOT_FOUND', 'User not found'), { status: 404 })
    }

    return NextResponse.json(
      ok({
        monthlyTokens: row.monthlyTokens,
        monthlyCost: Number(row.monthlyCost),
      }),
    )
  } catch (e) {
    return NextResponse.json(
      err('DB_ERROR', e instanceof Error ? e.message : 'database error'),
      { status: 500 },
    )
  }
}
