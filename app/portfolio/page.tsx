import { cookies } from 'next/headers'
import { eq, desc, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@/lib/db'
import * as schema from '@/db/schema'
import { COOKIE_NAME } from '@/lib/auth/dev-user'
import { computeRealReturns } from '@/lib/inflation/real-returns'
import { computePersonalInflation } from '@/lib/inflation/compute'
import { RealVsNominal } from '@/components/real-vs-nominal'
import { PortfolioTable } from '@/components/portfolio-table'
import { PortfolioTimelineChart } from '@/components/portfolio-timeline-chart'
import { PortfolioAllocationChart } from '@/components/portfolio-allocation-chart'
import { PortfolioConcentration } from '@/components/portfolio-concentration'
import { getLatestInsight } from '@/lib/portfolio/insights'
import { parseNominalReturn1y } from '@/lib/inflation/parse-return'
import { describeAgeBand, ageBasedEquityBand } from '@/lib/portfolio/allocation'
import { getAllocationForUser } from '@/lib/portfolio/get-allocation'
import type { UserProfileInput } from '@/lib/inflation/compute'
import type { InflationConfidence } from '@/lib/validation/schemas'

// ── page ──────────────────────────────────────────────────────────────────────

export default async function PortfolioPage() {
  const cookieStore = await cookies()
  const userId = cookieStore.get(COOKIE_NAME)?.value

  // ── no session ──────────────────────────────────────────────────────────────
  if (!userId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl">📊</div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">
          Your real returns view
        </h1>
        <p className="mt-2 text-gray-500">
          Upload your CAS to see how your portfolio performs after personal inflation.
        </p>
        <Link
          href="/portfolio/upload"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Upload CAS PDF →
        </Link>
      </main>
    )
  }

  // ── fetch holdings ──────────────────────────────────────────────────────────
  const holdingRows = await db
    .select({
      schemeCode: schema.portfolioHoldings.schemeCode,
      schemeName: schema.portfolioHoldings.schemeName,
      units: schema.portfolioHoldings.units,
      nav: schema.portfolioHoldings.nav,
      marketValue: schema.portfolioHoldings.marketValue,
    })
    .from(schema.portfolioHoldings)
    .where(eq(schema.portfolioHoldings.userId, userId))
    .orderBy(desc(schema.portfolioHoldings.marketValue))

  // ── empty state ─────────────────────────────────────────────────────────────
  if (holdingRows.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="text-4xl">📂</div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-gray-900">
          No holdings yet
        </h1>
        <p className="mt-2 text-gray-500">Upload your CAS to see your portfolio.</p>
        <Link
          href="/portfolio/upload"
          className="mt-6 inline-block rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Upload CAS PDF →
        </Link>
      </main>
    )
  }

  // ── inflation rate ──────────────────────────────────────────────────────────
  const profile = await db.query.userProfile.findFirst({
    where: eq(schema.userProfile.userId, userId),
  })

  let inflationRate: number
  let inflationConfidence: InflationConfidence

  if (profile?.inflationRate) {
    inflationRate = Number(profile.inflationRate)
    inflationConfidence = (profile.inflationConfidence as InflationConfidence) ?? 'low'
  } else {
    // Recompute from profile fields (may be low confidence)
    const input: UserProfileInput = {
      age: profile?.age ?? undefined,
      city_tier: (profile?.cityTier as UserProfileInput['city_tier']) ?? undefined,
      monthly_rent: profile?.monthlyRent ? Number(profile.monthlyRent) : undefined,
      owns_home: profile?.ownsHome ?? undefined,
      dependents: (profile?.dependents as UserProfileInput['dependents']) ?? undefined,
      medical_conditions: profile?.medicalConditions ?? undefined,
    }
    const computed = computePersonalInflation(input)
    inflationRate = computed.rate
    inflationConfidence = computed.confidence
  }

  // ── factsheet returns ───────────────────────────────────────────────────────
  const schemeCodes = [
    ...new Set(holdingRows.filter((h) => h.schemeCode).map((h) => h.schemeCode!)),
  ]

  const returnsChunks: Array<{ schemeCode: string; chunkText: string; factsheetDate: string }> =
    schemeCodes.length > 0
      ? (
        await db.execute<{ scheme_code: string; chunk_text: string; factsheet_date: string }>(
          sql`
              SELECT DISTINCT ON (scheme_code)
                scheme_code,
                chunk_text,
                factsheet_date
              FROM factsheet_chunks
              WHERE scheme_code = ANY(${schemeCodes}::text[])
                AND section = 'returns'
              ORDER BY scheme_code, factsheet_date DESC
            `,
        )
      ).rows.map((r) => ({
        schemeCode: r.scheme_code,
        chunkText: r.chunk_text,
        factsheetDate: r.factsheet_date,
      }))
      : []

  const returnsMap = new Map(
    returnsChunks.map((c) => [c.schemeCode, { chunkText: c.chunkText, factsheetDate: c.factsheetDate }]),
  )

  // ── assemble inputs for pure function ───────────────────────────────────────
  const holdingsForComputation = holdingRows.map((h) => {
    const returnsEntry = h.schemeCode ? returnsMap.get(h.schemeCode) : undefined
    return {
      scheme_code: h.schemeCode,
      scheme_name: h.schemeName,
      market_value: Number(h.marketValue),
      nominal_return_1y: returnsEntry ? parseNominalReturn1y(returnsEntry.chunkText) : null,
      factsheet_date: returnsEntry?.factsheetDate ?? null,
    }
  })

  const result = computeRealReturns(holdingsForComputation, inflationRate)
  const missingCount = result.per_holding.filter((h) => h.nominal_return_1y === null).length

  // ── latest insight card ─────────────────────────────────────────────────────
  let insight: Awaited<ReturnType<typeof getLatestInsight>> = null
  if (holdingRows.length > 0) {
    try {
      insight = await getLatestInsight(userId)
    } catch {
      insight = null
    }
  }

  const snapshotRows = await db
    .select({
      asOfDate: schema.portfolioSnapshots.asOfDate,
      totalValue: schema.portfolioSnapshots.totalValue,
      realReturnAnnualized: schema.portfolioSnapshots.realReturnAnnualized,
    })
    .from(schema.portfolioSnapshots)
    .where(eq(schema.portfolioSnapshots.userId, userId))
    .orderBy(schema.portfolioSnapshots.asOfDate)

  const timelineData = snapshotRows.map((r) => ({
    as_of_date: r.asOfDate,
    total_value: Number(r.totalValue),
    real_return_annualized: r.realReturnAnnualized !== null ? Number(r.realReturnAnnualized) : null,
  }))

  // Compute XIRR on the server for the initial render
  const { computePortfolioXIRR } = await import('@/lib/portfolio/xirr')
  const xirr = computePortfolioXIRR(
    timelineData.map((d) => ({ asOfDate: d.as_of_date, totalValue: d.total_value })),
  )

  const latestRolling1y = timelineData[timelineData.length - 1]?.real_return_annualized ?? null

  // ── allocation data ─────────────────────────────────────────────────────────
  let allocation: {
    ok: boolean
    data: {
      buckets: Array<{
        bucket: string
        value: number
        weight: number
        holdingCount: number
      }>
      totalValue: number
      topHoldings: Array<{
        schemeName: string
        schemeCode: string | null
        marketValue: number
        bucket: string
        amfiCategory: string | null
      }>
      unknownWeight: number
    }
  } = { ok: false, data: { buckets: [], totalValue: 0, topHoldings: [], unknownWeight: 0 } }

  try {
    allocation = await getAllocationForUser(userId)
  } catch {
    // leave allocation empty on error
  }

  const age = profile?.age ?? null
  const ageBand = describeAgeBand(age)
  const equityBand = ageBasedEquityBand(age)
  const equityWeight = allocation.ok
    ? allocation.data.buckets
      .filter((b) =>
        [
          'Equity - Large Cap',
          'Equity - Mid Cap',
          'Equity - Small Cap',
          'Equity - Multi/ Flexi/ Focused',
          'ELSS (Tax Saver)',
        ].includes(b.bucket),
      )
      .reduce((sum, b) => sum + b.weight, 0)
    : 0

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Header row */}
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Portfolio</h1>
          <p className="text-sm text-gray-500">
            {holdingRows.length} holding{holdingRows.length !== 1 ? 's' : ''} ·{' '}
            Total{' '}
            <span className="font-semibold text-gray-800">
              ₹{result.portfolio.total_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>
            Personal inflation:{' '}
            <span className="font-semibold text-orange-600">
              {(inflationRate * 100).toFixed(2)}%
            </span>
            {inflationConfidence === 'low' && (
              <span className="ml-1 text-xs text-gray-400">(est.)</span>
            )}
          </span>
          <Link href="/portfolio/upload" className="text-indigo-600 underline-offset-2 hover:underline">
            Update CAS
          </Link>
          <Link href="/portfolio/equity" className="text-indigo-600 underline-offset-2 hover:underline">
            Equity →
          </Link>
        </div>
      </div>

      {insight && (
        <section
          className="mb-6 rounded-xl border-l-4 border-indigo-500 bg-white p-4 shadow-sm"
          aria-label="Portfolio insight"
          data-testid="insight-card"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-lg">💡</span>
            <h2 className="text-base font-semibold text-gray-900">{insight.title}</h2>
            <span className="ml-auto rounded bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
              Insight
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">{insight.body}</p>
          <p className="mt-2 text-xs text-gray-400">
            This insight is generated from your CAS data for educational purposes only. It is not
            investment advice.
          </p>
        </section>
      )}

      {/* Big callout */}
      <div className="mb-6">
        <RealVsNominal portfolio={result.portfolio} perHolding={result.per_holding} inflationConfidence={inflationConfidence} />
      </div>

      {/* Timeline section */}
      <section className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 className="text-base font-semibold text-gray-800">Portfolio journey</h2>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {xirr !== null && (
              <span>
                XIRR:{' '}
                <span className={`font-semibold ${xirr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(xirr * 100).toFixed(2)}%
                </span>
              </span>
            )}
            {latestRolling1y !== null && (
              <span>
                Latest real return:{' '}
                <span className={`font-semibold ${latestRolling1y >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(latestRolling1y * 100).toFixed(2)}%
                </span>
              </span>
            )}
            <span>{timelineData.length} snapshot{timelineData.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <PortfolioTimelineChart data={timelineData} />
      </section>

      {/* Allocation section */}
      {allocation.ok && allocation.data.totalValue > 0 && (
        <section className="mb-6 rounded-xl border bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-gray-800">Allocation by category</h2>
            <p className="text-xs text-gray-500">
              Buckets are based on AMFI categories or scheme-name keywords, not advice.
            </p>
          </div>

          <div className="mb-4 rounded border border-gray-100 bg-gray-50 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-gray-600">Equity exposure</span>
              <span className="font-semibold text-gray-900">{(equityWeight * 100).toFixed(1)}%</span>
            </div>
            {age !== null && ageBand && (
              <div className="relative h-3 w-full rounded-full bg-gray-200">
                <div
                  className="absolute top-0 h-3 rounded-full bg-indigo-100"
                  style={{
                    left: `${equityBand.min * 100}%`,
                    width: `${(equityBand.max - equityBand.min) * 100}%`,
                  }}
                />
                <div
                  className="absolute top-0 h-3 w-1 rounded-full bg-indigo-600"
                  style={{
                    left: `${Math.min(Math.max(equityWeight * 100, 0), 100)}%`,
                  }}
                />
              </div>
            )}
            {age === null && <p className="text-xs text-gray-500">Share your age to see a reference band.</p>}
          </div>

          <div className="mb-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {ageBand.label}
            </h3>
            <p className="text-sm text-gray-600">{ageBand.description}</p>
          </div>

          <div className="mb-6">
            <PortfolioAllocationChart
              buckets={allocation.data.buckets}
              totalValue={allocation.data.totalValue}
            />
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-800">Top holdings</h3>
            <PortfolioConcentration
              holdings={allocation.data.topHoldings}
              totalValue={allocation.data.totalValue}
            />
          </div>

          {allocation.data.unknownWeight > 0.1 && (
            <p className="mt-4 text-xs text-gray-500">
              {((allocation.data.unknownWeight) * 100).toFixed(1)}% of your portfolio is in categories we
              could not clearly classify yet. Review the holdings list or update your CAS after
              syncing the latest AMFI master.
            </p>
          )}

          <div className="mt-4 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            This is a descriptive view of what you already hold. It is not guidance to add, exit,
            or change any fund.
          </div>
        </section>
      )}

      {/* Holdings table */}
      <div className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-gray-800">Holdings breakdown</h2>
        <PortfolioTable perHolding={result.per_holding} />
      </div>

      {/* Missing data note */}
      {missingCount > 0 && (
        <p className="mb-6 text-xs text-gray-400">
          "—" means no factsheet returns data is available for that holding.{' '}
          {missingCount === holdingRows.length
            ? 'Run the factsheet ingestion script to populate return data.'
            : `${missingCount} of ${holdingRows.length} holdings missing.`}
        </p>
      )}

      {/* Disclaimer */}
      <div className="mb-6">
        <div className="rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <strong>Educational estimates only.</strong> These figures are based on your CAS and AMFI
          factsheet data. Returns shown are 1-year trailing from the most recent factsheet — not
          your personal cost-basis return. Talk to your advisor before transacting.
        </div>
      </div>

      {/* Onboarding nudge if low confidence */}
      {inflationConfidence === 'low' && (
        <div className="mb-6 rounded border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          Your inflation estimate is based on default assumptions.{' '}
          <Link href="/onboarding" className="font-semibold underline underline-offset-2">
            Complete onboarding →
          </Link>{' '}
          to get a personalised rate.
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        PF Copilot · Educational tool · Not investment advice
      </p>
    </main>
  )
}
