import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { err } from '@/lib/contracts/error-envelope'

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    err('unauthorized', 'Authentication required. Please sign in.', undefined, randomUUID()),
    { status: 401 },
  )
}

export function forbiddenResponse(): NextResponse {
  return NextResponse.json(
    err('forbidden', 'You do not have permission to access this resource.', undefined, randomUUID()),
    { status: 403 },
  )
}
