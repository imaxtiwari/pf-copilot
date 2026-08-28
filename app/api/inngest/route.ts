import { serve } from 'inngest/next'
import { inngest } from '@/lib/jobs/client'
import { ingestionFunctions } from '@/lib/jobs/handlers/ingestion'
import { pipelineStartFunction } from '@/lib/jobs/handlers/pipeline'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...ingestionFunctions, pipelineStartFunction],
})
