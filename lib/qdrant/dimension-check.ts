import { POLICY } from '@/lib/config/policy'
import logger from '@/lib/logger'

export type QdrantCollectionInfo = {
  name: string
  vectorSize: number
}

export type DimensionCheckResult =
  | { ok: true }
  | { ok: false; mismatches: Array<{ collection: string; expected: number; actual: number }> }

async function fetchCollectionInfo(qdrantUrl: string, collectionName: string): Promise<QdrantCollectionInfo | null> {
  try {
    const res = await fetch(`${qdrantUrl}/collections/${collectionName}`, { method: 'GET' })
    if (!res.ok) return null
    const body = (await res.json()) as {
      result?: {
        config?: {
          params?: {
            vectors?: {
              size?: number
            }
          }
        }
      }
    }
    const size = body.result?.config?.params?.vectors?.size
    if (typeof size !== 'number') return null
    return { name: collectionName, vectorSize: size }
  } catch {
    return null
  }
}

/**
 * Verifies that configured Qdrant collections use the expected embedding dimension.
 *
 * If `QDRANT_URL` is not set, the check is skipped (returns ok). If a configured
 * collection cannot be reached, it is treated as a mismatch so the health probe
 * can surface it.
 */
export async function validateQdrantDimension(
  qdrantUrl?: string,
  expectedDimension = POLICY.qdrant.embeddingDimension,
  collections = POLICY.qdrant.collections,
): Promise<DimensionCheckResult> {
  if (!qdrantUrl || collections.length === 0) {
    return { ok: true }
  }

  const mismatches: Array<{ collection: string; expected: number; actual: number }> = []

  for (const collection of collections) {
    const info = await fetchCollectionInfo(qdrantUrl, collection)
    if (!info) {
      mismatches.push({ collection, expected: expectedDimension, actual: -1 })
      logger.error({ collection, expectedDimension }, 'qdrant: unable to read collection info')
      continue
    }
    if (info.vectorSize !== expectedDimension) {
      mismatches.push({ collection, expected: expectedDimension, actual: info.vectorSize })
    }
  }

  if (mismatches.length > 0) {
    logger.error({ mismatches }, 'qdrant: embedding dimension mismatch detected')
    return { ok: false, mismatches }
  }

  logger.info({ collections, expectedDimension }, 'qdrant: embedding dimension check passed')
  return { ok: true }
}
