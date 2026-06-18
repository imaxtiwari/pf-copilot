import { db } from '../lib/db'
import * as schema from '../db/schema'
import { sql } from 'drizzle-orm'

async function main() {
  console.log('🔍 Querying SOMA Eligible Funds from database...')
  
  // Criteria defaults from priya.ts / soma.ts:
  // - active expense ratio <= 1.5%, index/etf expense ratio <= 0.5%
  // - equity AUM >= 500 Cr, debt/hybrid AUM >= 1000 Cr
  // - track record >= 36 months (3 years)
  
  const queryResult = await db.execute(sql`
    WITH latest_snapshots AS (
      SELECT DISTINCT ON (scheme_code) *
      FROM fund_snapshots
      ORDER BY scheme_code, snapshot_date DESC
    ),
    track_records AS (
      SELECT scheme_code, COUNT(DISTINCT DATE_TRUNC('month', snapshot_date::timestamp)) AS months
      FROM fund_snapshots
      GROUP BY scheme_code
    )
    SELECT 
      af.scheme_code,
      af.scheme_name,
      af.scheme_type,
      af.amc_name,
      ls.aum_cr::float AS aum_cr,
      ls.expense_ratio::float AS expense_ratio,
      ls.return_3y::float AS return_3y,
      ls.sharpe_3y::float AS sharpe_3y,
      COALESCE(tr.months, 0)::int AS track_record_months
    FROM agent_funds af
    LEFT JOIN latest_snapshots ls ON af.scheme_code = ls.scheme_code
    LEFT JOIN track_records tr ON af.scheme_code = tr.scheme_code
    WHERE af.is_active = true
      AND ls.aum_cr IS NOT NULL
      AND ls.expense_ratio IS NOT NULL
  `)

  const funds = queryResult.rows.map((row: any) => ({
    scheme_code: row.scheme_code,
    scheme_name: row.scheme_name,
    scheme_type: row.scheme_type,
    amc_name: row.amc_name,
    aum_cr: row.aum_cr !== null ? parseFloat(row.aum_cr) : null,
    expense_ratio: row.expense_ratio !== null ? parseFloat(row.expense_ratio) : null,
    return_3y: row.return_3y !== null ? parseFloat(row.return_3y) : null,
    sharpe_3y: row.sharpe_3y !== null ? parseFloat(row.sharpe_3y) : null,
    track_record_years: row.track_record_months / 12.0
  }))

  console.log(`Found ${funds.length} funds with snapshot metrics in database.\n`)

  // Group by category/type
  const grouped: Record<string, typeof funds> = {}
  for (const f of funds) {
    const type = f.scheme_type || 'other'
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(f)
  }

  for (const [type, list] of Object.entries(grouped)) {
    console.log(`\n=== Category: ${type.toUpperCase()} (Count: ${list.length}) ===`)
    
    // Sort by 3y return descending
    const sorted = [...list].sort((a, b) => (b.return_3y || 0) - (a.return_3y || 0))
    
    // Take top 5
    sorted.slice(0, 10).forEach(f => {
      console.log(`- ${f.scheme_name}`)
      console.log(`  AMC: ${f.amc_name} | Code: ${f.scheme_code}`)
      console.log(`  AUM: ${f.aum_cr} Cr | Expense Ratio: ${f.expense_ratio}% | 3Y Return: ${f.return_3y}% | Sharpe 3Y: ${f.sharpe_3y}`)
    })
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
