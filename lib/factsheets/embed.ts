import { AzureOpenAI } from 'openai'
import type { Chunk } from './chunk'
import logger from '../logger'

const RATE_LIMIT_DELAY_MS = 200

function makeEmbeddingClient(): AzureOpenAI {
  return new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    apiKey: process.env.AZURE_OPENAI_API_KEY!,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-08-01-preview',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING!,
    timeout: 30_000,
    maxRetries: 2,
  })
}

async function embedText(client: AzureOpenAI, text: string): Promise<number[]> {
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_EMBEDDING!
  const res = await client.embeddings.create({ model: deployment, input: text })
  return res.data[0].embedding
}

export type EmbedAndInsertArgs = {
  schemeCode: string
  schemeName: string
  sourceUrl: string
  factsheetDate: string // YYYY-MM-DD
  chunks: Chunk[]
  // db and factsheetChunks table passed in to avoid module-level pool init
  db: any
  factsheetChunksTable: any
}

export type EmbedResult = {
  inserted: number
  skipped: number
  errors: number
}

export async function embedAndInsert(args: EmbedAndInsertArgs): Promise<EmbedResult> {
  const { schemeCode, schemeName, sourceUrl, factsheetDate, chunks, db, factsheetChunksTable } = args
  const client = makeEmbeddingClient()
  let inserted = 0
  let skipped = 0
  let errors = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      const embedding = await embedText(client, chunk.text)

      if (embedding.length !== 3072) {
        logger.warn({ schemeCode, section: chunk.section, dims: embedding.length }, 'unexpected embedding dimensions')
        errors++
        continue
      }

      const result = await db
        .insert(factsheetChunksTable)
        .values({
          schemeCode,
          schemeName,
          section: chunk.section,
          chunkText: chunk.text,
          embedding,
          sourceUrl,
          factsheetDate,
        })
        .onConflictDoNothing()

      if (result.rowCount && result.rowCount > 0) {
        inserted++
      } else {
        skipped++
      }
    } catch (e) {
      logger.error({ schemeCode, section: chunk.section, chunkIndex: i, err: String(e) }, 'embed/insert failed')
      errors++
    }

    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS))
    }
  }

  return { inserted, skipped, errors }
}
