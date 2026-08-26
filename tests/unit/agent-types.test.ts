import { describe, it, expect } from 'vitest'
import {
  PipelineStageSchema,
  CommitteeVoteRecordSchema,
  DeadlockReportSchema,
  FinalPortfolioPacketSchema,
  ClientGoalAssessmentSchema,
  GoalHypothesisSchema,
  StrategyFrameworkSchema,
  MarketContextBriefSchema,
  StructuredInterviewAnswersSchema,
  MacroRiskBulletinSchema,
  ClientRiskProfileSchema,
  HedgeMapSchema,
  ScenarioStressTestSchema,
  CritiqueReportSchema,
  PreflightContextSchema,
  PreflightReportSchema,
  FundProfileSchema,
  FundComparisonMatrixSchema,
  CompositionAuditSchema,
  FundWatchlistAlertSchema,
  FundUniverseSchema,
  PortfolioDraftSchema,
  BacktestSummarySchema,
  PortfolioConfidenceScoreSchema,
  LifeEventSchema,
} from '@/lib/agents/types'

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

function makeFundProfile() {
  return {
    scheme_code: 'INF209K01UN8',
    isin: 'INF209K01UN8',
    scheme_name: 'Test Equity Fund',
    amc: 'Test AMC',
    scheme_type: 'equity' as const,
    benchmark: 'Nifty 50 TRI',
    fund_manager: 'Manager Name',
    fund_manager_tenure_years: 5,
    nav: 100,
    nav_date: new Date().toISOString(),
    aum_cr: 1000,
    expense_ratio: 1.2,
    returns: { '1y': 10, '3y': 12, '5y': 14, '10y': 15 },
    alpha_3y: 1,
    sharpe_3y: 1,
    sortino_3y: 1,
    max_drawdown: -10,
    global_influence_factors: [] as string[],
    data_freshness: { retrieved_at: new Date().toISOString(), is_stale: false, days_old: 1 },
    source_urls: [] as string[],
  }
}

function makeClientRiskProfile() {
  return {
    profile_id: UUID,
    client_id: UUID,
    version: 1,
    generated_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    age: 35,
    years_to_goal: 10,
    income_stability_score: 7,
    existing_liabilities: null,
    dependants: 'none' as const,
    emergency_fund_months: 6,
    insurance_coverage: null,
    tax_bracket_pct: 30,
    behavioural_risk_tolerance: 'MEDIUM' as const,
    stated_risk_tolerance: 'MEDIUM' as const,
    geographic_income_risk: null,
    factors: [] as Array<{ factor_name: string; value: string; source_url: string; rationale: string }>,
  }
}

function makeClientGoalAssessment(
  verdict: 'ALIGNS_WITH_GOALS' | 'NEEDS_DISCUSSION' | 'OUT_OF_SCOPE' = 'ALIGNS_WITH_GOALS',
) {
  return {
    assessment_id: UUID,
    client_id: UUID,
    version: 1,
    assessed_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    stated_goals: ['Retire comfortably'],
    decomposed_goals: [
      {
        goal_id: UUID,
        goal_type: 'RETIREMENT' as const,
        description: 'Retirement corpus',
        target_corpus_lakh: 500,
        target_date: '2040-04-01',
        current_corpus_lakh: 10,
        monthly_sip_required_lakh: 0.5,
        required_cagr_pct: 12,
        inflation_adjusted_target_lakh: 1000,
        inflation_rate_used_pct: 6,
      },
    ],
    achievability_verdict: verdict,
    goal_sequence_conflicts: [] as string[],
    sources: [] as Array<{ url: string; retrieved_at: string }>,
  }
}

function makeHedgeMap() {
  return {
    portfolio_id: UUID,
    generated_at: new Date().toISOString(),
    positions: [
      {
        fund_name: 'Test Fund',
        scheme_code: 'INF209K01UN8',
        allocation_pct: 50,
        risk_scenario: 'Equity drawdown',
        hedge_instrument: 'Gold ETF',
        hedge_rationale: 'Historical negative correlation',
        contingency_if_hedge_fails: 'Rebalance to debt',
      },
    ],
    overall_hedge_coverage_pct: 50,
    sources: [] as Array<{ url: string; retrieved_at: string }>,
  }
}

