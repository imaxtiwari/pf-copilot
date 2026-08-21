import React from 'react'

export interface DriftReportProps {
  data: {
    uploadedAt: string | Date
    previousUploadAt: string | Date | null
    daysBetweenUploads: number
    changes: {
      newPositions: Array<{ schemeName: string; units: number; currentValue: number }>
      exitedPositions: Array<{ schemeName: string; units: number; realisedValue: number }>
      increased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: string }>
      decreased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: string }>
      unchanged: Array<{ schemeName: string }>
    }
    portfolioReturn: {
      nominalReturn: number
      periodDays: number
      annualizedReturn: number
    }
    sipDetection: Array<{
      schemeName: string
      estimatedMonthlyAmount: number
      confidence: 'HIGH' | 'MEDIUM' | 'LOW'
    }>
    driftFromRecommendation: {
      allocationDrift: Array<{
        schemeName: string
        recommendedWeight: number
        currentWeight: number
        drift: number
      }>
      rebalancingNeeded: boolean
      rebalancingUrgency: 'HIGH' | 'MEDIUM' | 'LOW'
    } | null
  }
}

export function DriftReport({ data }: DriftReportProps) {
  if (!data) return null

  const {
    daysBetweenUploads,
    changes,
    portfolioReturn,
    sipDetection,
    driftFromRecommendation
  } = data

  const urgencyColors = {
    HIGH: 'bg-red-50 text-red-700 border-red-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    LOW: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }

  const hasChanges =
    changes.newPositions.length > 0 ||
    changes.exitedPositions.length > 0 ||
    changes.increased.length > 0 ||
    changes.decreased.length > 0

  return (
    <div className="rounded-xl border border-slate-100 bg-white/60 p-6 shadow-sm backdrop-blur-md">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Portfolio Drift & Activity</h3>
          <p className="text-sm text-slate-500">
            {daysBetweenUploads > 0
              ? `Comparison since your last upload (${daysBetweenUploads} days ago)`
              : 'Initial CAS upload analysis'}
          </p>
        </div>
        {portfolioReturn.nominalReturn !== 0 && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-slate-500">Period Return:</span>
            <span
              className={`text-lg font-bold ${
                portfolioReturn.nominalReturn >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {portfolioReturn.nominalReturn >= 0 ? '+' : ''}
              {portfolioReturn.nominalReturn}%
            </span>
            {daysBetweenUploads > 0 && (
              <span className="text-xs text-slate-400">
                ({portfolioReturn.annualizedReturn >= 0 ? '+' : ''}
                {portfolioReturn.annualizedReturn}% p.a.)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Changes list */}
      <div className="mt-6">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Position Updates
        </h4>

        {!hasChanges && (
          <p className="mt-2 text-sm text-slate-500 italic">No position changes detected.</p>
        )}

        {hasChanges && (
          <div className="mt-3 space-y-2">
            {/* New positions */}
            {changes.newPositions.map((pos, idx) => (
              <div
                key={`new-${idx}`}
                className="flex items-center justify-between rounded-lg bg-emerald-50/40 px-3 py-2 text-sm border border-emerald-100/50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-600">+</span>
                  <span className="font-medium text-slate-700">{pos.schemeName}</span>
                </div>
                <span className="text-slate-500 text-xs">
                  New position · ₹{pos.currentValue.toLocaleString('en-IN')}
                </span>
              </div>
            ))}

            {/* Exited positions */}
            {changes.exitedPositions.map((pos, idx) => (
              <div
                key={`exit-${idx}`}
                className="flex items-center justify-between rounded-lg bg-rose-50/40 px-3 py-2 text-sm border border-rose-100/50"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-rose-600">-</span>
                  <span className="font-medium text-slate-700">{pos.schemeName}</span>
                </div>
                <span className="text-slate-500 text-xs">
                  Exited · ₹{pos.realisedValue.toLocaleString('en-IN')} realised
                </span>
              </div>
            ))}

            {/* Increased */}
            {changes.increased.map((pos, idx) => (
              <div
                key={`inc-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm border border-slate-100"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-emerald-600">↑</span>
                  <span className="font-medium text-slate-700">{pos.schemeName}</span>
                </div>
                <span className="text-slate-500 text-xs">
                  +{pos.unitsDelta.toFixed(3)} units · {pos.reason}
                </span>
              </div>
            ))}

            {/* Decreased */}
            {changes.decreased.map((pos, idx) => (
              <div
                key={`dec-${idx}`}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm border border-slate-100"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold text-rose-600">↓</span>
                  <span className="font-medium text-slate-700">{pos.schemeName}</span>
                </div>
                <span className="text-slate-500 text-xs">
                  {pos.unitsDelta.toFixed(3)} units · {pos.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SIP Detection */}
      {sipDetection.length > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Detected Active SIPs
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {sipDetection.map((sip, idx) => (
              <div
                key={`sip-${idx}`}
                className="rounded-lg border border-indigo-50 bg-indigo-50/20 p-3 text-sm flex items-center justify-between"
              >
                <div>
                  <span className="block font-medium text-slate-800">{sip.schemeName}</span>
                  <span className="text-slate-500 text-xs">
                    Est. Monthly Contribution: ₹{sip.estimatedMonthlyAmount.toLocaleString('en-IN')}
                  </span>
                </div>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 uppercase">
                  {sip.confidence} Conf.
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan Drift Analysis */}
      {driftFromRecommendation && (
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Drift From Your Plan
            </h4>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Rebalancing needed:</span>
              <span
                className={`rounded border px-2.5 py-0.5 font-semibold ${
                  driftFromRecommendation.rebalancingNeeded
                    ? urgencyColors[driftFromRecommendation.rebalancingUrgency]
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {driftFromRecommendation.rebalancingNeeded
                  ? `YES (${driftFromRecommendation.rebalancingUrgency} Urgency)`
                  : 'NO'}
              </span>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-slate-100">
            <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-medium uppercase">
                <tr>
                  <th className="px-4 py-2">Fund</th>
                  <th className="px-4 py-2 text-right">Target Wt.</th>
                  <th className="px-4 py-2 text-right">Current Wt.</th>
                  <th className="px-4 py-2 text-right">Drift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {driftFromRecommendation.allocationDrift.map((d, idx) => {
                  const hasSignificantDrift = Math.abs(d.drift) > 5
                  return (
                    <tr
                      key={`drift-${idx}`}
                      className={hasSignificantDrift ? 'bg-amber-50/30' : undefined}
                    >
                      <td className="px-4 py-2.5 font-medium">{d.schemeName}</td>
                      <td className="px-4 py-2.5 text-right">{d.recommendedWeight}%</td>
                      <td className="px-4 py-2.5 text-right">{d.currentWeight}%</td>
                      <td
                        className={`px-4 py-2.5 text-right font-semibold ${
                          d.drift > 0 ? 'text-emerald-600' : d.drift < 0 ? 'text-rose-600' : ''
                        }`}
                      >
                        {d.drift > 0 ? '+' : ''}
                        {d.drift}%
                        {hasSignificantDrift && (
                          <span className="ml-1 text-[10px] text-amber-600 font-normal">
                            (⚠️ &gt;5% Drift)
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
