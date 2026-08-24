import { NextRequest, NextResponse } from 'next/server'
import { db } from '../../../../lib/db'
import { casUploads, dematHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { parseDemat } from '../../../../lib/demat/parse'
import { getCurrentUser } from '../../../../lib/auth/dev-user'
import { unauthorizedResponse } from '@/lib/auth/errors'
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

    let buffer: Buffer | null = Buffer.from(await file.arrayBuffer())
    logger.info({ userId, sizeBytes: buffer.length }, 'demat ingest: starting')

    const result = await parseDemat(buffer, userId)
    buffer = null

    if (result.ok && result.fromCache) {
        const holdings = await db.query.dematHoldings.findMany({
            where: (h, { eq }) => eq(h.casUploadId, result.uploadId),
        })
        const response = NextResponse.json(
            ok({ holdings_count: holdings.length, from_cache: true }),
        )
        return response
    }

    if (!result.ok) {
        await db.insert(casUploads).values({
            userId,
            fileHash: result.hash,
            status: 'failed_validation',
            validationErrors: result.errors,
            visionUsed: result.source === 'vision',
        })
        logger.warn({ userId, errors: result.errors }, 'demat ingest: validation failed')
        return NextResponse.json(
            err('demat_validation_failed', 'Demat validation failed', result.errors),
            { status: 422 },
        )
    }

    const { extraction, source, hash } = result

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
                        extraction.holdings.reduce((s, h) => s + h.value, 0),
                    ),
                    rawTextPreview: JSON.stringify(extraction).slice(0, 2000),
                })
                .returning({ id: casUploads.id })
            uploadId = upload.id

            if (extraction.holdings.length > 0) {
                await tx.insert(dematHoldings).values(
                    extraction.holdings.map((h) => ({
                        userId,
                        casUploadId: uploadId,
                        isin: h.isin,
                        companyName: h.company_name,
                        quantity: String(h.quantity),
                        price: String(h.price),
                        value: String(h.value),
                        asOfDate: extraction.as_of_date,
                        source: source === 'vision' ? ('cas_vision' as const) : ('cas_text' as const),
                    })),
                )
            }
        })
    } catch (e) {
        logger.error({ userId, err: e }, 'demat ingest: transaction failed')
        return NextResponse.json(err('db_error', 'Failed to persist demat holdings'), { status: 500 })
    }

    logger.info(
        { userId, holdingsCount: extraction.holdings.length, source },
        'demat ingest: complete',
    )

    const response = NextResponse.json(
        ok({ holdings_count: extraction.holdings.length }),
    )
    return response
}
