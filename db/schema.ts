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

export const cityTierEnum = pgEnum('city_tier', ['metro', 'tier2', 'tier3'])
export const dependentsEnum = pgEnum('dependents', ['none', 'spouse', 'kids', 'parents', 'multiple'])
export const holdingSourceEnum = pgEnum('holding_source', ['cas_text', 'cas_vision', 'manual'])
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
  (table: any) => [
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
  },
  (table: any) => [
    // DESC ordering applied via raw SQL in db/migrate.ts for exact (user_id, ts DESC) semantics
    index('chat_messages_user_ts_idx').on(table.userId, sql`${table.ts} DESC`),
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
    embedding: vector('embedding', { dimensions: 1536 }),
    sourceUrl: text('source_url').notNull(),
    factsheetDate: date('factsheet_date').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table: any) => [
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
  lastSynced: timestamp('last_synced').notNull(),
})

// ── Multi-Agent Fund Database (Step 1) ────────────────────────────────────────

export const agentFunds = pgTable('agent_funds', {
  fundId: uuid('fund_id').primaryKey().defaultRandom(),
  schemeCode: text('scheme_code').notNull().unique(),
  isin: text('isin'),
  schemeName: text('scheme_name').notNull(),
  amcName: text('amc_name').notNull(),
  schemeType: text('scheme_type').notNull(),
  benchmarkIndex: text('benchmark_index'),
  sebiCategory: text('sebi_category'),
  isActive: boolean('is_active').default(true),
  sourceUrl: text('source_url').notNull(),
  retrievedAt: timestamp('retrieved_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const fundSnapshots = pgTable(
  'fund_snapshots',
  {
    snapshotId: uuid('snapshot_id').primaryKey().defaultRandom(),
    schemeCode: text('scheme_code').references(() => agentFunds.schemeCode),
    snapshotDate: date('snapshot_date').notNull(),
    nav: numeric('nav').notNull(),
    nav52wHigh: numeric('nav_52w_high'),
    nav52wLow: numeric('nav_52w_low'),
    aumCr: numeric('aum_cr'),
    expenseRatio: numeric('expense_ratio'),
    return1y: numeric('return_1y'),
    return3y: numeric('return_3y'),
    return5y: numeric('return_5y'),
    return10y: numeric('return_10y'),
    alpha3y: numeric('alpha_3y'),
    sharpe3y: numeric('sharpe_3y'),
    sortino3y: numeric('sortino_3y'),
    maxDrawdown: numeric('max_drawdown'),
    sourceUrl: text('source_url').notNull(),
    retrievedAt: timestamp('retrieved_at').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table: any) => [
    uniqueIndex('fund_snapshots_unique_idx').on(table.schemeCode, table.snapshotDate),
  ],
)

export const fundCompositions = pgTable('fund_compositions', {
  compositionId: uuid('composition_id').primaryKey().defaultRandom(),
  schemeCode: text('scheme_code').references(() => agentFunds.schemeCode),
  compositionDate: date('composition_date'),
  holdings: jsonb('holdings'),
  top10ConcentrationPct: numeric('top_10_concentration_pct'),
  sectorDistribution: jsonb('sector_distribution'),
  sourceUrl: text('source_url').notNull(),
  retrievedAt: timestamp('retrieved_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const fundEvents = pgTable('fund_events', {
  eventId: uuid('event_id').primaryKey().defaultRandom(),
  schemeCode: text('scheme_code').references(() => agentFunds.schemeCode),
  eventDate: date('event_date').notNull(),
  eventType: text('event_type'),
  eventDescription: text('event_description').notNull(),
  beforeValue: jsonb('before_value'),
  afterValue: jsonb('after_value'),
  sourceUrl: text('source_url').notNull(),
  retrievedAt: timestamp('retrieved_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const pipelineRuns = pgTable('pipeline_runs', {
  runId: uuid('run_id').primaryKey().defaultRandom(),
  clientId: uuid('client_id').references(() => users.id),
  status: text('status'),
  revisionCycle: integer('revision_cycle').default(0),
  startedAt: timestamp('started_at').defaultNow(),
  completedAt: timestamp('completed_at'),
  finalPortfolioId: uuid('final_portfolio_id'),
})

export const portfolioDrafts = pgTable('portfolio_drafts', {
  draftId: uuid('draft_id').primaryKey().defaultRandom(),
  pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.runId),
  clientId: uuid('client_id').references(() => users.id),
  version: integer('version').notNull(),
  goalBuckets: jsonb('goal_buckets').notNull(),
  fundAllocations: jsonb('fund_allocations').notNull(),
  hedgeInstruments: jsonb('hedge_instruments'),
  confidenceScore: numeric('confidence_score').notNull(),
  backtestSummary: jsonb('backtest_summary'),
  openCritiqueItems: jsonb('open_critique_items'),
  status: text('status'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const committeeVotes = pgTable('committee_votes', {
  voteId: uuid('vote_id').primaryKey().defaultRandom(),
  pipelineRunId: uuid('pipeline_run_id').references(() => pipelineRuns.runId),
  draftId: uuid('draft_id').references(() => portfolioDrafts.draftId),
  voter: text('voter'),
  vote: text('vote'),
  reasoning: text('reasoning'),
  criticalFaultsCount: integer('critical_faults_count').default(0),
  hedgeCoveragePct: numeric('hedge_coverage_pct'),
  votedAt: timestamp('voted_at').defaultNow(),
})
