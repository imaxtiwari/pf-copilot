import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { stockDocuments } from '../../db/schema'
import { getEmbedding } from '../azure-openai'
import logger from '../logger'

export type RetrievedStockChunk = {
    id: string
    isin: string
    companyName: string
    section: string
    chunkText: string
    sourceUrl: string
    documentDate: string
}

export async function retrieveStockChunks(
    isin: string,
    question: string,
    topK = 8,
): Promise<RetrievedStockChunk[]> {
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
        })
        .from(stockDocuments)
        .where(eq(stockDocuments.isin, isin))
        .orderBy(sql`${stockDocuments.embedding} <=> ${vectorStr}::vector`)
        .limit(topK)

    logger.info(
        { isin, topK, returned: rows.length, durationMs: Date.now() - start },
        'rag: stock chunks retrieved',
    )

    return rows
}
