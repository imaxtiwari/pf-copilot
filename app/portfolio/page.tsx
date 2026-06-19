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
import { ConfidenceTrajectory } from '@/components/confidence-trajectory'
import { parseNominalReturn1y } from '@/lib/inflation/parse-return'
import { getRecommendationPacket } from '@/lib/tools/get-recommendation-packet'
import { ComparisonReport } from '@/components/comparison-report'
import { DriftReport } from '@/components/drift-report'
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
    ...new Set(holdingRows.filter((h: any) => h.schemeCode).map((h: any) => h.schemeCode!)),
  ]

  const returnsChunks: Array<{ schemeCode: string; chunkText: string; factsheetDate: string }> =
    schemeCodes.length > 0
      ? (
          (await db.execute(
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
          )) as any
        ).rows.map((r: any) => ({
          schemeCode: r.scheme_code,
          chunkText: r.chunk_text,
          factsheetDate: r.factsheet_date,
        }))
      : []

  const returnsMap = new Map(
    returnsChunks.map((c: any) => [c.schemeCode, { chunkText: c.chunkText, factsheetDate: c.factsheetDate }]),
  )

  // ── assemble inputs for pure function ───────────────────────────────────────
  const holdingsForComputation = holdingRows.map((h: any) => {
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
  const missingCount = result.per_holding.filter((h: any) => h.nominal_return_1y === null).length

  // Fetch latest pipeline run for the user
  const latestPipelineRun = await db.query.pipelineRuns.findFirst({
    where: eq(schema.pipelineRuns.clientId, userId),
    orderBy: [desc(schema.pipelineRuns.createdAt)]
  })

  const recommendationPacket = await getRecommendationPacket(userId)

  // Fetch latest drift report
  const latestDriftReport = await db.query.driftReports.findFirst({
    where: eq(schema.driftReports.userId, userId),
    orderBy: [desc(schema.driftReports.generatedAt)]
  })

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
        </div>
      </div>

      {/* Big callout */}
      <div className="mb-6">
        <RealVsNominal portfolio={result.portfolio} inflationConfidence={inflationConfidence} />
      </div>

      {/* Confidence Trajectory (if pipeline run exists) */}
      {latestPipelineRun && (
        <div className="mb-6">
          <ConfidenceTrajectory pipelineRunId={latestPipelineRun.runId} />
        </div>
      )}

      {/* Comparison Report (if approved) */}
      {recommendationPacket.status === 'approved' && recommendationPacket.comparison_report && (
        <div className="mb-6">
          <ComparisonReport data={recommendationPacket.comparison_report} />
        </div>
      )}

      {/* Drift Report */}
      {latestDriftReport && (
        <div className="mb-6">
          <DriftReport data={latestDriftReport.report as any} />
        </div>
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
