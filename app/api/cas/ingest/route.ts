import { NextRequest, NextResponse } from 'next/server'
import { db } from '../../../../lib/db'
import { casUploads, portfolioHoldings, driftReports, chatMessages } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { parseCAS } from '../../../../lib/cas/parse'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'
import { and, eq, desc } from 'drizzle-orm'
import { detectDrift } from '../../../../lib/cas/drift-detector'
import logger from '../../../../lib/logger'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const { userId, isNew } = await resolveOrCreateUserId()

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
      where: (h: any, { eq }: any) => eq(h.casUploadId, result.uploadId),
    })
    const response = NextResponse.json(
      ok({ holdings_count: holdings.length, unmatched_schemes: [], from_cache: true }),
    )
    if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
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

  // Fetch previous validated upload and holdings before inserting the new one
  const [previousUpload] = await db
    .select()
    .from(casUploads)
    .where(
      and(
        eq(casUploads.userId, userId),
        eq(casUploads.status, 'validated')
      )
    )
    .orderBy(desc(casUploads.uploadedAt))
    .limit(1)

  let previousHoldings: any[] = []
  if (previousUpload) {
    previousHoldings = await db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.casUploadId, previousUpload.id))
  }

  // All-or-nothing: insert cas_upload + holdings in a transaction
  let uploadId: string
  try {
    await db.transaction(async (tx: any) => {
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

  // Calculate portfolio drift
  try {
    const newHoldings = extraction.holdings.map((h) => ({
      userId,
      schemeName: h.scheme_name,
      schemeCode: h.scheme_code ?? null,
      folioNumber: h.folio_number,
      units: String(h.units),
      nav: String(h.nav),
      marketValue: String(h.market_value),
      asOfDate: extraction.as_of_date,
    }))

    const driftReport = await detectDrift(previousHoldings, newHoldings)

    // Save drift report
    await db.insert(driftReports).values({
      userId,
      previousCasUploadId: previousUpload ? previousUpload.id : null,
      currentCasUploadId: uploadId!,
      report: driftReport,
      generatedAt: new Date(),
    })

    // If rebalancing is needed, create a chat notification
    if (driftReport.driftFromRecommendation?.rebalancingNeeded) {
      await db.insert(chatMessages).values({
        userId,
        role: 'assistant',
        content: `⚠️ Rebalancing Needed: Your portfolio allocation has drifted from your approved plan. Urgency: ${driftReport.driftFromRecommendation.rebalancingUrgency}. Please check the portfolio page for details.`,
        ts: new Date(),
      })
      logger.info({ userId }, 'cas ingest: created rebalance chat notification')
    }
  } catch (err) {
    logger.error({ userId, err }, 'cas ingest: drift detection or notification failed')
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
  if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
  return response
}
