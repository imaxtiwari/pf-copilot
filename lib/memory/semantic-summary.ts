export function extractSemanticSummary(value: unknown, key: string): string {
  // Key-specific summary extractors
  if (key.includes('final_portfolio') || key.includes('portfolio_draft')) {
    const v = value as any;
    return [
      `Portfolio for ${v.userId || v.client_id}, ${v.goalCount || v.goal_buckets?.length} goals`,
      `Confidence: ${v.confidenceScore || v.confidence_score?.total}`,
      `Funds: ${(v.allocations || v.fund_allocations)?.map((a: any) => a.schemeName || a.fund_name).join(', ') ?? 'unknown'}`,
      `Top allocation: ${(v.allocations || v.fund_allocations)?.[0]?.weight || (v.allocations || v.fund_allocations)?.[0]?.allocation_pct}% ${(v.allocations || v.fund_allocations)?.[0]?.schemeName || (v.allocations || v.fund_allocations)?.[0]?.fund_name}`,
      `CAGR target: ${v.requiredCAGR || v.blended_cagr_target}%`,
      `Approved: ${v.approvedAt || 'pending'}`,
    ].filter(Boolean).join('. ');
  }

  if (key.includes('behavioral_fingerprint')) {
    const v = value as any;
    return [
      `Behavioral profile for user`,
      `Patterns: ${v.patterns?.map((p: any) => p.patternType).join(', ')}`,
      `Abandonment risk: ${v.portfolioAbandonmentRisk}`,
      `Risk tolerance reality: ${v.riskToleranceReality}`,
    ].filter(Boolean).join('. ');
  }

  if (key.includes('macro_bulletin')) {
    const v = value as any;
    return `Macro bulletin level: ${v.level}. ${v.summary ?? ''}`;
  }

  if (key.includes('knowledge_commons')) {
    const v = value as any;
    return v.content ?? JSON.stringify(value).slice(0, 400);
  }

  // Generic fallback: first 400 chars of JSON (always within token limit)
  const json = JSON.stringify(value);
  return json.length > 400 ? json.slice(0, 397) + '...' : json;
}
