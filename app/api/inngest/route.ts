import { serve } from 'inngest/next'
import { inngest } from '@/lib/jobs/client'
import { ingestionFunctions } from '@/lib/jobs/handlers/ingestion'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: ingestionFunctions,
})
