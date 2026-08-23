import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'

import { sql } from 'drizzle-orm'

// ── Enums (truly fixed sets) ──────────────────────────────────────────────────

export const insightTemplateEnum = pgEnum('insight_template', [
  'personal_inflation_vs_cpi',
  'highest_lowest_real_return',
  'mid_small_cap_concentration',
  'unmatched_schemes',
])

export const cityTierEnum = pgEnum('city_tier', ['metro', 'tier2', 'tier3'])
export const dependentsEnum = pgEnum('dependents', ['none', 'spouse', 'kids', 'parents', 'multiple'])
export const holdingSourceEnum = pgEnum('holding_source', ['cas_text', 'cas_vision', 'manual'])
export const documentSourceEnum = pgEnum('document_source', ['annual_report', 'bse_announcement', 'other'])
export const chatRoleEnum = pgEnum('chat_role', ['user', 'assistant', 'tool'])

// ── Tables ────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const userProfile = pgTable('user_profile', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  age: integer('age'),
  cityTier: cityTierEnum('city_tier'),
  monthlyRent: numeric('monthly_rent'),
  ownsHome: boolean('owns_home'),
  dependents: dependentsEnum('dependents'),
  medicalConditions: boolean('medical_conditions'),
  inflationRate: numeric('inflation_rate'),
  inflationBreakdown: jsonb('inflation_breakdown'),
  // text + zod: will grow (low | medium | high validated in lib/validation/schemas.ts)
  inflationConfidence: text('inflation_confidence'),
  computedAt: timestamp('computed_at'),
})

export const casUploads = pgTable(
  'cas_uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    fileHash: text('file_hash').notNull(),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    // text + zod: will grow (validated in lib/validation/schemas.ts)
    status: text('status').notNull().default('pending'),
    validationErrors: jsonb('validation_errors'),
    totalValueReported: numeric('total_value_reported'),
    totalValueComputed: numeric('total_value_computed'),
    visionUsed: boolean('vision_used').notNull().default(false),
    rawTextPreview: text('raw_text_preview'),
  },
  (table) => [
    index('cas_uploads_file_hash_idx').on(table.fileHash),
  ],
)

export const portfolioHoldings = pgTable('portfolio_holdings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  schemeCode: text('scheme_code'),
  schemeName: text('scheme_name').notNull(),
  folioNumber: text('folio_number').notNull(),
  units: numeric('units').notNull(),
  nav: numeric('nav').notNull(),
  marketValue: numeric('market_value').notNull(),
  asOfDate: date('as_of_date').notNull(),
  source: holdingSourceEnum('source').notNull(),
  casUploadId: uuid('cas_upload_id').references(() => casUploads.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    asOfDate: date('as_of_date').notNull(),
    totalValue: numeric('total_value').notNull(),
    realReturnAnnualized: numeric('real_return_annualized'),
    inflationRateUsed: numeric('inflation_rate_used').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('portfolio_snapshots_user_date_idx').on(table.userId, table.asOfDate),
  ],
)

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    ts: timestamp('ts').defaultNow().notNull(),
    role: chatRoleEnum('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'),
    toolCallId: text('tool_call_id'),
    toolName: text('tool_name'),
    // Audit / transparency fields
    citations: jsonb('citations').default([]),
    modelVersion: text('model_version'),
    refusalReason: text('refusal_reason'),
    requestId: text('request_id'),
  },
  (table) => [
    // DESC ordering applied via raw SQL in db/migrate.ts for exact (user_id, ts DESC) semantics
    index('chat_messages_user_ts_idx').on(table.userId, sql`${table.ts} DESC`),
    index('chat_messages_request_id_idx').on(table.requestId),
  ],
)

export const factsheetChunks = pgTable(
  'factsheet_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemeCode: text('scheme_code').notNull(),
    schemeName: text('scheme_name').notNull(),
    // text + zod: will grow (validated in lib/validation/schemas.ts)
    section: text('section').notNull(),
    chunkText: text('chunk_text').notNull(),
    embedding: vector('embedding', { dimensions: 3072 }),
    sourceUrl: text('source_url').notNull(),
    factsheetDate: date('factsheet_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('factsheet_chunks_scheme_code_idx').on(table.schemeCode),
    uniqueIndex('factsheet_chunks_unique_idx').on(
      table.schemeCode,
      table.section,
      table.factsheetDate,
      table.chunkText,
    ),
    // HNSW vector index created via raw SQL in db/migrate.ts (Drizzle doesn't support WITH params)
  ],
)

export const amfiSchemeMaster = pgTable('amfi_scheme_master', {
  schemeCode: text('scheme_code').primaryKey(),
  schemeName: text('scheme_name').notNull(),
  amcName: text('amc_name').notNull(),
  schemeType: text('scheme_type').notNull(),
  amfiCategory: text('amfi_category'),
  lastSynced: timestamp('last_synced').notNull(),
})

