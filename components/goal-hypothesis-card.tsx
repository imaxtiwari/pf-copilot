'use client'

import React, { useState } from 'react'

export interface GoalHypothesisAssumption {
  field: string
  value: string
  reasoning: string
}

export interface GoalHypothesis {
  hypothesis_id: string
  generated_at: string
  corpus_target_lakh: number
  corpus_target_year: number
  goal_description: string
  monthly_sip_required_lakh: number
  current_monthly_savings_lakh: number
  required_cagr_pct: number
  cagr_feasibility: 'ACHIEVABLE' | 'AGGRESSIVE' | 'UNREALISTIC'
  assumed_expenses: {
    rent_lakh: number
    city_tier: string
    dependents: string
  }
  risk_profile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE'
  strategy_framework: string
  assumptions: GoalHypothesisAssumption[]
  confidence: number
}

interface GoalHypothesisCardProps {
  hypothesis: GoalHypothesis
  pipelineRunId: string
  onConfirm: (corrections: string[]) => void
}

export function GoalHypothesisCard({ hypothesis, pipelineRunId, onConfirm }: GoalHypothesisCardProps) {
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('')
  const [showExplainTextArea, setShowExplainTextArea] = useState(false)
  const [explainText, setExplainText] = useState('')

  const handleStartEdit = (field: string, currentValue: string) => {
    setEditField(field)
    setEditValue(customValues[field] || currentValue)
  }

  const handleSaveEdit = (field: string) => {
    setCustomValues(prev => ({ ...prev, [field]: editValue }))
    setEditField(null)
  }

  const handleCancelEdit = () => {
    setEditField(null)
  }

  const handleSubmit = () => {
    const corrections: string[] = []

    hypothesis.assumptions.forEach(ass => {
      const customVal = customValues[ass.field]
      if (customVal && customVal.trim() !== ass.value.trim()) {
        corrections.push(`${ass.field}: was "${ass.value}", now "${customVal}"`)
      }
    })

    if (showExplainTextArea && explainText.trim()) {
      corrections.push(`User feedback: ${explainText.trim()}`)
    }

    onConfirm(corrections)
  }

  const feasibilityStyles = {
    ACHIEVABLE: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    AGGRESSIVE: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    UNREALISTIC: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
  }

  const riskStyles = {
    CONSERVATIVE: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    MODERATE: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    AGGRESSIVE: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  }

  return (
    <div className="w-full max-w-3xl mx-auto bg-slate-900 border border-slate-880 rounded-2xl p-6 md:p-8 shadow-2xl text-slate-200 font-sans">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-slate-800 pb-5 mb-6 gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
            Goal Hypothesis Proposal
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            VIKRAM generated this profile based on your initial responses.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono">Confidence</span>
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 border border-slate-800 rounded-lg">
            <div className="w-16 bg-slate-800 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-indigo-500 h-full rounded-full" 
                style={{ width: `${hypothesis.confidence}%` }}
              />
            </div>
            <span className="text-xs font-bold text-indigo-400">{hypothesis.confidence}%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Target Goal</span>
            <h3 className="text-lg font-bold text-white mt-1 mb-2">{hypothesis.goal_description}</h3>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-905">
            <div>
              <span className="text-xs text-slate-500 block">Target Corpus</span>
              <span className="text-base font-bold text-white font-mono">₹{hypothesis.corpus_target_lakh} Lakhs</span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block">Target Year</span>
              <span className="text-base font-bold text-white font-mono">{hypothesis.corpus_target_year}</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-850 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Required Return Profile</span>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-2xl font-black text-white font-mono">{hypothesis.required_cagr_pct.toFixed(1)}%</span>
              <span className="text-xs font-semibold text-slate-500">CAGR Required</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-905">
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${feasibilityStyles[hypothesis.cagr_feasibility]}`}>
              {hypothesis.cagr_feasibility}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${riskStyles[hypothesis.risk_profile]}`}>
              {hypothesis.risk_profile} Risk
            </span>
          </div>
        </div>
      </div>

      <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">SIP vs Monthly Savings Gap</span>
          <span className="text-xs text-slate-400">Values in Lakhs</span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mb-3">
          <div>
            <span className="text-slate-400 block text-xs">Required SIP</span>
            <span className="font-bold text-white font-mono">₹{hypothesis.monthly_sip_required_lakh.toFixed(2)}L /mo</span>
          </div>
          <div>
            <span className="text-slate-400 block text-xs">Estimated Savings</span>
            <span className="font-bold text-slate-300 font-mono">₹{hypothesis.current_monthly_savings_lakh.toFixed(2)}L /mo</span>
          </div>
        </div>
        {hypothesis.monthly_sip_required_lakh > hypothesis.current_monthly_savings_lakh ? (
          <div className="text-xs text-amber-400 flex items-start gap-2 bg-amber-955/20 p-2.5 rounded-lg border border-amber-900/30">
            <svg className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>
              Your estimated savings are ₹{(hypothesis.monthly_sip_required_lakh - hypothesis.current_monthly_savings_lakh).toFixed(2)}L short of the required monthly SIP. We will plan to address this gap during portfolio construction.
            </span>
          </div>
        ) : (
          <div className="text-xs text-emerald-400 flex items-start gap-2 bg-emerald-955/20 p-2.5 rounded-lg border border-emerald-900/30">
            <svg className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Great! Your estimated savings are sufficient to fully cover the required monthly SIP.
            </span>
          </div>
        )}
      </div>

      <div className="mb-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Assumptions & Demographics
        </h3>
        <div className="bg-slate-950 border border-slate-850 rounded-xl overflow-hidden divide-y divide-slate-900">
          {hypothesis.assumptions.map((ass) => {
            const hasCustomValue = customValues[ass.field] !== undefined
            const displayValue = hasCustomValue ? customValues[ass.field] : ass.value
            const isEditing = editField === ass.field

            return (
              <div key={ass.field} className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 hover:bg-slate-900/30 transition-colors">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-300 text-sm">{ass.field}</span>
                    {hasCustomValue && (
                      <span className="text-[10px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">
                        Edited
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{ass.reasoning}</p>
                </div>
                
                <div className="flex items-center gap-3 shrink-0 self-end md:self-start">
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        autoFocus
                      />
                      <button
                        onClick={() => handleSaveEdit(ass.field)}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg p-1.5 transition-colors"
                        title="Save"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="bg-slate-800 hover:bg-slate-750 text-slate-400 rounded-lg p-1.5 transition-colors"
                        title="Cancel"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 group">
                      <span className="font-mono text-sm text-white font-bold bg-slate-900 px-3 py-1 rounded-lg border border-slate-850">
                        {displayValue}
                      </span>
                      <button
                        onClick={() => handleStartEdit(ass.field, ass.value)}
                        className="text-slate-500 hover:text-white p-1 hover:bg-slate-900 rounded-lg transition-all"
                        title="Edit value"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mb-6 border-t border-slate-900 pt-4">
        {!showExplainTextArea ? (
          <button
            onClick={() => setShowExplainTextArea(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold group transition-all"
          >
            Something looks completely wrong? Click here to explain in detail.
            <svg className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Additional Comments / Corrections
              </label>
              <button
                onClick={() => {
                  setShowExplainTextArea(false)
                  setExplainText('')
                }}
                className="text-xs text-rose-400 hover:text-rose-300"
              >
                Hide
              </button>
            </div>
            <textarea
              value={explainText}
              onChange={(e) => setExplainText(e.target.value)}
              placeholder="e.g. 'I do not pay rent because I live with my parents. Also, my monthly savings are closer to ₹1.5L.'"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-600 min-h-[80px]"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-850">
        <button
          onClick={handleSubmit}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-indigo-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm"
        >
          {Object.keys(customValues).length > 0 || (showExplainTextArea && explainText.trim()) ? (
            <>
              Apply corrections & build portfolio
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </>
          ) : (
            <>
              Looks correct — Build portfolio
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
