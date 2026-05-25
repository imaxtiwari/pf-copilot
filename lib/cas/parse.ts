import { and, eq, gt } from 'drizzle-orm'
import { db } from '../db'
import { casUploads } from '../../db/schema'
import { hashFileContent } from './hash'
import { parseCASText } from './parse-text'
import { parseCASVision } from './parse-vision'
import { validateCAS } from '../contracts/cas-validation'
import { crossCheckSchemes } from './amfi-master'
import type { CASExtraction } from '../contracts/cas-validation'
import type { SchemeCheckResult } from './amfi-master'
import logger from '../logger'

export type ParseResult =
  | {
      ok: true
      extraction: CASExtraction
      source: 'text' | 'vision'
      schemeCheck: SchemeCheckResult
      hash: string
      fromCache?: false
    }
  | { ok: true; fromCache: true; uploadId: string; hash: string }
  | { ok: false; errors: string[]; source: 'text' | 'vision' | 'none'; hash: string }

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000

export async function parseCAS(buffer: Buffer, userId: string): Promise<ParseResult> {
  const hash = hashFileContent(buffer)

  const recent = await db.query.casUploads.findFirst({
    where: and(
      eq(casUploads.userId, userId),
      eq(casUploads.fileHash, hash),
      gt(casUploads.uploadedAt, new Date(Date.now() - IDEMPOTENCY_WINDOW_MS)),
    ),
  })
  if (recent && recent.status === 'validated') {
    logger.info({ uploadId: recent.id, hash }, 'cas: returning cached result')
    return { ok: true, fromCache: true, uploadId: recent.id, hash }
  }

  // Text extraction path
  const textResult = await parseCASText(buffer)
  if (textResult) {
    const validation = validateCAS(textResult)
    if (validation.ok) {
      const schemeCheck = await crossCheckSchemes(
        validation.extraction.holdings.map((h) => h.scheme_name),
      )
      return { ok: true, extraction: validation.extraction, source: 'text', schemeCheck, hash }
    }
    logger.info({ errors: validation.errors }, 'cas: text extraction failed validation')
  }

  // Vision fallback
  logger.info({ hash }, 'cas: falling back to vision extraction')
  const visionResult = await parseCASVision(buffer)
  if (visionResult) {
    const validation = validateCAS(visionResult)
    if (validation.ok) {
      const schemeCheck = await crossCheckSchemes(
        validation.extraction.holdings.map((h) => h.scheme_name),
      )
      return { ok: true, extraction: validation.extraction, source: 'vision', schemeCheck, hash }
    }
    return { ok: false, errors: validation.errors, source: 'vision', hash }
  }

  return { ok: false, errors: ['Both text and vision extraction failed'], source: 'none', hash }
}
