import { config } from 'dotenv'
config({ path: '.env.local' })
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../db/schema'
import { agentMemoryStore, initQdrant } from '../lib/memory/memory-store'
import logger from '../lib/logger'

const SEED_FAULTS = [
  {
    content: "Sector Concentration > 30%: A single sector allocation exceeding 30% of the portfolio violates SEBI diversification guidelines for retail portfolios.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in/legal/circulars/oct-2017/categorization-and-rationalization-of-mutual-fund-schemes_36199.html",
    confidence_tier: 'VERIFIED' as const,
    tags: ['sector-concentration', 'diversification', 'sebi-guideline'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Single AMC Concentration > 40%: More than 40% allocated to funds from one AMC creates single-counterparty risk on AMC governance and key-person dependency.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in",
    confidence_tier: 'VERIFIED' as const,
    tags: ['amc-concentration', 'counterparty-risk', 'governance'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Fund Manager Tenure < 1 Year: Recommending a fund where the current manager has less than 1 year of tenure means backtested returns belong to a different manager.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://www.amfiindia.com/research-information/mf-data/mf-scheme-performance-details",
    confidence_tier: 'VERIFIED' as const,
    tags: ['fund-manager', 'tenure', 'backtest-validity'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Expense Ratio Active > 2%: SEBI's TER regulations cap actively managed equity fund TER at 2.25% for smaller AUMs, but recommending funds above 2% when peers offer equivalent performance below 1.5% represents poor client value.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in/legal/regulations/jun-2018/securities-and-exchange-board-of-india-mutual-funds-second-amendment-regulations-2018_39115.html",
    confidence_tier: 'VERIFIED' as const,
    tags: ['expense-ratio', 'ter', 'client-value'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "AUM Below 100 Cr for Equity: An equity fund with AUM below ₹100 Cr faces liquidity risk and potential closure by AMC.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://www.amfiindia.com",
    confidence_tier: 'VERIFIED' as const,
    tags: ['aum', 'equity-fund', 'liquidity-risk'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Fund Age < 3 Years: A fund younger than 3 years has no experience of a full market cycle (bull + bear). 1-year CAGR is subject to extreme recency bias.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in",
    confidence_tier: 'VERIFIED' as const,
    tags: ['fund-age', 'market-cycle', 'performance-history'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Portfolio Overlap > 60%: If two funds in the portfolio share >60% of their top 20 holdings, the diversification benefit is negligible — the client is effectively paying two expense ratios for one exposure.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://www.valueresearchonline.com",
    confidence_tier: 'VERIFIED' as const,
    tags: ['portfolio-overlap', 'diversification', 'holdings'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "No Debt/Hybrid in Portfolio for Goal < 5 Years: A goal with less than 5 years of time horizon invested entirely in equity exposes the client to sequence-of-returns risk.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in/legal/regulations/dec-1996/sebi-mutual-fund-regulations-1996-last-amended-on-february-01-2023-_11542.html",
    confidence_tier: 'VERIFIED' as const,
    tags: ['asset-allocation', 'short-horizon', 'sequence-risk'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "Survivorship Bias in Peer Comparison: If fund selection filters include \"only funds with 10Y returns available\", the pool excludes all funds that were closed or merged in the last 10 years, creating survivorship bias.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://www.amfiindia.com",
    confidence_tier: 'VERIFIED' as const,
    tags: ['survivorship-bias', 'peer-comparison', 'methodology'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "International Fund Without Hedging for Goal < 3 Years: An unhedged international fund allocation for a goal within 3 years exposes the client to INR/USD volatility that is unrelated to the investment thesis.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in",
    confidence_tier: 'VERIFIED' as const,
    tags: ['international-fund', 'hedging', 'currency-volatility'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "SIP Required Exceeds 40% of Stated Income: If the total monthly SIP required to achieve all goals exceeds 40% of the client's stated income, the plan is not financially feasible even before accounting for fixed expenses.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://www.rbi.org.in",
    confidence_tier: 'VERIFIED' as const,
    tags: ['sip-feasibility', 'income-ratio', 'financial-plan'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  },
  {
    content: "All-Large-Cap for Aggressive Profile with 10+ Year Horizon: A client with AGGRESSIVE risk profile and a 10+ year horizon who is allocated 100% to large-cap funds is underperforming their risk budget — mid and small caps would produce superior long-run compounding.",
    memory_type: 'ARIA_CRITIQUE_REPORT' as const,
    source_url: "https://sebi.gov.in",
    confidence_tier: 'VERIFIED' as const,
    tags: ['asset-allocation', 'risk-budget', 'aggressive-profile'],
    pipeline_run_id: '00000000-0000-0000-0000-000000000001',
  }
]

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  try {
    logger.info('Initializing Qdrant collections...')
    await initQdrant()

    logger.info(`Starting to seed ${SEED_FAULTS.length} faults into ARIA's memory...`)

    let successCount = 0
    let errorCount = 0

    for (const fault of SEED_FAULTS) {
      try {
        const summary = fault.content.substring(0, 40)
        logger.info({ tag: fault.tags[0] }, `Writing fault pattern to ARIA's memory: "${summary}..."`)
        const memoryId = await agentMemoryStore.write('ARIA', fault)
        logger.info({ tag: fault.tags[0], memoryId }, `Successfully seeded fault pattern`)
        successCount++
      } catch (error) {
        logger.error({ tag: fault.tags[0], error: String(error) }, 'Failed to seed fault pattern')
        errorCount++
      }
    }

    logger.info(
      {
        total: SEED_FAULTS.length,
        successCount,
        errorCount
      },
      "ARIA's Fault Library Seeding Completed"
    )
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  logger.error({ err: String(e) }, 'Fatal error in seeding wrapper')
  process.exit(1)
})
