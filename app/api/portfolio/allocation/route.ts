import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { COOKIE_NAME } from '@/lib/auth/dev-user'
import { getAllocationForUser } from '@/lib/portfolio/get-allocation'

export type AllocationApiResponse = {
    ok: true
    data: {
        buckets: Array<{
            bucket: string
            value: number
            weight: number
            holdingCount: number
        }>
        totalValue: number
        topHoldings: Array<{
            schemeName: string
            schemeCode: string | null
            marketValue: number
            bucket: string
            amfiCategory: string | null
        }>
        unknownWeight: number
    }
}

export async function GET() {
    try {
        const cookieStore = await cookies()
        const userId = cookieStore.get(COOKIE_NAME)?.value

        if (!userId) {
            return NextResponse.json(
                { ok: false, error: { code: 'UNAUTHORIZED', message: 'no session' } },
                { status: 401 },
            )
        }

        const response = await getAllocationForUser(userId)
        return NextResponse.json(response)
    } catch (e) {
        return NextResponse.json(
            { ok: false, error: { code: 'DB_ERROR', message: e instanceof Error ? e.message : 'database error' } },
            { status: 500 },
        )
    }
}