export const portfolioInsights = pgTable(
  'portfolio_insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    casUploadId: uuid('cas_upload_id').references(() => casUploads.id, { onDelete: 'set null' }),
    template: insightTemplateEnum('template').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    data: jsonb('data').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('portfolio_insights_user_generated_idx').on(table.userId, table.generatedAt),
  ],
)

export const dematHoldings = pgTable(
  'demat_holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    isin: text('isin').notNull(),
    companyName: text('company_name').notNull(),
    quantity: numeric('quantity').notNull(),
    price: numeric('price').notNull(),
    value: numeric('value').notNull(),
    asOfDate: date('as_of_date').notNull(),
    source: holdingSourceEnum('source').notNull(),
    casUploadId: uuid('cas_upload_id').references(() => casUploads.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('demat_holdings_user_isin_idx').on(table.userId, table.isin),
    index('demat_holdings_user_date_idx').on(table.userId, table.asOfDate),
  ],
)

export const stockDocuments = pgTable(
  'stock_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    isin: text('isin').notNull(),
    companyName: text('company_name').notNull(),
    documentDate: date('document_date').notNull(),
    source: documentSourceEnum('source').notNull(),
    section: text('section').notNull(),
    chunkText: text('chunk_text').notNull(),
    embedding: vector('embedding', { dimensions: 3072 }),
    sourceUrl: text('source_url').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('stock_documents_isin_idx').on(table.isin),
    uniqueIndex('stock_documents_unique_idx').on(
      table.isin,
      table.source,
      table.documentDate,
      table.section,
      table.chunkText,
    ),
  ],
)

// ── Pipeline & agent committee tables ─────────────────────────────────────────

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    runId: uuid('run_id').primaryKey().defaultRandom(),
    clientId: uuid('client_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('PENDING'),
    stage: text('stage').notNull().default('INTAKE'),
    payload: jsonb('payload').notNull().default({}),
    revisionCycle: integer('revision_cycle').notNull().default(0),
    finalPortfolioId: uuid('final_portfolio_id'),
    bestDraftId: uuid('best_draft_id'),
    impossibilityReason: text('impossibility_reason'),
    completedAt: timestamp('completed_at'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('pipeline_runs_client_id_idx').on(table.clientId),
    index('pipeline_runs_status_idx').on(table.status),
    index('pipeline_runs_started_at_idx').on(table.startedAt),
  ],
)

export const pipelineResults = pgTable(
  'pipeline_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    resultType: text('result_type').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('pipeline_results_run_id_idx').on(table.pipelineRunId),
    uniqueIndex('pipeline_results_run_type_idx').on(table.pipelineRunId, table.resultType),
  ],
)

export const portfolioDrafts = pgTable(
  'portfolio_drafts',
  {
    draftId: uuid('draft_id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id'),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    revisionNumber: integer('revision_number').notNull().default(0),
    clientId: uuid('client_id').references(() => users.id, { onDelete: 'cascade' }),
    goalBuckets: jsonb('goal_buckets').default([]),
    fundAllocations: jsonb('fund_allocations').default([]),
    modelAllocation: jsonb('model_allocation').default([]),
    strategyFramework: text('strategy_framework'),
    confidenceScore: numeric('confidence_score'),
    riskFlags: jsonb('risk_flags').default([]),
    rationale: jsonb('rationale').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('portfolio_drafts_run_id_idx').on(table.pipelineRunId),
    index('portfolio_drafts_created_at_idx').on(table.createdAt),
  ],
)

export const deliberationMessages = pgTable(
  'deliberation_messages',
  {
    messageId: uuid('message_id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    replyToMessageId: uuid('reply_to_message_id'),
    threadRootId: uuid('thread_root_id'),
    sender: text('sender').notNull(),
    messageType: text('message_type').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').default({}),
    timestamp: timestamp('timestamp').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('deliberation_messages_run_id_idx').on(table.pipelineRunId),
    index('deliberation_messages_created_at_idx').on(table.createdAt),
    index('deliberation_messages_sender_idx').on(table.sender),
  ],
)

export const committeeVotes = pgTable(
  'committee_votes',
  {
    voteId: uuid('vote_id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    vote: text('vote').notNull(),
    rationale: text('rationale'),
    votedAt: timestamp('voted_at').defaultNow().notNull(),
  },
  (table) => [
    index('committee_votes_run_id_idx').on(table.pipelineRunId),
    index('committee_votes_voted_at_idx').on(table.votedAt),
  ],
)

export const comparisonReports = pgTable(
  'comparison_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    report: jsonb('report').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('comparison_reports_run_id_idx').on(table.pipelineRunId),
    uniqueIndex('comparison_reports_run_id_unique_idx').on(table.pipelineRunId),
  ],
)

export const complianceReports = pgTable(
  'compliance_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    report: jsonb('report').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('compliance_reports_run_id_idx').on(table.pipelineRunId),
    uniqueIndex('compliance_reports_run_id_unique_idx').on(table.pipelineRunId),
  ],
)

