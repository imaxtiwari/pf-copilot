import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { stockDocuments } from '../../db/schema'
import { getEmbedding } from '../azure-openai'
import logger from '../logger'
import { startSpan } from '../tracing'

export type RetrievedStockChunk = {
    id: string
    isin: string
    companyName: string
    section: string
    chunkText: string
    sourceUrl: string
    documentDate: string
    lastSyncedAt: Date | null
    freshnessDays: number | null
    isStale: boolean | null
}

export async function retrieveStockChunks(
    isin: string,
    question: string,
    topK = 8,
): Promise<RetrievedStockChunk[]> {
    return startSpan(
        'rag.retrieve_stock_chunks',
        async (span) => {
            const start = Date.now()
            const vector = await getEmbedding(question)
            const vectorStr = `[${vector.join(',')}]`

            const rows = await db
                .select({
                    id: stockDocuments.id,
                    isin: stockDocuments.isin,
                    companyName: stockDocuments.companyName,
                    section: stockDocuments.section,
                    chunkText: stockDocuments.chunkText,
                    sourceUrl: stockDocuments.sourceUrl,
                    documentDate: stockDocuments.documentDate,
                    lastSyncedAt: stockDocuments.lastSyncedAt,
                    freshnessDays: stockDocuments.freshnessDays,
                    isStale: stockDocuments.isStale,
                })
                .from(stockDocuments)
                .where(eq(stockDocuments.isin, isin))
                .orderBy(sql`${stockDocuments.embedding} <=> ${vectorStr}::vector`)
                .limit(topK)

            const staleCount = rows.filter((r) => r.isStale).length
            span.setAttribute('isin', isin)
            span.setAttribute('top_k', topK)
            span.setAttribute('returned', rows.length)
            span.setAttribute('stale_count', staleCount)

            logger.info(
                { isin, topK, returned: rows.length, staleCount, durationMs: Date.now() - start },
                'rag: stock chunks retrieved',
            )

            return rows
        },
        { attributes: { isin, top_k: topK } },
    )
}
