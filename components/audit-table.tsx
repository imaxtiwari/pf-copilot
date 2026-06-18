'use client'

import React, { useEffect, useState } from 'react'
import { AuditLog } from '@/lib/audit/audit-trail'

export function AuditTable({ pipelineRunId }: { pipelineRunId?: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLogs() {
      try {
        const url = pipelineRunId ? `/api/audit?pipeline_run_id=${pipelineRunId}` : '/api/audit'
        const res = await fetch(url)
        const data = await res.json()
        if (data.logs) {
          setLogs(data.logs)
        }
      } catch (err) {
        console.error('Failed to fetch audit logs:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchLogs()
  }, [pipelineRunId])

  if (loading) return <div>Loading audit trail...</div>

  return (
    <div className="overflow-x-auto w-full">
      <table className="min-w-full divide-y divide-gray-200 text-sm text-left">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 font-medium text-gray-900">Timestamp</th>
            <th className="px-4 py-3 font-medium text-gray-900">Agent</th>
            <th className="px-4 py-3 font-medium text-gray-900">Action</th>
            <th className="px-4 py-3 font-medium text-gray-900">Oracle Confidence</th>
            <th className="px-4 py-3 font-medium text-gray-900">Payload Hash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {logs.map((log) => {
            let confidenceColor = 'text-gray-500'
            let confidenceText = '—'
            
            if (log.oracle_confidence !== undefined && log.oracle_confidence !== null) {
              const score = log.oracle_confidence
              confidenceText = score.toString()
              if (score >= 80) confidenceColor = 'text-green-600 font-semibold'
              else if (score >= 50) confidenceColor = 'text-yellow-600 font-semibold'
              else confidenceColor = 'text-red-600 font-semibold'
            }

            return (
              <tr key={log.log_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                  {new Date(log.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                  {log.agent_id}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                  {log.action_type}
                </td>
                <td className={`px-4 py-3 whitespace-nowrap ${confidenceColor}`}>
                  {confidenceText}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 font-mono truncate max-w-xs">
                  {log.payload_hash}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {logs.length === 0 && (
        <div className="p-4 text-center text-gray-500">No audit logs found.</div>
      )}
    </div>
  )
}
