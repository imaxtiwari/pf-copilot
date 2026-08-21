import { config } from 'dotenv'
config({ path: '.env.local' })

import { GET } from '../app/api/scheduler/route'
import { getSchedulerJobs } from '../lib/scheduler/agent-scheduler'

async function main() {
  console.log('--- STARTING SMOKE TEST FOR STEP 12 ---')

  // 1. Initial job state checks
  console.log('\n1. Checking raw job configurations in memory...')
  const initialJobs = getSchedulerJobs()
  console.log(`Total jobs registered in memory: ${initialJobs.length}`)
  initialJobs.forEach(job => {
    console.log(`- Job: "${job.name}" | Cron: "${job.cron}" | Next Run: ${job.next_run_at} | Status: ${job.last_status}`)
  })

  if (initialJobs.length !== 7) {
    throw new Error(`Expected 7 jobs, got ${initialJobs.length}`)
  }

  // 2. Call the GET handler to trigger initialization and retrieve jobs
  console.log('\n2. Calling GET() handler from API route...')
  const response = await GET()
  console.log(`Response status: ${response.status}`)
  
  const body = await response.json()
  console.log('API Response Body:')
  console.log(JSON.stringify(body, null, 2))

  if (body.status !== 'RUNNING') {
    throw new Error(`Expected status to be "RUNNING", got "${body.status}"`)
  }

  if (!body.jobs || body.jobs.length !== 7) {
    throw new Error(`Expected 7 jobs in response, got ${body.jobs?.length}`)
  }

  // Verify fields in API response
  body.jobs.forEach((job: any) => {
    if (job.last_run !== null) {
      throw new Error(`Expected initial last_run to be null, got: ${job.last_run}`)
    }
    if (!job.next_run) {
      throw new Error(`Expected next_run to be populated, got: ${job.next_run}`)
    }
    if (job.last_status !== 'PENDING') {
      throw new Error(`Expected initial last_status to be "PENDING", got: ${job.last_status}`)
    }
    // Verify ISO string format of next_run
    new Date(job.next_run)
  })

  // 3. Test singleton protection (second GET invocation)
  console.log('\n3. Invoking GET() a second time (should not re-initialize)...')
  const secondResponse = await GET()
  const secondBody = await secondResponse.json()
  console.log(`Second invocation status: ${secondResponse.status}`)
  
  if (secondBody.status !== 'RUNNING') {
    throw new Error(`Expected second status to be "RUNNING", got "${secondBody.status}"`)
  }

  console.log('\n--- SMOKE TEST SUCCESSFUL ---')
  process.exit(0)
}

main().catch(err => {
  console.error('Smoke test failed:', err)
  process.exit(1)
})
