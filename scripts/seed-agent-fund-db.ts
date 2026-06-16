import { config } from 'dotenv'
config({ path: '.env.local' })

import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql, eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { getAmfiUrl } from '../lib/factsheets/fetch'
import logger from '../lib/logger'
import { WebResearchTool } from '../lib/research/web-research-tool'
import { AgentMemoryStore } from '../lib/memory/memory-store'
import { deliberationRoom } from '../lib/deliberation/deliberation-room'
import { getGpt4oMini } from '../lib/azure-openai'
import { parseAmfiDate } from './sync-amfi-master'

// Deduplicate priority list to keep runs efficient
const CONCURRENCY_LIMIT = 3
const BATCH_SIZE = 200

type SchemeRow = {
  schemeCode: string
  isin: string | null
  schemeName: string
  amcName: string
  schemeType: string
  nav: string | null
  navDate: string | null
}

function parseAmfiFile(text: string): SchemeRow[] {
  const rows: SchemeRow[] = []
  let currentAmc = 'Unknown'
  let currentType = 'Unknown'

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue

    if (/^\d{5,6};/.test(line)) {
      const parts = line.split(';')
      if (parts.length < 4) continue
      const schemeCode = parts[0].trim()
      const isin1 = parts[1]?.trim()
      const isin2 = parts[2]?.trim()
      const isin = isin1 && isin1 !== '-' ? isin1 : isin2 && isin2 !== '-' ? isin2 : null
      const schemeName = parts[3].trim()
      const nav = parts[4]?.trim() || null
      const navDate = parts[5]?.trim() || null

      if (!schemeCode || !schemeName || schemeName === 'Scheme Name') continue
      rows.push({
        schemeCode,
        isin,
        schemeName,
        amcName: currentAmc,
        schemeType: currentType,
        nav,
        navDate,
      })
      continue
    }

    if (line.startsWith('Scheme Code;')) continue

    if (/open\s+ended|close\s+ended|interval\s+fund/i.test(line)) {
      currentType = line.replace(/\(/, ' - ').replace(/\)/, '').replace(/\s{2,}/g, ' ').trim()
      continue
    }

    if (line.length >= 5 && line.length <= 120 && !line.includes(';') && !/^\d/.test(line)) {
      currentAmc = line
    }
  }

  const seen = new Map<string, SchemeRow>()
  for (const row of rows) seen.set(row.schemeCode, row)
  return Array.from(seen.values())
}

