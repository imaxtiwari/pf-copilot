'use client'
import { useState, useEffect, type FormEvent } from 'react'
import InflationResultView from '../../components/inflation-result'
import type { InflationResult } from '../../lib/inflation/compute'

type CityTier = 'metro' | 'tier2' | 'tier3'
type Dependents = 'none' | 'spouse' | 'kids' | 'parents' | 'multiple'
type MedicalAnswer = 'none' | 'yes' | 'prefer_not'

interface FormState {
  age: string
  city_tier: CityTier | ''
  living: 'rent' | 'own' | ''
  monthly_rent: string
  dependents: Dependents | ''
  medical: MedicalAnswer | ''
}

export default function OnboardingPage() {
  const [form, setForm] = useState<FormState>({
    age: '',
    city_tier: '',
    living: '',
    monthly_rent: '',
    dependents: '',
    medical: '',
  })
  const [result, setResult] = useState<InflationResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((res) => {
        if (res.ok && res.data.profile) {
          const p = res.data.profile
          setForm({
            age: p.age != null ? String(p.age) : '',
            city_tier: p.cityTier ?? '',
            living: p.ownsHome ? 'own' : p.monthlyRent && Number(p.monthlyRent) > 0 ? 'rent' : '',
            monthly_rent: p.monthlyRent ? String(p.monthlyRent) : '',
            dependents: p.dependents ?? '',
            medical: p.medicalConditions ? 'yes' : 'none',
          })
        }
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!form.age || !form.city_tier || !form.living || !form.dependents || !form.medical) {
      setError('Please answer all questions.')
      return
    }

    const age = parseInt(form.age, 10)
    if (isNaN(age) || age < 18 || age > 100) {
      setError('Age must be between 18 and 100.')
      return
    }

    const owns_home = form.living === 'own'
    const monthly_rent = owns_home ? 0 : Math.max(0, parseFloat(form.monthly_rent) || 0)
    const medical_conditions = form.medical === 'yes'

    setSubmitting(true)
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age,
          city_tier: form.city_tier,
          monthly_rent,
          owns_home,
          dependents: form.dependents,
          medical_conditions,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error?.message ?? 'Submission failed. Please try again.')
        return
      }
      setResult(json.data.inflation)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Your Inflation Profile</h1>
        <InflationResultView result={result} />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Set up your profile</h1>
      <p className="mb-8 text-sm text-gray-500">
        5 quick questions to estimate your personal inflation rate.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        {/* Q1: Age */}
        <fieldset>
          <legend className="mb-2 font-semibold">1. How old are you?</legend>
          <input
            type="number"
            min={18}
            max={100}
            placeholder="e.g. 35"
            value={form.age}
            onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
            className="w-32 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </fieldset>

        {/* Q2: City type */}
        <fieldset>
          <legend className="mb-2 font-semibold">2. What type of city do you live in?</legend>
          <div className="flex flex-col gap-2">
            {(
              [
                { val: 'metro', label: 'Metro (Mumbai, Delhi, Bengaluru, Chennai…)' },
                { val: 'tier2', label: 'Tier 2 (Pune, Hyderabad, Jaipur, Lucknow…)' },
                { val: 'tier3', label: 'Tier 3 / Rural' },
              ] as const
            ).map(({ val, label }) => (
              <label key={val} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="city_tier"
                  value={val}
                  checked={form.city_tier === val}
                  onChange={() => setForm((f) => ({ ...f, city_tier: val }))}
                  className="accent-indigo-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Q3: Living situation */}
        <fieldset>
          <legend className="mb-2 font-semibold">3. What is your living situation?</legend>
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="living"
                value="rent"
                checked={form.living === 'rent'}
                onChange={() => setForm((f) => ({ ...f, living: 'rent', monthly_rent: '' }))}
                className="accent-indigo-600"
              />
              <span className="text-sm">I rent</span>
            </label>
            {form.living === 'rent' && (
              <div className="ml-6 flex items-center gap-2">
                <span className="text-sm text-gray-500">₹</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Monthly rent"
                  value={form.monthly_rent}
                  onChange={(e) => setForm((f) => ({ ...f, monthly_rent: e.target.value }))}
                  className="w-40 rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <span className="text-sm text-gray-500">/ month</span>
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="living"
                value="own"
                checked={form.living === 'own'}
                onChange={() => setForm((f) => ({ ...f, living: 'own', monthly_rent: '' }))}
                className="accent-indigo-600"
              />
              <span className="text-sm">I own my home</span>
            </label>
          </div>
        </fieldset>

        {/* Q4: Dependents */}
        <fieldset>
          <legend className="mb-2 font-semibold">4. Who are your financial dependents?</legend>
          <div className="flex flex-col gap-2">
            {(
              [
                { val: 'none', label: 'None' },
                { val: 'spouse', label: 'Spouse / partner' },
                { val: 'kids', label: 'Kids' },
                { val: 'parents', label: 'Parents' },
                { val: 'multiple', label: 'Multiple (e.g. spouse + kids)' },
              ] as const
            ).map(({ val, label }) => (
              <label key={val} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="dependents"
                  value={val}
                  checked={form.dependents === val}
                  onChange={() => setForm((f) => ({ ...f, dependents: val }))}
                  className="accent-indigo-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Q5: Medical conditions */}
        <fieldset>
          <legend className="mb-2 font-semibold">
            5. Any significant ongoing medical conditions in your household?
          </legend>
          <div className="flex flex-col gap-2">
            {(
              [
                { val: 'none', label: 'None' },
                { val: 'yes', label: 'Yes' },
                { val: 'prefer_not', label: 'Prefer not to say' },
              ] as const
            ).map(({ val, label }) => (
              <label key={val} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="medical"
                  value={val}
                  checked={form.medical === val}
                  onChange={() => setForm((f) => ({ ...f, medical: val }))}
                  className="accent-indigo-600"
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            &quot;Prefer not to say&quot; is treated as no medical conditions for this estimate.
          </p>
        </fieldset>

        {error && (
          <p className="rounded bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Calculating…' : 'Calculate my inflation rate →'}
        </button>
      </form>
    </main>
  )
}
