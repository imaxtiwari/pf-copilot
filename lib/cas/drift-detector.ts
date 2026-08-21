import { eq, desc, asc, and, inArray } from 'drizzle-orm'
import { db } from '../db'
import * as schema from '../../db/schema'
import logger from '../logger'

export interface DriftReport {
  uploadedAt: Date
  previousUploadAt: Date | null
  daysBetweenUploads: number
  changes: {
    newPositions: Array<{ schemeName: string; units: number; currentValue: number }>
    exitedPositions: Array<{ schemeName: string; units: number; realisedValue: number }>
    increased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: 'SIP' | 'LUMPSUM' | 'UNKNOWN' }>
    decreased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: 'REDEMPTION' | 'SWITCH' | 'UNKNOWN' }>
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

function getNormalizedKey(h: { schemeCode?: string | null; schemeName: string }): string {
  return h.schemeCode ? `code:${h.schemeCode}` : `name:${h.schemeName.toLowerCase().trim()}`
}

export async function detectDrift(
  previousHoldings: any[],
  currentHoldings: any[],
  previousNav?: Record<string, number>,
  currentNav?: Record<string, number>
): Promise<DriftReport> {
  logger.info('Running detectDrift analysis')

  // 1. Group previous holdings
  const prevGrouped = new Map<string, { schemeName: string; schemeCode: string | null; units: number; marketValue: number; nav: number; asOfDate: Date }>()
  for (const h of previousHoldings) {
    const key = getNormalizedKey(h)
    const units = parseFloat(h.units || '0')
    const marketValue = parseFloat(h.marketValue || '0')
    const nav = parseFloat(h.nav || '0')
    const existing = prevGrouped.get(key)
    if (existing) {
      existing.units += units
      existing.marketValue += marketValue
      existing.nav = Math.max(existing.nav, nav)
    } else {
      prevGrouped.set(key, {
        schemeName: h.schemeName,
        schemeCode: h.schemeCode || null,
        units,
        marketValue,
        nav,
        asOfDate: h.asOfDate ? new Date(h.asOfDate) : new Date(),
      })
    }
  }

  // 2. Group current holdings
  const currGrouped = new Map<string, { schemeName: string; schemeCode: string | null; units: number; marketValue: number; nav: number; asOfDate: Date }>()
  for (const h of currentHoldings) {
    const key = getNormalizedKey(h)
    const units = parseFloat(h.units || '0')
    const marketValue = parseFloat(h.marketValue || '0')
    const nav = parseFloat(h.nav || '0')
    const existing = currGrouped.get(key)
    if (existing) {
      existing.units += units
      existing.marketValue += marketValue
      existing.nav = Math.max(existing.nav, nav)
    } else {
      currGrouped.set(key, {
        schemeName: h.schemeName,
        schemeCode: h.schemeCode || null,
        units,
        marketValue,
        nav,
        asOfDate: h.asOfDate ? new Date(h.asOfDate) : new Date(),
      })
    }
  }

  // 3. Resolve dates
  const currentArray = Array.from(currGrouped.values())
  const previousArray = Array.from(prevGrouped.values())

  const uploadedAt = currentArray[0]?.asOfDate || new Date()
  const previousUploadAt = previousArray[0]?.asOfDate || null

  let daysBetweenUploads = 0
  if (previousUploadAt) {
    daysBetweenUploads = Math.max(0, Math.round((uploadedAt.getTime() - previousUploadAt.getTime()) / (1000 * 60 * 60 * 24)))
  }

  // 4. Run SIP Detection using historical uploads from the DB
  const userId = currentHoldings[0]?.userId || previousHoldings[0]?.userId
  const sipDetection: Array<{ schemeName: string; estimatedMonthlyAmount: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }> = []

  if (userId) {
    try {
      const uploads = await db
        .select()
        .from(schema.casUploads)
        .where(
          and(
            eq(schema.casUploads.userId, userId),
            eq(schema.casUploads.status, 'validated')
          )
        )
        .orderBy(asc(schema.casUploads.uploadedAt))

      if (uploads.length >= 2) {
        const uploadIds = uploads.map((u: any) => u.id)
        const allHoldings = await db
          .select()
          .from(schema.portfolioHoldings)
          .where(inArray(schema.portfolioHoldings.casUploadId, uploadIds))

        // Group holdings by upload ID
        const holdingsByUpload = new Map<string, any[]>()
        for (const h of allHoldings) {
          if (!h.casUploadId) continue
          const list = holdingsByUpload.get(h.casUploadId) || []
          list.push(h)
          holdingsByUpload.set(h.casUploadId, list)
        }

        // For each fund, build a chronological sequence of aggregated units
        const fundHistory = new Map<string, Array<{ units: number; nav: number; date: Date }>>()
        for (const u of uploads) {
          const uHoldings = holdingsByUpload.get(u.id) || []
          const uGrouped = new Map<string, { units: number; nav: number }>()

          for (const h of uHoldings) {
            const key = getNormalizedKey(h)
            const units = parseFloat(h.units || '0')
            const nav = parseFloat(h.nav || '0')
            const existing = uGrouped.get(key)
            if (existing) {
              existing.units += units
              existing.nav = Math.max(existing.nav, nav)
            } else {
              uGrouped.set(key, { units, nav })
            }
          }

          // Update histories
          const allKeys = new Set([...Array.from(fundHistory.keys()), ...Array.from(uGrouped.keys())])
          for (const key of allKeys) {
            const hist = fundHistory.get(key) || []
            const g = uGrouped.get(key)
            hist.push({
              units: g ? g.units : 0,
              nav: g ? g.nav : 0,
              date: new Date(u.uploadedAt)
            })
            fundHistory.set(key, hist)
          }
        }

        // Evaluate histories for SIP patterns
        for (const [key, history] of fundHistory.entries()) {
          if (history.length < 2) continue

          const deltas: Array<{ unitsDelta: number; valDelta: number; date: Date }> = []
          for (let i = 1; i < history.length; i++) {
            const unitsDelta = history[i].units - history[i - 1].units
            const valDelta = unitsDelta * history[i].nav
            deltas.push({ unitsDelta, valDelta, date: history[i].date })
          }

          // Check if latest deltas are positive and similar
          const lastIndex = deltas.length - 1
          if (lastIndex >= 0) {
            const lastDelta = deltas[lastIndex]
            if (lastDelta.unitsDelta > 0.0001) {
              // We have at least 1 recent unit increase
              let isSip = false
              let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW'

              if (lastIndex >= 1) {
                const prevDelta = deltas[lastIndex - 1]
                if (prevDelta.unitsDelta > 0.0001) {
                  // Unit increases in 2 consecutive uploads
                  const ratio = Math.min(lastDelta.valDelta, prevDelta.valDelta) / Math.max(lastDelta.valDelta, prevDelta.valDelta)
                  if (ratio >= 0.8) {
                    isSip = true
                    confidence = 'MEDIUM'

                    // Check for 3 consecutive positive similar deltas
                    if (lastIndex >= 2) {
                      const prevPrevDelta = deltas[lastIndex - 2]
                      if (prevPrevDelta.unitsDelta > 0.0001) {
                        const ratio2 = Math.min(lastDelta.valDelta, prevPrevDelta.valDelta) / Math.max(lastDelta.valDelta, prevPrevDelta.valDelta)
                        if (ratio2 >= 0.8) {
                          confidence = 'HIGH'
                        }
                      }
                    }
                  }
                }
              }

              if (isSip) {
                // Get the schemeName
                const schemeName = history[history.length - 1].units > 0
                  ? currentArray.find(c => getNormalizedKey(c) === key)?.schemeName || ''
                  : ''
                if (schemeName) {
                  sipDetection.push({
                    schemeName,
                    estimatedMonthlyAmount: Math.round(lastDelta.valDelta),
                    confidence
                  })
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err, userId }, 'detectDrift: Failed in SIP detection')
    }
  }

  // 5. Position changes
  const newPositions: Array<{ schemeName: string; units: number; currentValue: number }> = []
  const exitedPositions: Array<{ schemeName: string; units: number; realisedValue: number }> = []
  const increased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: 'SIP' | 'LUMPSUM' | 'UNKNOWN' }> = []
  const decreased: Array<{ schemeName: string; unitsDelta: number; valueDelta: number; reason: 'REDEMPTION' | 'SWITCH' | 'UNKNOWN' }> = []
  const unchanged: Array<{ schemeName: string }> = []

  const allKeys = new Set([...Array.from(prevGrouped.keys()), ...Array.from(currGrouped.keys())])

  for (const key of allKeys) {
    const prev = prevGrouped.get(key)
    const curr = currGrouped.get(key)

    if (curr && !prev) {
      if (curr.units > 0.0001) {
        newPositions.push({
          schemeName: curr.schemeName,
          units: curr.units,
          currentValue: curr.marketValue
        })
      }
    } else if (prev && !curr) {
      if (prev.units > 0.0001) {
        const cNav = currentNav?.[prev.schemeName] || currentNav?.[prev.schemeCode || ''] || prev.nav
        exitedPositions.push({
          schemeName: prev.schemeName,
          units: prev.units,
          realisedValue: prev.units * cNav
        })
      }
    } else if (prev && curr) {
      const unitsDelta = curr.units - prev.units
      const valueDelta = curr.marketValue - prev.marketValue

      if (unitsDelta > 0.0001) {
        const isSipDetected = sipDetection.some(s => s.schemeName === curr.schemeName)
        increased.push({
          schemeName: curr.schemeName,
          unitsDelta,
          valueDelta,
          reason: isSipDetected ? 'SIP' : 'LUMPSUM'
        })
      } else if (unitsDelta < -0.0001) {
        decreased.push({
          schemeName: curr.schemeName,
          unitsDelta,
          valueDelta,
          reason: 'REDEMPTION'
        })
      } else {
        unchanged.push({
          schemeName: curr.schemeName
        })
      }
    }
  }

  // 6. Portfolio return
  const totalPreviousValue = previousArray.reduce((s, p) => s + p.marketValue, 0)
  const totalCurrentValue = currentArray.reduce((s, c) => s + c.marketValue, 0)

  const nominalReturn = totalPreviousValue > 0 ? ((totalCurrentValue - totalPreviousValue) / totalPreviousValue) * 100 : 0
  let annualizedReturn = 0
  if (totalPreviousValue > 0 && daysBetweenUploads > 0 && totalCurrentValue > 0) {
    annualizedReturn = (Math.pow(totalCurrentValue / totalPreviousValue, 365 / daysBetweenUploads) - 1) * 100
  }

  // 7. Drift from recommendation
  let driftFromRecommendation: DriftReport['driftFromRecommendation'] = null

  if (userId) {
    try {
      const latestApprovedRun = await db
        .select()
        .from(schema.pipelineRuns)
        .where(
          and(
            eq(schema.pipelineRuns.clientId, userId),
            eq(schema.pipelineRuns.status, 'APPROVED')
          )
        )
        .orderBy(desc(schema.pipelineRuns.completedAt))
        .limit(1)

      if (latestApprovedRun.length > 0) {
        const [latestResult] = await db
          .select()
          .from(schema.pipelineResults)
          .where(
            and(
              eq(schema.pipelineResults.pipelineRunId, latestApprovedRun[0].runId),
              eq(schema.pipelineResults.resultType, 'packet')
            )
          )
          .limit(1)

        if (latestResult) {
          const packetData = latestResult.data as any
          const draft = packetData.portfolio_draft || packetData
          const recommendedAllocations = draft.fund_allocations || []

          const recMap = new Map<string, number>()
          const recNameMap = new Map<string, string>()

          for (const rec of recommendedAllocations) {
            const key = rec.scheme_code ? `code:${rec.scheme_code}` : `name:${(rec.fund_name || rec.scheme_name || '').toLowerCase().trim()}`
            const pct = parseFloat(rec.allocation_pct || rec.allocationPct || '0')
            recMap.set(key, pct)
            recNameMap.set(key, rec.fund_name || rec.scheme_name || '')
          }

          const allocationDrift: Array<{ schemeName: string; recommendedWeight: number; currentWeight: number; drift: number }> = []
          const allDriftKeys = new Set([...Array.from(recMap.keys()), ...Array.from(currGrouped.keys())])

          for (const key of allDriftKeys) {
            const recommendedWeight = recMap.get(key) || 0
            const curr = currGrouped.get(key)
            const currentWeight = totalCurrentValue > 0 && curr ? (curr.marketValue / totalCurrentValue) * 100 : 0
            const drift = currentWeight - recommendedWeight

            if (Math.abs(recommendedWeight) > 0.0001 || Math.abs(currentWeight) > 0.0001) {
              const schemeName = curr?.schemeName || recNameMap.get(key) || ''
              allocationDrift.push({
                schemeName,
                recommendedWeight: parseFloat(recommendedWeight.toFixed(2)),
                currentWeight: parseFloat(currentWeight.toFixed(2)),
                drift: parseFloat(drift.toFixed(2))
              })
            }
          }

          const rebalancingNeeded = allocationDrift.some(d => Math.abs(d.drift) > 5)
          let rebalancingUrgency: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW'
          if (allocationDrift.some(d => Math.abs(d.drift) > 10)) {
            rebalancingUrgency = 'HIGH'
          } else if (rebalancingNeeded) {
            rebalancingUrgency = 'MEDIUM'
          }

          driftFromRecommendation = {
            allocationDrift,
            rebalancingNeeded,
            rebalancingUrgency
          }
        }
      }
    } catch (err) {
      logger.error({ err, userId }, 'detectDrift: Failed to calculate recommendation plan drift')
    }
  }

  return {
    uploadedAt,
    previousUploadAt,
    daysBetweenUploads,
    changes: {
      newPositions,
      exitedPositions,
      increased,
      decreased,
      unchanged
    },
    portfolioReturn: {
      nominalReturn: parseFloat(nominalReturn.toFixed(2)),
      periodDays: daysBetweenUploads,
      annualizedReturn: parseFloat(annualizedReturn.toFixed(2))
    },
    sipDetection,
    driftFromRecommendation
  }
}
