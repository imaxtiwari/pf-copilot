'use client'

import React, { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Dot
} from 'recharts'

interface TrajectoryPoint {
  revisionCycle: number
  confidenceScore: number
  ariaFaults: {
    CRITICAL: number
    MAJOR: number
    MINOR: number
    OBSERVATION: number
  }
  timestamp: string
  outcome: 'APPROVED' | 'REVISION' | 'DEADLOCK' | 'IN_PROGRESS' | 'FAILED'
}

interface ConfidenceTrajectoryProps {
  pipelineRunId: string
}

export function ConfidenceTrajectory({ pipelineRunId }: ConfidenceTrajectoryProps) {
  const [data, setData] = useState<TrajectoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTrajectory = async () => {
      try {
        const res = await fetch(`/api/pipeline/${pipelineRunId}/trajectory`)
        if (!res.ok) throw new Error('Failed to load trajectory data')
        const json = await res.json()
        setData(json.trajectory || [])
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchTrajectory()
  }, [pipelineRunId])

  if (loading) {
    return (
      <div className="w-full h-64 rounded-xl bg-gray-100 animate-pulse" />
    )
  }

  if (error) {
    return <div className="text-red-500 text-sm">Error loading trajectory: {error}</div>
  }

  if (data.length === 0) {
    return <div className="text-gray-500 text-sm">No draft data available yet.</div>
  }

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props
    let fill = '#ef4444' // red for < 50
    if (payload.confidenceScore >= 70) fill = '#22c55e' // green
    else if (payload.confidenceScore >= 50) fill = '#eab308' // yellow

    return (
      <Dot cx={cx} cy={cy} r={6} fill={fill} stroke="#fff" strokeWidth={2} />
    )
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as TrajectoryPoint
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-md text-sm text-gray-800 space-y-1">
          <p className="font-semibold mb-2">Cycle {data.revisionCycle}</p>
          <p>Confidence: <span className="font-medium">{data.confidenceScore.toFixed(1)}</span></p>
          <p>Outcome: <span className="font-medium">{data.outcome}</span></p>
          <div className="pt-2 mt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">ARIA Faults:</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-red-600">Critical: {data.ariaFaults.CRITICAL}</span>
              <span className="text-orange-500">Major: {data.ariaFaults.MAJOR}</span>
              <span className="text-yellow-600">Minor: {data.ariaFaults.MINOR}</span>
              <span className="text-blue-500">Obs: {data.ariaFaults.OBSERVATION}</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  const finalPoint = data[data.length - 1]
  const isConverged = finalPoint.outcome === 'APPROVED'
  const isDiverged = data.length >= 3 && data[data.length - 1].confidenceScore < data[data.length - 2].confidenceScore

  const outcomeColors: Record<string, string> = {
    APPROVED: 'bg-green-100 text-green-800',
    DEADLOCK: 'bg-red-100 text-red-700',
    FAILED: 'bg-red-100 text-red-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    REVISION: 'bg-yellow-100 text-yellow-700'
  }

  return (
    <div className="w-full bg-white rounded-xl border p-5 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-lg text-gray-900">Confidence Trajectory</h3>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${outcomeColors[finalPoint.outcome] ?? 'bg-gray-100 text-gray-700'}`}>
          {finalPoint.outcome}
        </span>
      </div>
      
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis 
              dataKey="revisionCycle" 
              tickFormatter={(val) => `v${val}`}
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              domain={[0, 100]} 
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <ReferenceLine y={60} stroke="#9ca3af" strokeDasharray="4 4" label={{ position: 'insideTopLeft', value: 'Approval Min (60)', fill: '#9ca3af', fontSize: 10 }} />
            <Line 
              type="monotone" 
              dataKey="confidenceScore" 
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={<CustomDot />}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 text-center text-sm">
        {isConverged ? (
          <p className="text-green-600 font-medium">Pipeline converged in {data.length} cycles</p>
        ) : isDiverged ? (
          <p className="text-red-500 font-medium">Pipeline is diverging at cycle {data.length}</p>
        ) : finalPoint.outcome === 'DEADLOCK' ? (
          <p className="text-red-600 font-medium">Pipeline deadlocked at cycle {data.length}</p>
        ) : (
          <p className="text-gray-500">Pipeline in progress (Cycle {data.length})</p>
        )}
      </div>
    </div>
  )
}
