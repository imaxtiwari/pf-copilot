import { NextResponse } from 'next/server'
import { startAgentScheduler, getSchedulerJobs } from '@/lib/scheduler/agent-scheduler'
import { Dhruv } from '@/lib/agents/dhruv'
import { Kiran } from '@/lib/agents/kiran'
import { Soma } from '@/lib/agents/soma'
import { Aria } from '@/lib/agents/aria'
import { Vikram } from '@/lib/agents/vikram'
import { Priya } from '@/lib/agents/priya'
import { deliberationRoom } from '@/lib/deliberation/deliberation-room'
import { agentMemoryStore } from '@/lib/memory/memory-store'
import { WebResearchTool } from '@/lib/research/web-research-tool'
import { db } from '@/lib/db'
import logger from '@/lib/logger'

declare global {
  var __schedulerStarted: boolean | undefined
}

export async function GET() {
  if (!globalThis.__schedulerStarted) {
    logger.info('API-SCHEDULER: Initializing global agent scheduler singleton')

    try {
      const somaResearchTool = new WebResearchTool('SOMA', agentMemoryStore, deliberationRoom)
      const kiranResearchTool = new WebResearchTool('KIRAN', agentMemoryStore, deliberationRoom)
      const vikramResearchTool = new WebResearchTool('VIKRAM', agentMemoryStore, deliberationRoom)
      const ariaResearchTool = new WebResearchTool('ARIA', agentMemoryStore, deliberationRoom)
      const priyaResearchTool = new WebResearchTool('PRIYA', agentMemoryStore, deliberationRoom)
      const dhruvResearchTool = new WebResearchTool('DHRUV', agentMemoryStore, deliberationRoom)

      const soma = new Soma(deliberationRoom, agentMemoryStore, somaResearchTool, db)
      const kiran = new Kiran(deliberationRoom, agentMemoryStore, kiranResearchTool, db)
      const vikram = new Vikram(deliberationRoom, agentMemoryStore, vikramResearchTool, db)
      const aria = new Aria(deliberationRoom, agentMemoryStore, ariaResearchTool, db)
      const priya = new Priya(deliberationRoom, agentMemoryStore, priyaResearchTool, db)
      const dhruv = new Dhruv(deliberationRoom, agentMemoryStore, dhruvResearchTool, db)

      startAgentScheduler({ dhruv, kiran, soma, aria, vikram, priya })
      globalThis.__schedulerStarted = true
      logger.info('API-SCHEDULER: Global agent scheduler started successfully')
    } catch (err) {
      logger.error({ err }, 'API-SCHEDULER: Failed to start agent scheduler')
      return NextResponse.json({ status: 'ERROR', error: String(err) }, { status: 500 })
    }
  }

  const jobs = getSchedulerJobs().map(j => ({
    name: j.name,
    cron: j.cron,
    last_run: j.last_run_at,
    next_run: j.next_run_at,
    last_status: j.last_status
  }))

  return NextResponse.json({
    status: 'RUNNING',
    jobs
  })
}