async function resolvePriorityFunds(db: any) {
  // Query all index funds containing 'nifty 50' or 'nifty next 50' with 'direct' in their name
  const indexFunds = await db
    .select()
    .from(schema.agentFunds)
    .where(
      sql`${schema.agentFunds.schemeType} = 'index' AND ${schema.agentFunds.schemeName} ILIKE '%direct%' AND (${schema.agentFunds.schemeName} ILIKE '%nifty 50%' OR ${schema.agentFunds.schemeName} ILIKE '%nifty50%' OR ${schema.agentFunds.schemeName} ILIKE '%nifty next 50%' OR ${schema.agentFunds.schemeName} ILIKE '%nifty next50%')`
    )

  // Query all ETFs
  const etfs = await db
    .select()
    .from(schema.agentFunds)
    .where(eq(schema.agentFunds.schemeType, 'etf'))

  // Define Top 10 curated actively managed direct growth plans per category
  const categories = {
    largeCap: [
      'SBI Bluechip%Direct%Growth',
      'ICICI Prudential Bluechip%Direct%Growth',
      'HDFC Top 100%Direct%Growth',
      'Nippon India Large Cap%Direct%Growth',
      'Mirae Asset Large Cap%Direct%Growth',
      'Axis Bluechip%Direct%Growth',
      'Kotak Bluechip%Direct%Growth',
      'UTI Mastershare%Direct%Growth',
      'Canara Robeco Bluechip%Direct%Growth',
      'Tata Large Cap%Direct%Growth'
    ],
    flexiCap: [
      'Parag Parikh Flexi Cap%Direct%Growth',
      'HDFC Flexi Cap%Direct%Growth',
      'Kotak Flexicap%Direct%Growth',
      'SBI Flexicap%Direct%Growth',
      'UTI Flexi Cap%Direct%Growth',
      'Franklin India Flexi Cap%Direct%Growth',
      'PGIM India Flexi Cap%Direct%Growth',
      'DSP Flexi Cap%Direct%Growth',
      'ICICI Prudential Flexicap%Direct%Growth',
      'Canara Robeco Flexi Cap%Direct%Growth'
    ],
    midCap: [
      'HDFC Mid-Cap Opportunities%Direct%Growth',
      'Kotak Emerging Equity%Direct%Growth',
      'Axis Midcap%Direct%Growth',
      'DSP Midcap%Direct%Growth',
      'SBI Magnum Midcap%Direct%Growth',
      'Nippon India Growth%Direct%Growth',
      'Mirae Asset Midcap%Direct%Growth',
      'Tata Midcap Growth%Direct%Growth',
      'UTI Mid Cap%Direct%Growth',
      'Motilal Oswal Midcap%Direct%Growth'
    ],
    smallCap: [
      'Nippon India Small Cap%Direct%Growth',
      'SBI Small Cap%Direct%Growth',
      'HDFC Small Cap%Direct%Growth',
      'Axis Small Cap%Direct%Growth',
      'Kotak Small Cap%Direct%Growth',
      'DSP Small Cap%Direct%Growth',
      'Tata Small Cap%Direct%Growth',
      'ICICI Prudential Smallcap%Direct%Growth',
      'Quant Small Cap%Direct%Growth',
      'Franklin India Smaller Companies%Direct%Growth'
    ]
  }

  const categoryFunds: any[] = []
  const allTerms = [
    ...categories.largeCap,
    ...categories.flexiCap,
    ...categories.midCap,
    ...categories.smallCap
  ]

  for (const term of allTerms) {
    const found = await db
      .select()
      .from(schema.agentFunds)
      .where(sql`${schema.agentFunds.schemeName} ILIKE ${term}`)
      .limit(1)

    if (found.length > 0) {
      categoryFunds.push(found[0])
    } else {
      // Try looser match
      const parts = term.split('%')
      const mainName = parts[0]
      const looserFound = await db
        .select()
        .from(schema.agentFunds)
        .where(sql`${schema.agentFunds.schemeName} ILIKE ${mainName + '%Direct%'} AND ${schema.agentFunds.schemeName} ILIKE '%Growth%'`)
        .limit(1)
      if (looserFound.length > 0) {
        categoryFunds.push(looserFound[0])
      } else {
        logger.warn({ term }, 'seeder: could not find matching scheme in agent_funds')
      }
    }
  }

  const seenCodes = new Set<string>()
  const combined: any[] = []

  for (const fund of [...indexFunds, ...etfs, ...categoryFunds]) {
    if (!seenCodes.has(fund.schemeCode)) {
      seenCodes.add(fund.schemeCode)
      combined.push(fund)
    }
  }

  // Cap at 100 priority funds as requested
  return combined.slice(0, 100)
}

