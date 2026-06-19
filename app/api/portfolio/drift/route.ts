import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { resolveOrCreateUserId } from '@/lib/auth/dev-user'
import { ok, err } from '@/lib/contracts/error-envelope'

export async function GET(req: NextRequest) {
  try {
    const { userId } = await resolveOrCreateUserId()
    if (!userId) {
      return NextResponse.json(err('unauthorized', 'Unauthorized access'), { status: 401 })
    }

    const [latestReport] = await db
      .select()
      .from(schema.driftReports)
      .where(eq(schema.driftReports.userId, userId))
      .orderBy(desc(schema.driftReports.generatedAt))
      .limit(1)

    if (!latestReport) {
      return NextResponse.json(ok(null))
    }

    return NextResponse.json(ok(latestReport.report))
  } catch (e) {
    return NextResponse.json(
      err('internal_error', e instanceof Error ? e.message : 'Unknown error'),
      { status: 500 }
    )
  }
}
