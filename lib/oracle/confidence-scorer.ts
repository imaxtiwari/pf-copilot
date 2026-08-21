export interface ClaimInput {
  /** The factual claim being scored */
  content: string
  /** Direct URL where the fact was retrieved from */
  source_url?: string
  /** ISO8601 timestamp of when the source was retrieved */
  retrieved_at?: string
  /** TTL in days for this type of claim */
  ttl_days?: number
  /** Whether an LLM or logic check found contradictions against other verified facts */
  has_contradictions?: boolean
}

export type ConfidenceTier = 'VERIFIED' | 'INFERRED' | 'ASSUMED'

/**
 * Pure function — scores a claim's confidence tier.
 *
 * VERIFIED  — source_url present, retrieved_at within TTL, no contradictions
 * INFERRED  — logical derivation from verified facts, no direct source URL
 * ASSUMED   — no source at all; highest hallucination risk
 */
export function scoreConfidence(claim: ClaimInput): ConfidenceTier {
  const hasSource = !!claim.source_url && claim.source_url.trim().length > 0
  const hasRetrievedAt = !!claim.retrieved_at

  if (!hasSource) {
    // No source URL at all — check if it could be an inference
    if (claim.content && claim.content.trim().length > 0) {
      return 'ASSUMED'
    }
    return 'ASSUMED'
  }

  // Source URL is present — check freshness
  if (hasSource && hasRetrievedAt && claim.ttl_days !== undefined && claim.ttl_days !== Infinity) {
    const ageMs = Date.now() - new Date(claim.retrieved_at!).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)

    if (ageDays > claim.ttl_days) {
      // Source exists but is stale — downgrade to INFERRED
      return 'INFERRED'
    }
  }

  // Source is present, fresh, and no contradictions
  if (claim.has_contradictions) {
    return 'INFERRED'
  }

  return 'VERIFIED'
}
