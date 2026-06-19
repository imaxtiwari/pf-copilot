import { createHash } from 'crypto'

export function mockEmbedding(text: string): Float32Array {
  const embedding = new Float32Array(1536)
  const len = text.length
  let hash = 0
  for (let i = 0; i < len; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i)
    hash |= 0
  }
  for (let i = 0; i < 1536; i++) {
    embedding[i] = Math.sin(hash + i) * 0.1
  }
  return embedding
}

export function mockChatCompletion(model: string, messages: any[]): string {
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || ''

  // 1. Oracle internal contradictions check
  if (lastUserMessage.includes('internal contradictions') || lastUserMessage.includes('contradictions')) {
    return JSON.stringify({ contradictions: [] })
  }

  // 2. Vikram Client Interview questions
  if (lastUserMessage.includes('client interview questions') || lastUserMessage.includes('interview questions')) {
    return JSON.stringify([
      "What is your target investment horizon for each goal?",
      "How much do you plan to increase your monthly SIP contribution annually?",
      "Do you have any near-term liquid needs in the next 12-24 months?",
      "Are there any specific sector exposures you wish to avoid?",
      "Do you require regular cash flows from your investments?",
      "What are your thoughts on international equity exposure?",
      "Do you have a preference for active or passive fund management?",
      "What is your primary source of household income?",
      "Are there any anticipated large expenses in the next 5 years?",
      "Do you maintain an independent emergency corpus?",
      "How often do you plan to review your goal targets?",
      "What is your comfort level with small cap fund volatility?",
      "Do you have existing term or health insurance coverage?",
      "Is debt fund indexation benefit important to you?",
      "What percentage of your goals is non-negotiable?"
    ])
  }

  // 3. Vikram Strategy Framework Selection
  if (lastUserMessage.includes('Select the most appropriate investment strategy frameworks')) {
    return JSON.stringify({
      selected_frameworks: [
        {
          name: "Core-Satellite Framework",
          description: "Puts 70% in low-cost index funds and 30% in active themes.",
          why_applicable: "Matches client's risk profile.",
          source_url: "https://sebi.gov.in"
        }
      ],
      asset_allocation_guidance: {
        equity_pct_range: [60, 80],
        debt_pct_range: [10, 20],
        gold_pct_range: [5, 10],
        international_pct_range: [5, 10]
      }
    })
  }

  // 4. Vikram Goal Assessment revision plan
  if (lastUserMessage.includes('Formulate a revised investment plan')) {
    return "Since the original CAGR and monthly SIP expectations are unrealistic, we propose re-adjusting target dates or increasing monthly SIP contributions."
  }

  // 4b. Kiran buildHedgeMap
  if (lastUserMessage.includes('risk hedge scenario') || lastUserMessage.includes('contingency plan')) {
    return JSON.stringify({
      risk_scenario: "If market rates rise, this allocation will yield higher returns.",
      hedge_instrument: "Short-term debt funds indexation.",
      hedge_rationale: "Mitigates long-term interest rate risk.",
      contingency_if_hedge_fails: "Move to overnight liquid funds."
    })
  }

  // 4c. Kiran runStressTest
  if (lastUserMessage.includes('portfolio-level impact under the scenario') || lastUserMessage.includes('worst_case_drawdown_pct')) {
    return JSON.stringify({
      estimated_portfolio_return_pct: -10.5,
      worst_case_drawdown_pct: 15.0,
      recovery_timeline_months: 6,
      most_affected_funds: [],
      stress_rationale: "Portfolio is well hedged with debt allocation."
    })
  }

  // 5. Aria Critique Goal Plan
  if (lastUserMessage.includes('client goal plan assessment')) {
    return JSON.stringify({
      faults: [],
      overall_assessment: "Goal plan looks viable."
    })
  }

  // 6. Priya Portfolio Design (Bucket list + Allocations)
  if (lastUserMessage.includes('Generate a goal bucket list and specific mutual fund allocations')) {
    return JSON.stringify({
      goal_buckets: [
        {
          bucket_id: "00000000-0000-4000-8000-000000000001",
          goal_id: "00000000-0000-4000-9000-000000000001",
          goal_type: "RETIREMENT",
          target_corpus_lakh: 100,
          target_date: "2036-06-16",
          time_horizon_years: 10,
          risk_profile: "MODERATE",
          allocation_pct: 100
        }
      ],
      fund_allocations: [
        {
          allocation_id: "00000000-0000-4000-8000-000000000002",
          fund_name: "360 ONE Nifty 50 Index Fund",
          isin: "INF846K01DP8",
          scheme_code: "151165",
          allocation_pct: 100,
          goal_bucket_id: "00000000-0000-4000-8000-000000000001",
          rationale: "Sourced from amfiindia.com. Low expense ratio index fund matching the core allocation strategy."
        }
      ]
    })
  }

  // 7. Aria respond to counter-argument
  if (lastUserMessage.includes("Respond to the client or agent's counter-argument")) {
    if (lastUserMessage.includes('compliance')) {
      return JSON.stringify({
        fault_category: "CONCENTRATION",
        fault_description: "The concentration risk is mitigated by new evidence.",
        evidence_sources: [
          { url: "https://sebi.gov.in", excerpt_summary: "Mitigated by AMC compliance check." }
        ],
        severity: "MINOR",
        suggested_remedy: "Monitor AMC allocations.",
        confidence_tier: "VERIFIED"
      })
    } else {
      return JSON.stringify({
        fault_category: "CONCENTRATION",
        fault_description: "Overweight in a single AMC. No new evidence provided.",
        evidence_sources: [
          { url: "https://sebi.gov.in", excerpt_summary: "Confirmed AMC concentration exceeds guidelines." }
        ],
        severity: "CRITICAL",
        suggested_remedy: "Diversify across multiple AMCs.",
        confidence_tier: "VERIFIED"
      })
    }
  }

  // 8. Aria Critique Portfolio Draft
  if (lastUserMessage.includes('Analyze the following portfolio draft')) {
    if (lastUserMessage.includes('AMC_80_PERCENT_MOCK') || lastUserMessage.includes('80% in one AMC')) {
      return JSON.stringify({
        faults: [
          {
            fault_category: "CONCENTRATION",
            fault_description: "Portfolio has 80% in one AMC.",
            evidence_sources: [{ url: "https://sebi.gov.in", excerpt_summary: "AMC concentration fault." }],
            severity: "CRITICAL",
            suggested_remedy: "Limit AMC weight to less than 40%.",
            confidence_tier: "VERIFIED"
          }
        ],
        overall_assessment: "Portfolio rejected due to high AMC concentration."
      })
    }
    if (lastUserMessage.includes("selection_criterion: '1-year return'") || lastUserMessage.includes('1-year return')) {
      return JSON.stringify({
        faults: [
          {
            fault_category: "RECENCY_BIAS",
            fault_description: "1-year return used as primary selection criterion.",
            evidence_sources: [{ url: "https://valueresearchonline.com", excerpt_summary: "Recency bias fault." }],
            severity: "CRITICAL",
            suggested_remedy: "Use rolling 3-year or 5-year returns.",
            confidence_tier: "VERIFIED"
          }
        ],
        overall_assessment: "Portfolio rejected due to recency bias in selection."
      })
    }
    if (lastUserMessage.includes('no_faults_portfolio')) {
      return JSON.stringify({
        faults: [],
        overall_assessment: "Portfolio looks well diversified."
      })
    }
    return JSON.stringify({
      faults: [],
      overall_assessment: "Portfolio looks well diversified."
    })
  }

  // 9. Kiran Macro Scan bulletin
  if (lastUserMessage.includes('compile the daily 8-point MacroRiskBulletin')) {
    return JSON.stringify({
      risk_level: "LOW",
      rbi_policy_signal: "STABLE",
      fed_signal: "STABLE",
      india_vix: 13.5,
      india_vix_trend: "STABLE",
      brent_crude_usd: 82.0,
      gold_mcx_inr: 72000.0,
      usdinr_rate: 83.4,
      usdinr_trend: "STABLE",
      fii_net_flow_cr: 150.0,
      geopolitical_alerts: [],
      key_risks: ["Inflation risk"],
      key_observations: ["Good growth numbers"]
    })
  }

  // 10. Dhruv Portfolio Executive Summary
  if (lastUserMessage.includes("Generate a concise executive summary for the client's final portfolio")) {
    return "Mock final portfolio recommendation executive summary."
  }

  // 12. Vikram Hypothesis-First flow
  if (lastUserMessage.includes('GoalHypothesis') || lastUserMessage.includes('VIKRAM_HYPOTHESIS_PROMPT')) {
    return JSON.stringify({
      hypothesis_id: "00000000-0000-4000-8000-000000000003",
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2036,
      goal_description: "Accumulate wealth for standard requirements.",
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: "ACHIEVABLE",
      assumed_expenses: {
        rent_lakh: 0.25,
        city_tier: "Tier-1",
        dependents: "none assumed — typical for this age/income profile"
      },
      risk_profile: "MODERATE",
      strategy_framework: "core-satellite",
      assumptions: [
        {
          field: "Monthly Rent",
          value: "₹25,000/month",
          reasoning: "Typical rent for a Tier-1 city."
        },
        {
          field: "Dependents",
          value: "None",
          reasoning: "Assumed single without dependents."
        }
      ],
      confidence: 80
    })
  }

  if (lastUserMessage.includes('merge corrections into the hypothesis') || lastUserMessage.includes('UserCorrectionSchema')) {
    return JSON.stringify({
      hypothesis_id: "00000000-0000-4000-8000-000000000003",
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2036,
      goal_description: "Accumulate wealth for standard requirements.",
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.3,
      required_cagr_pct: 12.0,
      cagr_feasibility: "ACHIEVABLE",
      assumed_expenses: {
        rent_lakh: 0.15,
        city_tier: "Tier-1",
        dependents: "none assumed — typical for this age/income profile"
      },
      risk_profile: "MODERATE",
      strategy_framework: "core-satellite",
      assumptions: [
        {
          field: "Monthly Rent",
          value: "₹15,000/month",
          reasoning: "Updated rent by user correction."
        },
        {
          field: "Dependents",
          value: "None",
          reasoning: "Assumed single without dependents."
        }
      ],
      confidence: 80
    })
  }

  return '{}'
}

