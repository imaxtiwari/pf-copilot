import { eq, desc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import logger from '../logger'

export interface SIPAdherenceReport {
  recommendedSIPs: Array<{
    schemeName: string
    goalBucket: string
    monthlyAmount: number
    startDate: Date
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

export async function trackSIPAdherence(
  approvedPortfolio: any,
  driftReport: any,
  userProfile: any,
  dbInstance: any
): Promise<SIPAdherenceReport> {
  const pipelineRunId = approvedPortfolio.pipelineRunId
  const clientId = approvedPortfolio.clientId

  logger.info({ pipelineRunId, clientId }, 'SIP Tracker: Calculating SIP adherence')

  // 1. Fetch decomposed goal SIP requirements from compiled packet
  let decomposedGoals: any[] = []
  try {
    const [result] = await dbInstance
      .select()
      .from(schema.pipelineResults)
      .where(eq(schema.pipelineResults.pipelineRunId, pipelineRunId))
      .limit(1)
    if (result && result.data) {
      decomposedGoals = result.data.client_goal_summary?.decomposed_goals || []
    }
  } catch (err) {
    logger.error({ err, pipelineRunId }, 'SIP Tracker: Failed to fetch compiled packet from DB')
  }

  // 2. Fetch previous report to track paused state
  let prevReportDetectedSips: any[] = []
  try {
    const [prevReport] = await dbInstance
      .select()
      .from(schema.sipAdherenceReports)
      .where(eq(schema.sipAdherenceReports.userId, clientId))
      .orderBy(desc(schema.sipAdherenceReports.generatedAt))
      .limit(1)
    if (prevReport && prevReport.report) {
      prevReportDetectedSips = prevReport.report.detectedSIPs || []
    }
  } catch (err) {
    logger.warn({ err, clientId }, 'SIP Tracker: Failed to fetch previous SIP report')
  }

  // 3. Map approved portfolio allocations to recommended SIP amounts per fund/bucket
  const recommendedSIPs: SIPAdherenceReport['recommendedSIPs'] = []
  const fundAllocations = approvedPortfolio.fundAllocations || approvedPortfolio.fund_allocations || []
  const goalBuckets = approvedPortfolio.goalBuckets || approvedPortfolio.goal_buckets || []

  for (const a of fundAllocations) {
    const bucket = goalBuckets.find((b: any) => b.bucket_id === a.goal_bucket_id || b.goal_id === a.goal_bucket_id)
    const goal = bucket ? decomposedGoals.find((g: any) => g.goal_id === bucket.goal_id || g.goal_type === bucket.goal_type) : null

    const monthlySipLakh = goal ? parseFloat(goal.monthly_sip_required_lakh || '0') : 0
    const allocationPct = parseFloat(a.allocation_pct || '0')
    const monthlyAmount = Math.round(monthlySipLakh * 100000 * (allocationPct / 100))

    recommendedSIPs.push({
      schemeName: a.fund_name || a.scheme_name,
      goalBucket: goal?.description || bucket?.goal_type || 'General Savings',
      monthlyAmount,
      startDate: approvedPortfolio.createdAt ? new Date(approvedPortfolio.createdAt) : new Date()
    })
  }

  // 4. Detected SIPs from CAS drift report
  const rawDetected = driftReport.sipDetection || []
  const detectedSIPs: SIPAdherenceReport['detectedSIPs'] = rawDetected.map((d: any) => {
    const prevDet = prevReportDetectedSips.find((p: any) => p.schemeName.trim().toLowerCase() === d.schemeName.trim().toLowerCase())
    const confidence = d.confidence || 'MEDIUM'
    let monthsRunning = prevDet ? (prevDet.monthsRunning || 1) + 1 : (confidence === 'HIGH' ? 3 : confidence === 'MEDIUM' ? 2 : 1)
    return {
      schemeName: d.schemeName,
      estimatedMonthlyAmount: Math.round(d.estimatedMonthlyAmount || 0),
      confidence,
      monthsRunning
    }
  })

  // Group recommended by fund key
  const recMap = new Map<string, number>()
  for (const rec of recommendedSIPs) {
    const key = rec.schemeName.trim().toLowerCase()
    recMap.set(key, (recMap.get(key) || 0) + rec.monthlyAmount)
  }

  // Group detected by fund key
  const detMap = new Map<string, number>()
  for (const det of detectedSIPs) {
    const key = det.schemeName.trim().toLowerCase()
    detMap.set(key, (detMap.get(key) || 0) + det.estimatedMonthlyAmount)
  }

  // 5. Adherence by fund list
  const allSchemes = new Set([...recMap.keys(), ...detMap.keys()])
  const adherenceByFund: SIPAdherenceReport['adherenceByFund'] = []

  // SIP detection is possible only if there is a previous upload and we are comparing
  const isSipDetectionPossible = !!driftReport.previousUploadAt

  for (const key of allSchemes) {
    const recList = recommendedSIPs.filter(r => r.schemeName.trim().toLowerCase() === key)
    const detList = detectedSIPs.filter(d => d.schemeName.trim().toLowerCase() === key)

    const schemeName = recList[0]?.schemeName || detList[0]?.schemeName || ''
    const recommended = recMap.get(key) || 0
    const actual = detMap.get(key) || 0

    let status: 'ON_TRACK' | 'UNDER_INVESTING' | 'OVER_INVESTING' | 'NOT_STARTED' | 'UNDETECTED' = 'ON_TRACK'

    if (recommended > 0 && actual === 0) {
      status = isSipDetectionPossible ? 'NOT_STARTED' : 'UNDETECTED'
    } else if (recommended === 0 && actual > 0) {
      status = 'OVER_INVESTING'
    } else if (actual < recommended * 0.9) {
      status = 'UNDER_INVESTING'
    } else if (actual > recommended * 1.1) {
      status = 'OVER_INVESTING'
    } else {
      status = 'ON_TRACK'
    }

    adherenceByFund.push({
      schemeName,
      recommended,
      actual,
      status
    })
  }

  // 6. Overall Adherence Score: percentage of recommended amount actually invested (weighted by volume, capped at 100)
  let weightedFulfilled = 0
  let scoreRecommendedTotal = 0
  for (const fund of adherenceByFund) {
    if (fund.recommended > 0) {
      if (fund.status === 'UNDETECTED') {
        continue
      }
      const fulfilled = Math.min(fund.actual, fund.recommended)
      weightedFulfilled += fulfilled
      scoreRecommendedTotal += fund.recommended
    }
  }

  const overallAdherenceScore = scoreRecommendedTotal > 0
    ? Math.round((weightedFulfilled / scoreRecommendedTotal) * 100)
    : 100

  // 7. Monthly Shortfall
  let monthlyShortfall = 0
  for (const fund of adherenceByFund) {
    if (fund.status !== 'UNDETECTED' && fund.recommended > fund.actual) {
      monthlyShortfall += (fund.recommended - fund.actual)
    }
  }

  // 8. Projected Corpus Impact: 12% CAGR compounded over 12 months for missed amounts
  const annualRate = 0.12
  const monthlyRate = annualRate / 12
  let projectedCorpusImpact = 0
  for (let month = 1; month <= 12; month++) {
    projectedCorpusImpact += monthlyShortfall * Math.pow(1 + monthlyRate, 12 - month)
  }
  projectedCorpusImpact = Math.round(projectedCorpusImpact)

  // 9. Alerts
  const alerts: Array<{
    type: 'SIP_NOT_STARTED' | 'SIP_PAUSED' | 'AMOUNT_SHORT' | 'ON_TRACK'
    schemeName: string
    message: string
    urgency: 'HIGH' | 'MEDIUM' | 'LOW'
  }> = []

  // High Alert: Paused SIP
  if (isSipDetectionPossible) {
    for (const prevDet of prevReportDetectedSips) {
      const key = prevDet.schemeName.trim().toLowerCase()
      const recAmt = recMap.get(key) || 0
      const actAmt = detMap.get(key) || 0
      if (prevDet.estimatedMonthlyAmount > 0 && actAmt === 0 && recAmt > 0) {
        alerts.push({
          type: 'SIP_PAUSED',
          schemeName: prevDet.schemeName,
          message: `Your monthly SIP in ${prevDet.schemeName} appears to have paused or stopped (we detected previous investments but none in this upload).`,
          urgency: 'HIGH'
        })
      }
    }
  }

  // Fund-specific alerts
  for (const fund of adherenceByFund) {
    const alreadyAlerted = alerts.some(a => a.schemeName === fund.schemeName && a.type === 'SIP_PAUSED')
    if (alreadyAlerted) continue

    if (fund.status === 'NOT_STARTED') {
      alerts.push({
        type: 'SIP_NOT_STARTED',
        schemeName: fund.schemeName,
        message: `You haven't started your recommended monthly SIP of ₹${fund.recommended.toLocaleString('en-IN')} in ${fund.schemeName}.`,
        urgency: 'HIGH'
      })
    } else if (fund.status === 'UNDER_INVESTING') {
      alerts.push({
        type: 'AMOUNT_SHORT',
        schemeName: fund.schemeName,
        message: `Your monthly SIP of ₹${fund.actual.toLocaleString('en-IN')} in ${fund.schemeName} is short of the recommended ₹${fund.recommended.toLocaleString('en-IN')}.`,
        urgency: 'MEDIUM'
      })
    }
  }

  // On track default alert if empty
  if (alerts.length === 0) {
    alerts.push({
      type: 'ON_TRACK',
      schemeName: 'Overall Portfolio',
      message: 'All your recommended SIPs are running on track. Great job maintaining investment discipline!',
      urgency: 'LOW'
    })
  }

  // Projection Details
  let targetGoalName = 'primary goal'
  let targetGoalYear = new Date().getFullYear() + 10
  if (decomposedGoals.length > 0) {
    const firstGoal = decomposedGoals[0]
    targetGoalName = firstGoal.description || firstGoal.goal_type || 'primary goal'
    if (firstGoal.target_date) {
      targetGoalYear = new Date(firstGoal.target_date).getFullYear()
    }
  }

  return {
    recommendedSIPs,
    detectedSIPs,
    adherenceByFund,
    overallAdherenceScore,
    monthlyShortfall,
    projectedCorpusImpact,
    alerts,
    projectionDetails: {
      goalName: targetGoalName,
      targetYear: targetGoalYear
    }
  }
}
