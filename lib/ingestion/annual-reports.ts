import logger from '../logger'
import type { DbClient } from '../db'

export type IngestAnnualReportsResult = {
  message: string
}

/**
 * Placeholder for annual-report / stock-document ingestion.
 * When implemented, this should fetch BSE announcements / annual reports,
 * chunk them, embed, and insert into stock_documents.
 */
export async function ingestAnnualReports(_db: DbClient): Promise<IngestAnnualReportsResult> {
  logger.info('ingest.annualReports: placeholder — no-op')
  return { message: 'annual report ingestion not yet implemented' }
}