function makeScenarioStressTest() {
  return {
    portfolio_id: UUID,
    tested_at: new Date().toISOString(),
    scenarios: [
      {
        scenario_name: '2008-style crash',
        description: 'Global financial crisis replay',
        estimated_portfolio_return_pct: -25,
        worst_case_drawdown_pct: -35,
        recovery_timeline_months: 24,
        most_affected_funds: ['Test Equity Fund'],
        least_affected_funds: ['Test Debt Fund'],
      },
    ],
  }
}

function makeBacktestSummary() {
  return {
    backtest_id: UUID,
    period_years: 10,
    start_date: '2014-01-01',
    end_date: '2024-01-01',
    portfolio_cagr_pct: 12,
    benchmark_cagr_pct: 11,
    alpha_pct: 1,
    max_drawdown_pct: -20,
    max_drawdown_recovery_months: 12,
    sharpe_ratio: 1,
    sortino_ratio: 1.5,
    data_completeness_pct: 95,
    proxy_funds_used: [] as Array<{ original: string; proxy: string; reason: string }>,
    scenario_overlay: makeScenarioStressTest(),
  }
}

function makeConfidenceScore() {
  return {
    total: 80,
    breakdown: {
      data_freshness: 20 as const,
      goal_achievability: 20 as const,
      hedge_completeness: 20 as const,
      critique_severity: 10 as const,
      backtest_quality: 20 as const,
    },
    blocking_reasons: [] as string[],
  }
}

function makePortfolioDraft() {
  return {
    portfolio_id: UUID,
    client_id: UUID,
    pipeline_run_id: UUID,
    version: 1,
    revision_number: 0,
    goal_buckets: [
      {
        bucket_id: UUID,
        goal_id: UUID,
        goal_type: 'RETIREMENT' as const,
        target_corpus_lakh: 500,
        target_date: '2040-04-01',
        time_horizon_years: 15,
        risk_profile: 'MODERATE' as const,
        allocation_pct: 100,
      },
    ],
    fund_allocations: [
      {
        allocation_id: UUID,
        fund_name: 'Test Fund',
        isin: 'INF209K01UN8',
        scheme_code: 'INF209K01UN8',
        allocation_pct: 100,
        goal_bucket_id: UUID,
        rationale: 'Core holding matching goal horizon',
        fund_profile_retrieved_at: new Date().toISOString(),
        overlap_checked: true,
      },
    ],
    hedge_instruments: makeHedgeMap(),
    confidence_score: makeConfidenceScore(),
    backtest_summary: makeBacktestSummary(),
    open_critique_items: [] as Array<{
      fault_id: string
      fault_category: 'OTHER'
      fault_description: string
      evidence_sources: Array<{ url: string; retrieved_at: string; excerpt_summary: string }>
      severity: 'MINOR'
      confidence_tier: 'INFERRED'
    }>,
    universe_filters_applied: [] as Array<{ filter: string; threshold: string }>,
    overlap_flags: [] as Array<{ fund_a: string; fund_b: string; overlap_pct: number }>,
    status: 'DRAFT' as const,
  }
}

function makeFinalPacket(
  verdict: 'ALIGNS_WITH_GOALS' | 'NEEDS_DISCUSSION' | 'OUT_OF_SCOPE' = 'ALIGNS_WITH_GOALS',
) {
  return {
    packet_id: UUID,
    pipeline_run_id: UUID,
    client_id: UUID,
    generated_at: new Date().toISOString(),
    valid_until: new Date().toISOString(),
    executive_summary: 'This portfolio is designed for long-term growth.',
    client_goal_summary: makeClientGoalAssessment(verdict),
    achievability_verdict: verdict,
    full_portfolio: makePortfolioDraft(),
    risk_and_hedge_map: makeHedgeMap(),
    backtest_summary: makeBacktestSummary(),
    confidence_score_breakdown: makeConfidenceScore(),
    open_observations: [] as Array<{
      fault_id: string
      fault_category: 'OTHER'
      fault_description: string
      evidence_sources: Array<{ url: string; retrieved_at: string; excerpt_summary: string }>
      severity: 'MINOR'
      confidence_tier: 'INFERRED'
    }>,
    sebi_disclaimer: 'For educational purposes only.',
    data_freshness_disclosure: 'Data retrieved within 7 days.',
    backtest_disclaimer: 'Past performance does not guarantee future results.',
    conflict_of_interest_disclosure: 'No conflict of interest.',
    validity_disclosure: 'Valid for 90 days.',
    audit_trail_pipeline_run_id: UUID,
  }
}


