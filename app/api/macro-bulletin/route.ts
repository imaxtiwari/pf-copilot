import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import { getCurrentUser } from '@/lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'
import logger from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    const user = await getCurrentUser()
    if (!user) return unauthorizedResponse()

    const filePath = path.join(process.cwd(), 'data', 'macro-bulletin.json')
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf8')
      const bulletin = JSON.parse(fileContent)
      return NextResponse.json(bulletin)
    }

    return NextResponse.json(
      { error: 'No macro bulletin has been generated yet', code: 'NOT_FOUND' },
      { status: 404 }
    )
  } catch (err) {
    logger.error({ err }, 'API-MACRO-BULLETIN: Failed to retrieve macro bulletin')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
