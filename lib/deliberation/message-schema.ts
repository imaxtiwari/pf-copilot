import { z } from 'zod'

// ─── Agent & Message Type Enums ───────────────────────────────────────────────

export const AgentIdSchema = z.enum(['ARIA', 'KIRAN', 'SOMA', 'VIKRAM', 'PRIYA', 'DHRUV', 'ORACLE', 'RIYA'])
export const MessageTypeSchema = z.enum([
  'CRITIQUE',
  'RISK_ALERT',
  'FUND_REPORT',
  'STRATEGY_PROPOSAL',
  'PORTFOLIO_DRAFT',
  'VOTE',
  'DIRECTIVE',
  'ORACLE_FLAG'
])

// ─── Per-Type Payload Schemas ─────────────────────────────────────────────────

export const CritiquePayloadSchema = z.object({
  target_message_id: z.string(),
  critique_points: z.array(z.string()).min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  recommended_action: z.string()
})

export const RiskAlertPayloadSchema = z.object({
  risk_category: z.string(),
  risk_description: z.string(),
  affected_funds: z.array(z.string()),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  data_source: z.string()
})

export const FundReportPayloadSchema = z.object({
  scheme_code: z.string(),
  scheme_name: z.string(),
  nav: z.number().positive(),
  snapshot_date: z.string(),
  key_metrics: z.record(z.string(), z.unknown()),
  research_summary: z.string()
})

export const StrategyProposalPayloadSchema = z.object({
  strategy_name: z.string(),
  rationale: z.string(),
  target_allocation: z.record(z.string(), z.number()),
  risk_level: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
  expected_return_band: z.tuple([z.number(), z.number()])
})

export const PortfolioDraftPayloadSchema = z.object({
  draft_version: z.number().int().positive(),
  client_id: z.string(),
  holdings: z.array(z.object({
    scheme_code: z.string(),
    allocation_pct: z.number().min(0).max(100),
    rationale: z.string()
  })),
  total_allocation_pct: z.number(),
  expected_xirr: z.number().optional()
})

export const VotePayloadSchema = z.object({
  motion: z.string(),
  vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
  reasoning: z.string(),
  conditions: z.array(z.string()).default([])
})

export const DirectivePayloadSchema = z.object({
  directive_type: z.enum(['PROCEED', 'REVISE', 'HALT', 'ESCALATE']),
  instructions: z.string(),
  deadline_minutes: z.number().int().positive().optional()
})

export const OracleFlagPayloadSchema = z.object({
  flag_type: z.enum(['REGULATORY', 'RISK_THRESHOLD', 'DATA_INTEGRITY', 'CONFLICT_OF_INTEREST']),
  flag_description: z.string(),
  flagged_message_id: z.string(),
  evidence: z.array(z.string()).min(1),
  recommendation: z.string()
})

// ─── Master Message Schema ────────────────────────────────────────────────────

export const DeliberationMessageSchema = z.object({
  message_id: z.string(),
  pipeline_run_id: z.string(),
  timestamp: z.string(),
  sender: AgentIdSchema,
  message_type: MessageTypeSchema,
  recipient: z.union([
    z.literal('ALL'),
    AgentIdSchema
  ]),
  payload: z.record(z.string(), z.unknown()),
  oracle_validation: z.object({
    status: z.enum(['PASSED', 'FLAGGED', 'PENDING']),
    flags: z.array(z.string()),
    confidence_score: z.number().optional()
  }),
  references: z.array(z.string()).default([]),
  reply_to_message_id: z.string().nullable().optional(),
  thread_root_id: z.string().nullable().optional(),
  depth: z.number().int().optional(),
})

// ─── Inferred TypeScript Types ────────────────────────────────────────────────

export type DeliberationMessage = z.infer<typeof DeliberationMessageSchema>
export type AgentId = z.infer<typeof AgentIdSchema>
export type MessageType = z.infer<typeof MessageTypeSchema>

export type CritiquePayload = z.infer<typeof CritiquePayloadSchema>
export type RiskAlertPayload = z.infer<typeof RiskAlertPayloadSchema>
export type FundReportPayload = z.infer<typeof FundReportPayloadSchema>
export type StrategyProposalPayload = z.infer<typeof StrategyProposalPayloadSchema>
export type PortfolioDraftPayload = z.infer<typeof PortfolioDraftPayloadSchema>
export type VotePayload = z.infer<typeof VotePayloadSchema>
export type DirectivePayload = z.infer<typeof DirectivePayloadSchema>
export type OracleFlagPayload = z.infer<typeof OracleFlagPayloadSchema>
