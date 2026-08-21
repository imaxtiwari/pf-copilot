import { db } from '../db'
import { casUploads } from '../../db/schema'
import { hashFileContent } from '../cas/hash'
import { parseDematText } from './parse-text'
import { parseDematVision } from './parse-vision'
import { validateDemat } from '../contracts/demat-validation'
import type { DematExtraction } from '../contracts/demat-validation'
import logger from '../logger'

export type ParseResult =
    | {
        ok: true
        extraction: DematExtraction
        source: 'text' | 'vision'
        hash: string
        fromCache?: false
    }
    | { ok: true; fromCache: true; uploadId: string; hash: string }
    | { ok: false; errors: string[]; source: 'text' | 'vision' | 'none'; hash: string }

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000

export async function parseDemat(buffer: Buffer, userId: string): Promise<ParseResult> {
    const hash = hashFileContent(buffer)

    const recent = await db.query.casUploads.findFirst({
        where: (u, { and, eq, gt }) =>
            and(
                eq(u.userId, userId),
                eq(u.fileHash, hash),
                gt(u.uploadedAt, new Date(Date.now() - IDEMPOTENCY_WINDOW_MS)),
            ),
    })
    if (recent && recent.status === 'validated') {
        logger.info({ uploadId: recent.id, hash }, 'demat: returning cached result')
        return { ok: true, fromCache: true, uploadId: recent.id, hash }
    }

    const textResult = await parseDematText(buffer)
    if (textResult) {
        const validation = validateDemat(textResult)
        if (validation.ok) {
            return { ok: true, extraction: validation.extraction, source: 'text', hash }
        }
        logger.info({ errors: validation.errors }, 'demat: text extraction failed validation')
    }

    logger.info({ hash }, 'demat: falling back to vision extraction')
    const visionResult = await parseDematVision(buffer)
    if (visionResult) {
        const validation = validateDemat(visionResult)
        if (validation.ok) {
            return { ok: true, extraction: validation.extraction, source: 'vision', hash }
        }
        return { ok: false, errors: validation.errors, source: 'vision', hash }
    }

    return { ok: false, errors: ['Both text and vision extraction failed'], source: 'none', hash }
}
