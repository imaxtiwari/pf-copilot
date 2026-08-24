/**
 * Centralized policy thresholds.
 *
 * Any threshold that affects LLM-facing behaviour, validation, or resource
 * guards should live here instead of being hard-coded in individual modules.
 * This makes the product rules auditable, testable, and easy to tune without
 * touching business logic.
 */

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function floatFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const POLICY = {
  /** Portfolio construction / draft validation rules. */
  portfolio: {
    /** Tolerance (in percentage points) around the 100% allocation target. */
    allocationTolerancePct: floatFromEnv('PORTFOLIO_ALLOCATION_TOLERANCE_PCT', 0.5),
    /** Maximum percentage a single non-index fund may represent. */
    maxSingleFundConcentrationPct: floatFromEnv('PORTFOLIO_MAX_SINGLE_FUND_PCT', 25),
    /** Whether index funds are exempt from the single-fund concentration cap. */
    indexFundConcentrationExemption: true,
    /** Maximum number of committee revision cycles before deadlock. */
    maxRevisions: intFromEnv('PORTFOLIO_MAX_REVISIONS', 5),
  },

  /** ARIA (contrarian critic) rules. */
  aria: {
    /** Number of MINOR faults ARIA may accumulate before forcing a rejection. */
    minorFaultLimit: intFromEnv('ARIA_MINOR_FAULT_LIMIT', 3),
  },

  /** KIRAN (risk / hedge-map) rules. */
  kiran: {
    /** Minimum hedge coverage percentage required for approval. */
    minHedgeCoveragePct: floatFromEnv('KIRAN_MIN_HEDGE_COVERAGE_PCT', 80),
  },

  /** Qdrant vector store rules. */
  qdrant: {
    /** Expected vector dimension for Qdrant collections. */
    embeddingDimension: intFromEnv('EMBEDDING_DIMENSION', 1536),
    /** Comma-separated list of collection names to validate at startup. */
    collections: process.env.QDRANT_COLLECTIONS?.split(',').map((c) => c.trim()).filter(Boolean) ?? [],
  },

  /** LLM structured-output retry policy. */
  structuredOutput: {
    maxAttempts: intFromEnv('STRUCTURED_OUTPUT_MAX_ATTEMPTS', 3),
    baseDelayMs: intFromEnv('STRUCTURED_OUTPUT_BASE_DELAY_MS', 500),
  },
} as const
