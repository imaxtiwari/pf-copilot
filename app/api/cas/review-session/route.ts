import { NextRequest, NextResponse } from 'next/server'
import { ok, err } from '../../../../lib/contracts/error-envelope'
import { createReviewSession } from '../../../../lib/cas/review-session'
import { resolveOrCreateUserId, COOKIE_NAME, cookieOptions } from '../../../../lib/auth/dev-user'
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
    logger.info({ userId, sizeBytes: buffer.length }, 'cas review-session: starting')

    const session = await createReviewSession(buffer)

    // Free buffer immediately after extraction — memory-only guarantee
    buffer = null

    if (!session.ok) {
        logger.warn({ userId, errors: session.errors }, 'cas review-session: extraction failed')
        return NextResponse.json(
            err('cas_review_failed', 'Could not extract holdings from PDF', session.errors),
            { status: 422 },
        )
    }

    const response = NextResponse.json(
        ok({
            extraction: session.extraction,
            thumbnails: session.thumbnails,
            confidence: session.confidence,
            unmatched_schemes: session.schemeCheck.unmatched,
            hash: session.hash,
        }),
    )
    if (isNew) response.cookies.set(COOKIE_NAME, userId, cookieOptions())
    return response
}
