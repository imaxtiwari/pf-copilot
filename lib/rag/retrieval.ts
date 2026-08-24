import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { factsheetChunks } from '../../db/schema'
import { getEmbedding } from '../azure-openai'
import logger from '../logger'
import { startSpan } from '../tracing'

export type RetrievedChunk = {
  id: string
  schemeCode: string
  schemeName: string
  section: string
  chunkText: string
  sourceUrl: string
  factsheetDate: string
  lastSyncedAt: Date | null
  freshnessDays: number | null
  isStale: boolean | null
}

export async function retrieveChunks(
  schemeCode: string,
  question: string,
  topK = 8,
): Promise<RetrievedChunk[]> {
  return startSpan(
    'rag.retrieve_chunks',
    async (span) => {
      const start = Date.now()
      const vector = await getEmbedding(question)
      const vectorStr = `[${vector.join(',')}]`

      // Cosine distance via pgvector <=> operator, HNSW index on embedding (vector_cosine_ops)
      // $1 is the vector string; ::vector cast tells pg to parse it
      const rows = await db
        .select({
          id: factsheetChunks.id,
          schemeCode: factsheetChunks.schemeCode,
          schemeName: factsheetChunks.schemeName,
          section: factsheetChunks.section,
          chunkText: factsheetChunks.chunkText,
          sourceUrl: factsheetChunks.sourceUrl,
          factsheetDate: factsheetChunks.factsheetDate,
          lastSyncedAt: factsheetChunks.lastSyncedAt,
          freshnessDays: factsheetChunks.freshnessDays,
          isStale: factsheetChunks.isStale,
        })
        .from(factsheetChunks)
        .where(eq(factsheetChunks.schemeCode, schemeCode))
        .orderBy(sql`${factsheetChunks.embedding} <=> ${vectorStr}::vector`)
        .limit(topK)

      const staleCount = rows.filter((r) => r.isStale).length
      span.setAttribute('scheme_code', schemeCode)
      span.setAttribute('top_k', topK)
      span.setAttribute('returned', rows.length)
      span.setAttribute('stale_count', staleCount)

      logger.info(
        { schemeCode, topK, returned: rows.length, staleCount, durationMs: Date.now() - start },
        'rag: chunks retrieved',
      )

      return rows
    },
    { attributes: { scheme_code: schemeCode, top_k: topK } },
  )
}