export const behavioralFingerprints = pgTable(
  'behavioral_fingerprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pipelineRunId: uuid('pipeline_run_id').notNull().references(() => pipelineRuns.runId, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    fingerprint: jsonb('fingerprint').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('behavioral_fingerprints_run_id_idx').on(table.pipelineRunId),
    index('behavioral_fingerprints_user_id_idx').on(table.userId),
    uniqueIndex('behavioral_fingerprints_run_id_unique_idx').on(table.pipelineRunId),
  ],
)

// ── Fund data tables ──────────────────────────────────────────────────────────

export const agentFunds = pgTable(
  'agent_funds',
  {
    schemeCode: text('scheme_code').primaryKey(),
    schemeName: text('scheme_name').notNull(),
    amcName: text('amc_name'),
    schemeType: text('scheme_type').notNull(),
    amfiCategory: text('amfi_category'),
    sebiCategory: text('sebi_category'),
    expenseRatio: numeric('expense_ratio'),
    aum: numeric('aum'),
    isActive: boolean('is_active').notNull().default(true),
    lastSynced: timestamp('last_synced').defaultNow().notNull(),
  },
  (table) => [
    index('agent_funds_scheme_type_idx').on(table.schemeType),
    index('agent_funds_active_idx').on(table.isActive),
  ],
)

export const fundSnapshots = pgTable(
  'fund_snapshots',
  {
    snapshotId: uuid('snapshot_id').primaryKey().defaultRandom(),
    schemeCode: text('scheme_code').notNull().references(() => agentFunds.schemeCode, { onDelete: 'cascade' }),
    snapshotDate: date('snapshot_date').notNull(),
    nav: numeric('nav').notNull(),
    open: numeric('open'),
    high: numeric('high'),
    low: numeric('low'),
    close: numeric('close'),
    volume: numeric('volume'),
    adjustedClose: numeric('adjusted_close'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('fund_snapshots_scheme_date_idx').on(table.schemeCode, table.snapshotDate),
    uniqueIndex('fund_snapshots_scheme_date_unique_idx').on(table.schemeCode, table.snapshotDate),
  ],
)

export const fundCompositions = pgTable(
  'fund_compositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemeCode: text('scheme_code').notNull().references(() => agentFunds.schemeCode, { onDelete: 'cascade' }),
    holdingName: text('holding_name'),
    instrumentType: text('instrument_type'),
    sector: text('sector'),
    weight: numeric('weight'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('fund_compositions_scheme_code_idx').on(table.schemeCode),
    index('fund_compositions_created_at_idx').on(table.createdAt),
  ],
)

// ── Drift & SIP tables ────────────────────────────────────────────────────────

export const driftReports = pgTable(
  'drift_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.runId, { onDelete: 'set null' }),
    report: jsonb('report').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('drift_reports_user_id_idx').on(table.userId),
    index('drift_reports_generated_at_idx').on(table.generatedAt),
  ],
)

export const sipAdherenceReports = pgTable(
  'sip_adherence_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.runId, { onDelete: 'set null' }),
    report: jsonb('report').notNull().default({}),
    generatedAt: timestamp('generated_at').defaultNow().notNull(),
  },
  (table) => [
    index('sip_adherence_reports_user_id_idx').on(table.userId),
    index('sip_adherence_reports_generated_at_idx').on(table.generatedAt),
  ],
)

// ── Scheduler tables ──────────────────────────────────────────────────────────

export const schedulerLocks = pgTable(
  'scheduler_locks',
  {
    jobName: text('job_name').primaryKey(),
    lockedAt: timestamp('locked_at').defaultNow().notNull(),
    lockedBy: text('locked_by').notNull(),
  },
  (table) => [
    index('scheduler_locks_locked_at_idx').on(table.lockedAt),
  ],
)

export const schedulerRuns = pgTable(
  'scheduler_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: text('job_name').notNull(),
    status: text('status').notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    metadata: jsonb('metadata').default({}),
  },
  (table) => [
    index('scheduler_runs_job_name_idx').on(table.jobName),
    index('scheduler_runs_started_at_idx').on(table.startedAt),
  ],
)

// ── Knowledge commons (shared agent memory) ───────────────────────────────────

export const knowledgeCommons = pgTable(
  'knowledge_commons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: text('agent_id').notNull(),
    memoryType: text('memory_type').notNull(),
    summary: text('summary').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    payload: jsonb('payload').notNull().default({}),
    sourceUrl: text('source_url').notNull(),
    tags: jsonb('tags').default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('knowledge_commons_agent_id_idx').on(table.agentId),
    index('knowledge_commons_memory_type_idx').on(table.memoryType),
  ],
)
