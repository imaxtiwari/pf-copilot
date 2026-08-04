import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '../../../../lib/db'
import { casUploads, portfolioHoldings } from '../../../../db/schema'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { validateCAS, type CASHolding, type CASExtraction } from '../../../../lib/contracts/cas-validation'
import { hashFileContent } from '../../../../lib/cas/hash'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'
import logger from '../../../../lib/logger'

const ConfirmHoldingSchema = z.object({
    folio_number: z.string().min(1),
    scheme_name: z.string().min(1),
    units: z.number().positive(),
    nav: z.number().positive(),
    market_value: z.number().nonnegative(),
    scheme_code: z.string().nullable().optional(),
})

const ConfirmPayloadSchema = z.object({
    source: z.enum(['NSDL', 'CDSL']),
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    total_value_reported: z.number().nonnegative(),
    holdings: z.array(ConfirmHoldingSchema).min(1),
    hash: z.string().min(1),
})

export async function POST(req: NextRequest) {
    const { userId, isNew } = await resolveOrCreateUserId()

    let body: unknown
    try {
        body = await req.json()
    } catch {
        return NextResponse.json(err('invalid_json', 'Request body must be valid JSON'), { status: 400 })
    }

    const parsed = ConfirmPayloadSchema.safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            err('validation_error', 'Invalid confirmation payload', parsed.error.flatten()),
            { status: 400 },
        )
    }

    const data = parsed.data

    // Reconstruct extraction and run all-or-nothing validation gate
    const extraction: CASExtraction = {
        source: data.source,
        as_of_date: data.as_of_date,
        total_value_reported: data.total_value_reported,
        holdings: data.holdings as CASHolding[],
    }

    const validation = validateCAS(extraction)
    if (!validation.ok) {
        logger.warn({ userId, errors: validation.errors }, 'cas confirm: validation failed')
        return NextResponse.json(
            err('cas_validation_failed', 'Validation failed for corrected holdings', validation.errors),
            { status: 422 },
        )
    }

    // All-or-nothing: insert cas_upload + holdings in a transaction
    let uploadId: string
    try {
        await db.transaction(async (tx) => {
            const [upload] = await tx
                .insert(casUploads)
                .values({
                    userId,
                    fileHash: data.hash,
                    status: 'validated',
                    visionUsed: false,
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
                        source: 'manual' as const,
                    })),
                )
            }
        })
    } catch (e) {
        logger.error({ userId, err: e }, 'cas confirm: transaction failed')
        return NextResponse.json(
            err('db_error', 'Failed to persist holdings'),
            { status: 500 },
        )
    }

    logger.info(
        { userId, holdingsCount: extraction.holdings.length },
        'cas confirm: complete',
    )

    const response = NextResponse.json(
        ok({ holdings_count: extraction.holdings.length }),
    )
    if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
    return response
}
