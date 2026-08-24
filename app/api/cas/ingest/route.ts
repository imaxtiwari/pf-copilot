import { NextRequest, NextResponse } from 'next/server'
import { db } from '../../../../lib/db'
import { casUploads, portfolioHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { parseCAS } from '../../../../lib/cas/parse'
import { getCurrentUser } from '../../../../lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'
import { refreshSnapshots } from '../../../../lib/portfolio/snapshots'
import { generateInsight, persistInsight } from '../../../../lib/portfolio/insights'
import logger from '../../../../lib/logger'
import { rateLimit, rateLimitJsonResponse } from '../../../../lib/rate-limit'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return unauthorizedResponse()
  const userId = user.userId

  // Per-user upload rate limit: 5 CAS/Demat uploads per hour.
  const uploadLimit = await rateLimit(req, { key: 'upload:user', limit: 5, window: 3600, identifier: `user:${userId}` })
  if (!uploadLimit.success) {
    return rateLimitJsonResponse(uploadLimit)
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(err('invalid_content_type', 'Expected multipart/form-data'), { status: 400 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(err('invalid_form', 'Could not parse form data'), { status: 400 })
  }

  const fileField = formData.get('file')
  if (!fileField || typeof fileField === 'string') {
    return NextResponse.json(err('missing_file', 'file field is required'), { status: 400 })
  }

  const file = fileField as File
  if (file.type !== 'application/pdf') {
    return NextResponse.json(err('invalid_file_type', 'Only PDF files are accepted'), { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(err('file_too_large', `File exceeds 10 MB limit`), { status: 413 })
  }

  // Read into memory — buffer never touches disk
  let buffer: Buffer | null = Buffer.from(await file.arrayBuffer())

  logger.info({ userId, sizeBytes: buffer.length }, 'cas ingest: starting')

  const result = await parseCAS(buffer, userId)

  // Free buffer immediately after parse — memory-only guarantee
  buffer = null

  if (result.ok && result.fromCache) {
    const holdings = await db.query.portfolioHoldings.findMany({
      where: (h, { eq }) => eq(h.casUploadId, result.uploadId),
    })
    const response = NextResponse.json(
      ok({ holdings_count: holdings.length, unmatched_schemes: [], from_cache: true }),
    )
    return response
  }

  if (!result.ok) {
    // Record failure — no holdings written
    await db.insert(casUploads).values({
      userId,
      fileHash: result.hash,
      status: 'failed_validation',
      validationErrors: result.errors,
      visionUsed: result.source === 'vision',
    })
    logger.warn({ userId, errors: result.errors }, 'cas ingest: validation failed')
    return NextResponse.json(
      err('cas_validation_failed', 'CAS validation failed', result.errors),
      { status: 422 },
    )
  }

  const { extraction, source, schemeCheck, hash } = result

  // All-or-nothing: insert cas_upload + holdings in a transaction
  let uploadId = ''
  try {
    await db.transaction(async (tx) => {
      const [upload] = await tx
        .insert(casUploads)
        .values({
          userId,
          fileHash: hash,
          status: 'validated',
          visionUsed: source === 'vision',
          totalValueReported: String(extraction.total_value_reported),
          totalValueComputed: String(
            extraction.holdings.reduce((s, h) => s + h.market_value, 0),
          ),
          rawTextPreview: JSON.stringify(extraction).slice(0, 2000),
        })
        .returning({ id: casUploads.id })
      uploadId = upload.id

      if (extraction.holdings.length > 0) {
        await tx.insert(portfolioHoldings).values(
          extraction.holdings.map((h) => ({
            userId,
            casUploadId: uploadId,
            schemeName: h.scheme_name,
            schemeCode: h.scheme_code ?? null,
            folioNumber: h.folio_number,
            units: String(h.units),
            nav: String(h.nav),
            marketValue: String(h.market_value),
            asOfDate: extraction.as_of_date,
            source: source === 'vision' ? ('cas_vision' as const) : ('cas_text' as const),
          })),
        )
      }
    })
  } catch (e) {
    logger.error({ userId, err: e }, 'cas ingest: transaction failed')
    return NextResponse.json(
      err('db_error', 'Failed to persist holdings'),
      { status: 500 },
    )
  }

  // Build portfolio snapshots for the new/updated holdings
  try {
    await refreshSnapshots(userId)
  } catch (e) {
    logger.warn({ userId, err: e }, 'cas ingest: snapshot refresh failed')
  }

  // Generate a deterministic educational insight tied to this upload
  try {
    const insight = await generateInsight({ userId, uploadId })
    await persistInsight(insight)
  } catch (e) {
    logger.warn({ userId, uploadId, err: e }, 'cas ingest: insight generation failed')
  }

  logger.info(
    { userId, holdingsCount: extraction.holdings.length, source, unmatched: schemeCheck.unmatched.length },
    'cas ingest: complete',
  )

  const response = NextResponse.json(
    ok({
      holdings_count: extraction.holdings.length,
      unmatched_schemes: schemeCheck.unmatched,
    }),
  )
  return response
}
