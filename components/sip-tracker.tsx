import React from 'react'

export interface SIPAdherenceReportProps {
  data: {
    recommendedSIPs: Array<{
      schemeName: string
      goalBucket: string
      monthlyAmount: number
      startDate: string | Date
    }>
    detectedSIPs: Array<{
      schemeName: string
      estimatedMonthlyAmount: number
      confidence: 'HIGH' | 'MEDIUM' | 'LOW'
      monthsRunning: number
    }>
    adherenceByFund: Array<{
      schemeName: string
      recommended: number
      actual: number
      status: 'ON_TRACK' | 'UNDER_INVESTING' | 'OVER_INVESTING' | 'NOT_STARTED' | 'UNDETECTED'
    }>
    overallAdherenceScore: number
    monthlyShortfall: number
    projectedCorpusImpact: number
    alerts: Array<{
      type: 'SIP_NOT_STARTED' | 'SIP_PAUSED' | 'AMOUNT_SHORT' | 'ON_TRACK'
      schemeName: string
      message: string
      urgency: 'HIGH' | 'MEDIUM' | 'LOW'
    }>
    projectionDetails: {
      goalName: string
      targetYear: number
    }
  }
}

export function SipTracker({ data }: SIPAdherenceReportProps) {
  if (!data) return null

  const {
    adherenceByFund,
    overallAdherenceScore,
    monthlyShortfall,
    projectedCorpusImpact,
    alerts,
    projectionDetails
  } = data

  // Color mapping based on adherence score
  const getScoreColorClass = (score: number) => {
    if (score >= 80) return 'text-emerald-600 border-emerald-100 bg-emerald-50/50'
    if (score >= 50) return 'text-amber-600 border-amber-100 bg-amber-50/50'
    return 'text-rose-600 border-rose-100 bg-rose-50/50'
  };

  const getScoreTextClass = (score: number) => {
    if (score >= 80) return 'text-emerald-600'
    if (score >= 50) return 'text-amber-500'
    return 'text-rose-600'
  };

  // Status badge colors
  const statusBadges = {
    ON_TRACK: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    UNDER_INVESTING: 'bg-amber-50 text-amber-700 border-amber-200',
    OVER_INVESTING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    NOT_STARTED: 'bg-rose-50 text-rose-700 border-rose-200',
    UNDETECTED: 'bg-slate-50 text-slate-700 border-slate-200'
  };

  const statusLabels = {
    ON_TRACK: 'On Track',
    UNDER_INVESTING: 'Under Investing',
    OVER_INVESTING: 'Over Investing',
    NOT_STARTED: 'Not Started',
    UNDETECTED: 'Undetected'
  };

  // Urgency colors for alert cards
  const alertUrgencyColors = {
    HIGH: 'border-l-4 border-rose-500 bg-rose-50/40 text-rose-900 border-slate-100',
    MEDIUM: 'border-l-4 border-amber-500 bg-amber-50/40 text-amber-900 border-slate-100',
    LOW: 'border-l-4 border-emerald-500 bg-emerald-50/40 text-emerald-900 border-slate-100'
  };

  const alertUrgencyBadges = {
    HIGH: 'bg-rose-100 text-rose-800',
    MEDIUM: 'bg-amber-100 text-amber-800',
    LOW: 'bg-emerald-100 text-emerald-800'
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/70 p-6 shadow-sm backdrop-blur-md">
      {/* Top Section: Header & Overall Score */}
      <div className="flex flex-col justify-between gap-6 border-b border-slate-100 pb-5 md:flex-row md:items-center">
        <div>
          <h3 className="text-lg font-bold tracking-tight text-slate-900">SIP Adherence Tracker</h3>
          <p className="text-sm text-slate-500">Monitoring monthly investment goals across CAS uploads</p>
        </div>
        <div className={`flex items-center gap-4 rounded-xl border px-4 py-2.5 ${getScoreColorClass(overallAdherenceScore)}`}>
          <div className="text-center">
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-400">Adherence Score</span>
            <span className={`text-3xl font-extrabold tracking-tight ${getScoreTextClass(overallAdherenceScore)}`}>
              {overallAdherenceScore}%
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Funds Table + Projections/Alerts */}
      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        
        {/* Left Column: Funds Status (7 cols) */}
        <div className="lg:col-span-7">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Investment Breakdown</h4>
          <div className="overflow-hidden rounded-xl border border-slate-100 bg-white/50">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Mutual Fund Scheme</th>
                    <th className="px-4 py-3 text-right">Target SIP</th>
                    <th className="px-4 py-3 text-right">Detected</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {adherenceByFund.map((fund, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3.5 font-medium text-slate-800 max-w-[240px] truncate" title={fund.schemeName}>
                        {fund.schemeName}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-900">
                        ₹{fund.recommended.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-slate-900">
                        {fund.status === 'UNDETECTED' ? '—' : `₹${fund.actual.toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadges[fund.status]}`}>
                          {statusLabels[fund.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Projection & Alerts (5 cols) */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          
          {/* Projection Callout */}
          {monthlyShortfall > 0 && (
            <div className="rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50/50 to-white p-5 shadow-sm">
              <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
                ⚠️ Corpus Risk Warning
              </span>
              <p className="mt-3 text-sm text-slate-700 leading-relaxed">
                At your current investment pace, your <span className="font-bold text-slate-900">{projectionDetails.goalName}</span> corpus will be{' '}
                <span className="font-bold text-rose-600">₹{projectedCorpusImpact.toLocaleString('en-IN')}</span> short by{' '}
                <span className="font-bold text-slate-900">{projectionDetails.targetYear}</span>.
              </p>
              <div className="mt-4 border-t border-rose-100/50 pt-3">
                <p className="text-xs text-slate-500 font-medium">
                  💡 Action Step: Increasing your monthly SIP by <span className="font-semibold text-slate-800">₹{monthlyShortfall.toLocaleString('en-IN')}</span> closes this gap.
                </p>
              </div>
            </div>
          )}

          {monthlyShortfall === 0 && (
            <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white p-5 shadow-sm">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                🎉 Goal On Track
              </span>
              <p className="mt-3 text-sm text-slate-700 leading-relaxed">
                Excellent! You are meeting 100% of your recommended SIP targets. You remain fully on course to hit your{' '}
                <span className="font-bold text-slate-900">{projectionDetails.goalName}</span> targets by{' '}
                <span className="font-bold text-slate-900">{projectionDetails.targetYear}</span>.
              </p>
            </div>
          )}

          {/* Alerts Section */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Required Actions</h4>
            <div className="flex flex-col gap-2.5">
              {alerts.map((alert, idx) => (
                <div key={idx} className={`rounded-lg border p-3.5 shadow-sm ${alertUrgencyColors[alert.urgency]}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-semibold leading-relaxed text-slate-800">
                      {alert.message}
                    </p>
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase ${alertUrgencyBadges[alert.urgency]}`}>
                      {alert.urgency}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </div>
  )
}
