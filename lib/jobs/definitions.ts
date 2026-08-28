import { z } from 'zod'

/**
 * Job/event definitions.
 *
 * The DHRUV recommendation pipeline jobs (pipeline.phase1, pipeline.deliberation,
 * pipeline.finalize) are intentionally omitted: the project currently runs Option A
 * (chat-first tool-calling) and the pipeline schema was removed. These event schemas
 * can be added here when/if Option B is revived.
 */

export const IngestionJobType = {
  AMFI: 'ingest.amfi',
  FACTSHEETS: 'ingest.factsheets',
  ANNUAL_REPORTS: 'ingest.annualReports',
} as const

export const IngestAmfiPayloadSchema = z.object({
  force: z.boolean().optional(),
})

export const IngestFactsheetsPayloadSchema = z.object({
  force: z.boolean().optional(),
})

export const IngestAnnualReportsPayloadSchema = z.object({
  force: z.boolean().optional(),
})

export const ingestionPayloadSchemas = {
  [IngestionJobType.AMFI]: IngestAmfiPayloadSchema,
  [IngestionJobType.FACTSHEETS]: IngestFactsheetsPayloadSchema,
  [IngestionJobType.ANNUAL_REPORTS]: IngestAnnualReportsPayloadSchema,
}

export type IngestionJobPayloadMap = {
  [IngestionJobType.AMFI]: z.infer<typeof IngestAmfiPayloadSchema>
  [IngestionJobType.FACTSHEETS]: z.infer<typeof IngestFactsheetsPayloadSchema>
  [IngestionJobType.ANNUAL_REPORTS]: z.infer<typeof IngestAnnualReportsPayloadSchema>
}

export const PipelineJobType = {
  PIPELINE_START: 'pipeline.start',
} as const

export const PipelineStartPayloadSchema = z.object({
  userId: z.string().uuid(),
  uploadId: z.string().uuid(),
})

export const pipelinePayloadSchemas = {
  [PipelineJobType.PIPELINE_START]: PipelineStartPayloadSchema,
}

export type PipelineJobPayloadMap = {
  [PipelineJobType.PIPELINE_START]: z.infer<typeof PipelineStartPayloadSchema>
}