describe('Agent Zod schemas round-trip validation', () => {
  it('validates a FundProfile', () => {
    expect(FundProfileSchema.safeParse(makeFundProfile()).success).toBe(true)
  })

  it('validates a FundUniverse', () => {
    const result = FundUniverseSchema.safeParse({
      universe_id: UUID,
      generated_at: new Date().toISOString(),
      pipeline_run_id: UUID,
      filters_applied: [],
      eligible_funds: [
        {
          scheme_code: 'INF209K01UN8',
          scheme_name: 'Test Fund',
          scheme_type: 'equity' as const,
          aum_cr: 1000,
          expense_ratio: 1.2,
          return_3y: 12,
          sharpe_3y: 1,
          track_record_years: 10,
        },
      ],
      total_screened: 100,
      total_eligible: 1,
    })
    expect(result.success).toBe(true)
  })

  it('validates a ClientRiskProfile', () => {
    expect(ClientRiskProfileSchema.safeParse(makeClientRiskProfile()).success).toBe(true)
  })

  it('validates a MacroRiskBulletin', () => {
    const result = MacroRiskBulletinSchema.safeParse({
      bulletin_id: UUID,
      generated_at: new Date().toISOString(),
      risk_level: 'ELEVATED' as const,
      rbi_policy_signal: 'Neutral',
      fed_signal: 'Hawkish',
      india_vix: 15,
      india_vix_trend: 'UP' as const,
      brent_crude_usd: 80,
      gold_mcx_inr: 60000,
      usdinr_rate: 83,
      usdinr_trend: 'STABLE' as const,
      fii_net_flow_cr: 1000,
      geopolitical_alerts: [] as string[],
      key_risks: [] as string[],
      key_observations: [] as string[],
      sources: [] as Array<{ url: string; retrieved_at: string }>,
    })
    expect(result.success).toBe(true)
  })

  it('validates a ClientGoalAssessment', () => {
    expect(ClientGoalAssessmentSchema.safeParse(makeClientGoalAssessment()).success).toBe(true)
  })

  it('validates a GoalHypothesis', () => {
    const result = GoalHypothesisSchema.safeParse({
      hypothesis_id: UUID,
      generated_at: new Date().toISOString(),
      corpus_target_lakh: 100,
      corpus_target_year: 2035,
      goal_description: 'Buy a home',
      monthly_sip_required_lakh: 0.5,
      current_monthly_savings_lakh: 0.5,
      required_cagr_pct: 10,
      cagr_feasibility: 'ACHIEVABLE' as const,
      assumed_expenses: { rent_lakh: 0.5, city_tier: 'metro', dependents: 'none' },
      risk_profile: 'MODERATE' as const,
      strategy_framework: 'Goal-based allocation',
      assumptions: [] as Array<{ field: string; value: string; reasoning: string }>,
      confidence: 80,
    })
    expect(result.success).toBe(true)
  })

  it('validates a StrategyFramework', () => {
    const result = StrategyFrameworkSchema.safeParse({
      framework_id: UUID,
      client_id: UUID,
      selected_frameworks: [
        {
          name: 'Core-satellite',
          description: 'Stable core with tactical satellite',
          why_applicable: 'Matches moderate risk',
          source_url: 'https://example.com',
          retrieved_at: new Date().toISOString(),
        },
      ],
      asset_allocation_guidance: {
        equity_pct_range: [40, 60],
        debt_pct_range: [30, 50],
        gold_pct_range: [5, 10],
        international_pct_range: [0, 10],
      },
    })
    expect(result.success).toBe(true)
  })

  it('validates a MarketContextBrief', () => {
    const result = MarketContextBriefSchema.safeParse({
      brief_id: UUID,
      generated_at: new Date().toISOString(),
      market_regime: 'EARLY_BULL' as const,
      confidence: 'MEDIUM' as const,
      evidence: [] as string[],
      implications_for_new_investors: 'Stay disciplined.',
      sources: [] as Array<{ url: string; retrieved_at: string }>,
    })
    expect(result.success).toBe(true)
  })

  it('validates StructuredInterviewAnswers', () => {
    const result = StructuredInterviewAnswersSchema.safeParse({
      monthly_income_lakh: 2,
      goals: [
        {
          goal_type: 'RETIREMENT' as const,
          description: 'Retire',
          target_corpus_lakh: 500,
          current_corpus_lakh: 10,
          monthly_sip_required_lakh: 0.5,
          target_date: '2040-04-01',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('validates a HedgeMap', () => {
    expect(HedgeMapSchema.safeParse(makeHedgeMap()).success).toBe(true)
  })


  it('validates a ScenarioStressTest', () => {
    expect(ScenarioStressTestSchema.safeParse(makeScenarioStressTest()).success).toBe(true)
  })

  it('validates a CritiqueReport', () => {
    const result = CritiqueReportSchema.safeParse({
      report_id: UUID,
      pipeline_run_id: UUID,
      draft_version: 1,
      critiqued_at: new Date().toISOString(),
      faults: [] as Array<{
        fault_id: string
        fault_category: 'OTHER'
        fault_description: string
        evidence_sources: Array<{ url: string; retrieved_at: string; excerpt_summary: string }>
        severity: 'MINOR'
        confidence_tier: 'INFERRED'
      }>,
      critical_count: 0,
      major_count: 0,
      minor_count: 0,
      observation_count: 0,
      overall_assessment: 'Clean draft.',
    })
    expect(result.success).toBe(true)
  })

  it('validates a PreflightContext', () => {
    const result = PreflightContextSchema.safeParse({
      userId: UUID,
      pipelineRunId: UUID,
      goalProfile: makeClientGoalAssessment(),
      fundUniverse: {
        universe_id: UUID,
        generated_at: new Date().toISOString(),
        pipeline_run_id: UUID,
        filters_applied: [] as Array<{ filter: string; threshold: string }>,
        eligible_funds: [],
        total_screened: 0,
        total_eligible: 0,
      },
      clientRiskProfile: makeClientRiskProfile(),
    })
    expect(result.success).toBe(true)
  })

  it('validates a PreflightReport', () => {
    const result = PreflightReportSchema.safeParse({
      predictedFailureModes: [] as Array<{
        faultCategory: 'OTHER'
        severity: 'MINOR'
        description: string
        avoidanceGuidance: string
      }>,
      generatedAt: new Date(),
      pipelineRunId: UUID,
    })
    expect(result.success).toBe(true)
  })

  it('validates a PortfolioDraft', () => {
    expect(PortfolioDraftSchema.safeParse(makePortfolioDraft()).success).toBe(true)
  })

  it('validates a BacktestSummary', () => {
    expect(BacktestSummarySchema.safeParse(makeBacktestSummary()).success).toBe(true)
  })

  it('validates a PortfolioConfidenceScore', () => {
    expect(PortfolioConfidenceScoreSchema.safeParse(makeConfidenceScore()).success).toBe(true)
  })

  it('validates a FinalPortfolioPacket', () => {
    expect(FinalPortfolioPacketSchema.safeParse(makeFinalPacket()).success).toBe(true)
  })

  it('validates a CommitteeVoteRecord', () => {
    const result = CommitteeVoteRecordSchema.safeParse({
      vote_id: UUID,
      pipeline_run_id: UUID,
      draft_version: 1,
      votes: [{ voter: 'DHRUV' as const, vote: 'APPROVE' as const, reasoning: 'Looks good.' }],
      critical_faults_from_aria: 0,
      hedge_coverage_from_kiran: 50,
      outcome: 'APPROVED' as const,
      outcome_reason: 'Consensus reached.',
      voted_at: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('validates a DeadlockReport', () => {
    const result = DeadlockReportSchema.safeParse({
      report_id: UUID,
      pipeline_run_id: UUID,
      triggered_at: new Date().toISOString(),
      revision_cycles_completed: 5,
      agent_objections: [] as Array<{ agent: string; objection_summary: string; unresolved_faults: string[] }>,
      dhruv_compromise_proposal: 'Reduce equity allocation.',
      compromise_vote_outcome: 'PENDING' as const,
      recommended_action: 'Escalate to human advisor.',
    })
    expect(result.success).toBe(true)
  })

  it('validates a PipelineStage enum value', () => {
    expect(PipelineStageSchema.safeParse('COMMITTEE_VOTE').success).toBe(true)
    expect(PipelineStageSchema.safeParse('UNKNOWN_STAGE').success).toBe(false)
  })

  it('validates a LifeEvent', () => {
    const result = LifeEventSchema.safeParse({
      event_type: 'INCOME_INCREASE' as const,
      description: 'Salary hike',
      effective_date: '2024-04-01',
    })
    expect(result.success).toBe(true)
  })

  it('validates a FundComparisonMatrix', () => {
    const result = FundComparisonMatrixSchema.safeParse({
      funds: [makeFundProfile()],
      comparison_dimensions: ['returns', 'risk'],
      overlap_matrix: {} as Record<string, Record<string, number>>,
      research_commentary: 'Commentary here.',
    })
    expect(result.success).toBe(true)
  })

  it('validates a CompositionAudit', () => {
    const result = CompositionAuditSchema.safeParse({
      scheme_code: 'INF209K01UN8',
      audit_date: '2024-04-01',
      top_holdings: [{ company: 'Reliance', allocation_pct: 10 }],
      sector_distribution: { financials: 25 } as Record<string, number>,
      top_10_concentration_pct: 45,
      overlap_with: {} as Record<string, number>,
      source_url: 'https://example.com',
      retrieved_at: new Date().toISOString(),
    })
    expect(result.success).toBe(true)
  })

  it('validates a FundWatchlistAlert', () => {
    const result = FundWatchlistAlertSchema.safeParse({
      scheme_code: 'INF209K01UN8',
      scheme_name: 'Test Fund',
      alert_type: 'EXPENSE_RATIO_HIKE' as const,
      description: 'Expense ratio increased.',
      detected_at: new Date().toISOString(),
      source_url: 'https://example.com',
    })
    expect(result.success).toBe(true)
  })
})


describe('Advisory verdict replacement', () => {
  it('rejects legacy ACHIEVABLE verdict in ClientGoalAssessment', () => {
    const bad = makeClientGoalAssessment('ACHIEVABLE' as never)
    expect(ClientGoalAssessmentSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects legacy REVISED verdict in FinalPortfolioPacket', () => {
    const bad = makeFinalPacket('REVISED' as never)
    expect(FinalPortfolioPacketSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects legacy IMPOSSIBLE verdict everywhere', () => {
    const assessment = makeClientGoalAssessment('IMPOSSIBLE' as never)
    expect(ClientGoalAssessmentSchema.safeParse(assessment).success).toBe(false)

    const packet = makeFinalPacket('IMPOSSIBLE' as never)
    expect(FinalPortfolioPacketSchema.safeParse(packet).success).toBe(false)
  })

  it('accepts the new advisory verdict values', () => {
    for (const verdict of ['ALIGNS_WITH_GOALS', 'NEEDS_DISCUSSION', 'OUT_OF_SCOPE'] as const) {
      expect(ClientGoalAssessmentSchema.safeParse(makeClientGoalAssessment(verdict)).success).toBe(true)
      expect(FinalPortfolioPacketSchema.safeParse(makeFinalPacket(verdict)).success).toBe(true)
    }
  })
})

describe('JSONB size guards', () => {
  it('rejects too many stated goals', () => {
    const assessment = makeClientGoalAssessment()
    assessment.stated_goals = Array.from({ length: 11 }, (_, i) => `Goal ${i}`)
    expect(ClientGoalAssessmentSchema.safeParse(assessment).success).toBe(false)
  })

  it('rejects too many portfolio fund allocations', () => {
    const draft = makePortfolioDraft()
    draft.fund_allocations = Array.from({ length: 101 }, () => draft.fund_allocations[0])
    expect(PortfolioDraftSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects an executive summary exceeding the character guard', () => {
    const packet = makeFinalPacket()
    packet.executive_summary = 'word '.repeat(6001)
    expect(FinalPortfolioPacketSchema.safeParse(packet).success).toBe(false)
  })

  it('rejects too many critique faults', () => {
    const report = {
      report_id: UUID,
      pipeline_run_id: UUID,
      draft_version: 1,
      critiqued_at: new Date().toISOString(),
      faults: Array.from({ length: 101 }, () => ({
        fault_id: UUID,
        fault_category: 'OTHER' as const,
        fault_description: 'A fault.',
        evidence_sources: [] as Array<{ url: string; retrieved_at: string; excerpt_summary: string }>,
        severity: 'MINOR' as const,
        confidence_tier: 'INFERRED' as const,
      })),
      critical_count: 0,
      major_count: 0,
      minor_count: 101,
      observation_count: 0,
      overall_assessment: 'Many faults.',
    }
    expect(CritiqueReportSchema.safeParse(report).success).toBe(false)
  })
})

