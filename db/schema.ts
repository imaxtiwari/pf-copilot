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
    embedding: vector('embedding', { dimensions: 1536 }),
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