async function fetchExtendedMetricsAndCompositions(
  fund: any,
  researchTool: WebResearchTool,
  db: any
) {
  // Query factsheet chunks first
  const chunks = await db
    .select({ chunkText: schema.factsheetChunks.chunkText, sourceUrl: schema.factsheetChunks.sourceUrl })
    .from(schema.factsheetChunks)
    .where(eq(schema.factsheetChunks.schemeCode, fund.schemeCode))

  let factsheetText = ''
  let compositionSourceUrl = 'Factsheet Chunks'
  if (chunks.length > 0) {
    factsheetText = chunks.map((c: any) => c.chunkText).join('\n')
    compositionSourceUrl = chunks[0].sourceUrl
  }

  // Tavily research for metrics
  let searchMetricsResults: any[] = []
  try {
    searchMetricsResults = await researchTool.research({
      query_text: `"${fund.schemeName}" latest AUM, expense ratio, 1Y 3Y 5Y annual returns`,
      intent: 'fetch_extended_metrics',
      freshness_required_days: 7,
      max_sources: 3,
      memory_type: 'SOMA_FUND_RESEARCH'
    })
  } catch (err) {
    logger.warn({ fundId: fund.schemeCode, err }, 'Failed to fetch metrics search results')
  }

  // Tavily research for composition if no factsheet in database
  let searchCompositionText = factsheetText
  if (!factsheetText) {
    try {
      const compResults = await researchTool.research({
        query_text: `"${fund.schemeName}" top 10 holdings portfolio allocation sector distribution`,
        intent: 'fetch_holdings_composition',
        freshness_required_days: 30,
        max_sources: 3,
        memory_type: 'SOMA_FUND_COMPOSITION'
      })
      if (compResults.length > 0) {
        searchCompositionText = compResults.map(r => r.content_snippet).join('\n')
        compositionSourceUrl = compResults[0].url
      }
    } catch (err) {
      logger.warn({ fundId: fund.schemeCode, err }, 'Failed to fetch composition search results')
    }
  }

  const gpt = getGpt4oMini()
  const contentForExtraction = `
Search results for metrics:
${searchMetricsResults.map(r => `Source: ${r.url}\nContent: ${r.content_snippet}`).join('\n\n')}

Search/Factsheet results for portfolio composition:
${searchCompositionText}
  `

  const prompt = `
Extract mutual fund details for "${fund.schemeName}" (Scheme Code: ${fund.schemeCode}) from the search results/factsheet.
Return a valid JSON object ONLY. Do not include markdown code block formatting or backticks.

JSON schema:
{
  "aum_cr": number or null,              // AUM in INR Crores (numeric only, e.g. 15430.5)
  "expense_ratio": number or null,       // Expense ratio in % (numeric only, e.g. 0.72)
  "return_1y": number or null,           // 1Y annualized return in % (numeric only, e.g. 15.4)
  "return_3y": number or null,           // 3Y annualized return in % (numeric only, e.g. 18.2)
  "return_5y": number or null,           // 5Y annualized return in % (numeric only, e.g. 16.1)
  "holdings": [                          // Top 10 holdings
    {
      "company": string,
      "allocation_pct": number           // Allocation percentage (numeric only, e.g. 8.2)
    }
  ] | null,
  "top_10_concentration_pct": number or null, // sum of top 10 holdings percentages
  "sector_distribution": {               // Sector allocation percentages
    "Sector Name": number                // e.g. "Financial Services": 24.5
  } | null
}
`

  let parsed: any = null
  let extractedSourceUrl = searchMetricsResults[0]?.url || getAmfiUrl()

  try {
    const response = await gpt.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert financial data extractor. You return strict JSON.' },
        { role: 'user', content: prompt + `\n\nSource Data:\n${contentForExtraction}` }
      ],
      temperature: 0,
    })

    const text = response.choices[0]?.message?.content?.trim() || ''
    const cleanJson = text.replace(/^```json/, '').replace(/```$/, '').trim()
    parsed = JSON.parse(cleanJson)
  } catch (err) {
    logger.error({ fundId: fund.schemeCode, err }, 'Failed to extract metrics/composition using LLM')
  }

  return {
    metrics: parsed,
    metricsSourceUrl: extractedSourceUrl,
    compositionSourceUrl
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool, { schema })

  const url = getAmfiUrl()
  logger.info({ url }, 'seeder: fetching NAV file')

  const res = await fetch(url)
  if (!res.ok) {
    logger.error({ status: res.status, url }, 'seeder: HTTP error')
    await pool.end()
    process.exit(1)
  }
  const text = await res.text()
  const rows = parseAmfiFile(text)
  if (rows.length === 0) {
    logger.error('seeder: no rows parsed')
    await pool.end()
    process.exit(1)
  }

  // 1. Resolve top 100 priority funds
  logger.info('seeder: resolving priority funds...')
  const priorityFundsRaw = await resolvePriorityFunds(db)
  const priorityCodes = new Set(priorityFundsRaw.map(f => f.schemeCode))
  logger.info(`seeder: resolved ${priorityFundsRaw.length} priority funds.`)

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  // Filter parsed rows into priority and other
  const priorityRows = rows.filter(r => priorityCodes.has(r.schemeCode))
  const otherRows = rows.filter(r => !priorityCodes.has(r.schemeCode))

  let seededSnapshots = 0
  let seededCompositions = 0
  const incompleteFunds: string[] = []

  // 2. Batch-insert snapshots for other (non-priority) funds
  logger.info(`seeder: batch-inserting snapshots for ${otherRows.length} non-priority funds...`)
  for (let i = 0; i < otherRows.length; i += BATCH_SIZE) {
    const batch = otherRows.slice(i, i + BATCH_SIZE)
    const snapshotsBatch = batch
      .map((r) => {
        const navNum = parseFloat(r.nav || '')
        const formattedDate = r.navDate ? parseAmfiDate(r.navDate) : null
        if (isNaN(navNum) || !formattedDate) return null
        return {
          schemeCode: r.schemeCode,
          snapshotDate: formattedDate,
          nav: navNum.toString(),
          sourceUrl: url,
          retrievedAt: now,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)

    if (snapshotsBatch.length > 0) {
      await db.insert(schema.fundSnapshots).values(snapshotsBatch).onConflictDoNothing()
      seededSnapshots += snapshotsBatch.length
    }
  }

  // 3. Process priority funds sequentially or with limited concurrency
  logger.info(`seeder: processing extended metrics for ${priorityRows.length} priority funds...`)
  const memoryStore = new AgentMemoryStore()
  const researchTool = new WebResearchTool('SOMA', memoryStore, deliberationRoom)

  for (let i = 0; i < priorityRows.length; i += CONCURRENCY_LIMIT) {
    const batch = priorityRows.slice(i, i + CONCURRENCY_LIMIT)
    await Promise.all(
      batch.map(async (r) => {
        try {
          const result = await fetchExtendedMetricsAndCompositions(r, researchTool, db)
          const metrics = result.metrics

          const isMetricsIncomplete =
            !metrics ||
            metrics.aum_cr === null ||
            metrics.expense_ratio === null ||
            metrics.return_1y === null

          const isCompositionIncomplete =
            !metrics ||
            !metrics.holdings ||
            metrics.holdings.length === 0

          if (isMetricsIncomplete || isCompositionIncomplete) {
            incompleteFunds.push(r.schemeCode)
          }

          // Insert combined snapshot into fund_snapshots
          const navNum = parseFloat(r.nav || '0')
          const formattedDate = r.navDate ? parseAmfiDate(r.navDate) : todayStr
          const snapshotValues = {
            schemeCode: r.schemeCode,
            snapshotDate: formattedDate || todayStr,
            nav: isNaN(navNum) ? '0' : navNum.toString(),
            aumCr: metrics?.aum_cr?.toString() || null,
            expenseRatio: metrics?.expense_ratio?.toString() || null,
            return1y: metrics?.return_1y?.toString() || null,
            return3y: metrics?.return_3y?.toString() || null,
            return5y: metrics?.return_5y?.toString() || null,
            sourceUrl: result.metricsSourceUrl,
            retrievedAt: now,
          }

          await db.insert(schema.fundSnapshots).values(snapshotValues).onConflictDoNothing()
          seededSnapshots++

          // Insert composition if extracted
          if (metrics?.holdings && metrics.holdings.length > 0) {
            const compositionValues = {
              schemeCode: r.schemeCode,
              compositionDate: formattedDate || todayStr,
              holdings: metrics.holdings,
              top10ConcentrationPct: metrics.top_10_concentration_pct?.toString() || null,
              sectorDistribution: metrics.sector_distribution || null,
              sourceUrl: result.compositionSourceUrl,
              retrievedAt: now,
            }
            await db.insert(schema.fundCompositions).values(compositionValues)
            seededCompositions++
          }
        } catch (e) {
          logger.error({ fundId: r.schemeCode, err: String(e) }, 'seeder: failed to seed priority fund')
          incompleteFunds.push(r.schemeCode)
        }
      })
    )
    logger.info(`seeder: processed ${Math.min(i + CONCURRENCY_LIMIT, priorityRows.length)} / ${priorityRows.length} priority funds`)
  }

  // 4. Retrieve total active agent_funds count
  const agentFundsCount = await db.$count(schema.agentFunds)

  console.log(`Seeded: [${agentFundsCount}] agent_funds, [${seededSnapshots}] fund_snapshots, [${seededCompositions}] fund_compositions.`)
  if (incompleteFunds.length > 0) {
    console.log(`Incomplete data for: [${incompleteFunds.join(', ')}]`)
  } else {
    console.log('Incomplete data for: []')
  }

  await pool.end()
}

if (require.main === module) {
  main().catch((e) => {
    logger.error({ err: String(e) }, 'seeder: fatal error')
    process.exit(1)
  })
}
