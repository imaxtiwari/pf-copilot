'use client'

import React, { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { GoalHypothesisCard, GoalHypothesis } from '@/components/goal-hypothesis-card'

interface EssentialAnswers {
  age: number
  monthly_take_home_lakh: number
  biggest_goal: string
  goal_timeline_years: number
  risk_reaction: 'A' | 'B' | 'C'
}

export default function HypothesisInterviewPage() {
  const params = useParams()
  const router = useRouter()
  const runId = params.runId as string

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hypothesis, setHypothesis] = useState<GoalHypothesis | null>(null)
  const [success, setSuccess] = useState(false)

  const [formAnswers, setFormAnswers] = useState<EssentialAnswers>({
    age: 30,
    monthly_take_home_lakh: 1.5,
    biggest_goal: '',
    goal_timeline_years: 10,
    risk_reaction: 'B'
  })

  // Fetch existing hypothesis if any on mount
  useEffect(() => {
    if (!runId) return

    async function checkExistingHypothesis() {
      try {
        const res = await fetch(`/api/pipeline/${runId}/interview`)
        if (res.ok) {
          const data = await res.json()
          if (data.hypothesis) {
            setHypothesis(data.hypothesis)
            // Pre-fill answers with hypothesis values to match if edited later
            setFormAnswers({
              age: data.hypothesis.assumed_expenses?.age || 30, // Fallback if not stored
              monthly_take_home_lakh: data.hypothesis.current_monthly_savings_lakh || 1.5, // Fallback
              biggest_goal: data.hypothesis.goal_description || '',
              goal_timeline_years: (data.hypothesis.corpus_target_year - new Date().getFullYear()) || 10,
              risk_reaction: data.hypothesis.risk_profile === 'AGGRESSIVE' ? 'C' : data.hypothesis.risk_profile === 'CONSERVATIVE' ? 'A' : 'B'
            })
          }
        }
      } catch (err) {
        console.error('Failed to check existing hypothesis', err)
      } finally {
        setLoading(false)
      }
    }

    checkExistingHypothesis()
  }, [runId])

  // Phase 1 submission: Generate GoalHypothesis
  const handleGenerateHypothesis = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formAnswers.biggest_goal || formAnswers.biggest_goal.length < 5) {
      setError('Please describe your biggest goal in at least 5 characters.')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`/api/pipeline/${runId}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'hypothesis',
          essential_answers: formAnswers,
          finalize: false
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate hypothesis')
      }

      setHypothesis(data.hypothesis)
    } catch (err: any) {
      setError(err.message || 'An error occurred while generating your goal hypothesis.')
    } finally {
      setSubmitting(false)
    }
  }

  // Phase 2 submission: Finalize with corrections
  const handleConfirmHypothesis = async (corrections: string[]) => {
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(`/api/pipeline/${runId}/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'hypothesis',
          essential_answers: formAnswers,
          corrections: corrections,
          finalize: true
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to finalize portfolio draft')
      }

      setSuccess(true)
      setTimeout(() => {
        router.push('/portfolio')
      }, 3000)
    } catch (err: any) {
      setError(err.message || 'An error occurred while finalizing your portfolio.')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 text-sm font-medium tracking-wide">Querying strategy desk...</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
          <div className="mx-auto h-16 w-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center border border-emerald-500/20">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white">Hypothesis Finalized!</h2>
            <p className="text-sm text-slate-400">
              The portfolio intelligence agents are constructing and voting on your customized investment plan.
            </p>
          </div>
          <div className="text-xs text-indigo-400 animate-pulse font-medium">
            Redirecting to your portfolio dashboard...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-center">
      {error && (
        <div className="mb-6 max-w-3xl w-full bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
          <svg className="h-5 w-5 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {hypothesis ? (
        <GoalHypothesisCard 
          hypothesis={hypothesis} 
          pipelineRunId={runId} 
          onConfirm={handleConfirmHypothesis} 
        />
      ) : (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl text-slate-200">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-white tracking-tight">Tell us about your goal</h1>
            <p className="text-slate-400 text-sm mt-1.5">
              Just 5 questions for VIKRAM to formulate your hypothesis.
            </p>
          </div>

          <form onSubmit={handleGenerateHypothesis} className="space-y-5">
            {/* Q1: Age */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                1. What is your age?
              </label>
              <input
                type="number"
                min={18}
                max={100}
                required
                value={formAnswers.age}
                onChange={(e) => setFormAnswers(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-700"
                placeholder="e.g. 30"
              />
            </div>

            {/* Q2: Monthly Income */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                2. Monthly take-home income (in Lakhs)
              </label>
              <input
                type="number"
                step="0.05"
                min={0.1}
                required
                value={formAnswers.monthly_take_home_lakh}
                onChange={(e) => setFormAnswers(prev => ({ ...prev, monthly_take_home_lakh: parseFloat(e.target.value) || 0 }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-700"
                placeholder="e.g. 1.5"
              />
            </div>

            {/* Q3: Stated Goal */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                3. What is your biggest financial goal?
              </label>
              <input
                type="text"
                required
                value={formAnswers.biggest_goal}
                onChange={(e) => setFormAnswers(prev => ({ ...prev, biggest_goal: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-705"
                placeholder="e.g. Purchase a home or build retirement corpus"
              />
            </div>

            {/* Q4: Goal Timeline */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                4. Target timeline for that goal (in years)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={formAnswers.goal_timeline_years}
                onChange={(e) => setFormAnswers(prev => ({ ...prev, goal_timeline_years: parseInt(e.target.value) || 0 }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-700"
                placeholder="e.g. 10"
              />
            </div>

            {/* Q5: Risk Reaction */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                5. How would you feel if your portfolio dropped 20% in a year?
              </label>
              <div className="space-y-2.5">
                {(
                  [
                    { val: 'A', label: 'A - Panic and sell' },
                    { val: 'B', label: 'B - Worried but hold' },
                    { val: 'C', label: 'C - Buy more' },
                  ] as const
                ).map(({ val, label }) => (
                  <label 
                    key={val} 
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                      formAnswers.risk_reaction === val 
                        ? 'bg-indigo-950/20 border-indigo-500 text-white' 
                        : 'bg-slate-950 border-slate-800 hover:bg-slate-900/50 text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="risk_reaction"
                      value={val}
                      checked={formAnswers.risk_reaction === val}
                      onChange={() => setFormAnswers(prev => ({ ...prev, risk_reaction: val }))}
                      className="sr-only"
                    />
                    <span className={`h-4.5 w-4.5 rounded-full border flex items-center justify-center shrink-0 ${
                      formAnswers.risk_reaction === val
                        ? 'border-indigo-500 text-indigo-500'
                        : 'border-slate-700 text-transparent'
                    }`}>
                      {formAnswers.risk_reaction === val && (
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      )}
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3.5 rounded-xl shadow-lg hover:shadow-indigo-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 mt-2"
            >
              {submitting ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Generating Hypothesis...
                </>
              ) : (
                <>
                  Generate Hypothesis
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
