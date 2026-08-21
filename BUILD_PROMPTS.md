# Multi-Agent Portfolio Intelligence System
## Complete Step-by-Step Build Prompts
### Feed these to your coding agent ONE AT A TIME. Do not skip steps.

> **How to use this file:**
> Copy each numbered PROMPT block exactly as written and paste it to your coding agent.
> Wait for the implementation plan. Approve it. Let it execute.
> Only move to the next step once the current step is fully working and tested.

---

## STEP 0 — Project Setup & Tech Stack Lock-In

PROMPT:
```
We are building a Multi-Agent Portfolio Intelligence System on top of the existing
pf-copilot Next.js codebase. Before writing any agent code, I need you to set up
the project scaffolding and lock in all technology decisions.

EXISTING CODEBASE CONTEXT:
- Project root: pf-copilot/
- Framework: Next.js 15 (App Router), TypeScript, Tailwind CSS v4
- Database: PostgreSQL 16 + pgvector via Drizzle ORM (see db/schema.ts)
- AI: Azure OpenAI SDK only (see lib/azure-openai.ts). No other LLM providers.
- Existing env vars: DATABASE_URL, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_DEPLOYMENT_GPT4O, AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI,
  AZURE_OPENAI_DEPLOYMENT_EMBEDDING, AMFI_NAV_URL
- Logging: pino (already in lib/logger.ts)
- Validation: zod (already in use)

WHAT TO DO:

1. INSTALL NEW PACKAGES (add to package.json, run npm install):
   - qdrant-client              — agent memory vector store
   - better-sqlite3             — append-only audit trail (SQLite)
   - @types/better-sqlite3      — types for above
   - node-cron                  — scheduling agent weekly/daily tasks
   - @types/node-cron           — types for above
   - @tavily/core               — WebResearchTool web search

2. ADD TO .env.example (with comments):
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=
   AUDIT_TRAIL_DB_PATH=./data/audit_trail.db
   TAVILY_API_KEY=
   AGENT_MODEL_ORCHESTRATOR=gpt-4o
   AGENT_MODEL_ANALYST=gpt-4o-mini

3. CREATE FOLDER STRUCTURE inside lib/:
   lib/agents/          — one file per agent
   lib/agents/types/    — all shared TypeScript types and Zod schemas
   lib/memory/          — Qdrant vector store wrapper + TTL logic
   lib/deliberation/    — Message bus / Deliberation Room
   lib/oracle/          — ORACLE middleware
   lib/research/        — WebResearchTool + KnowledgeCommons
   lib/scheduler/       — Cron jobs for all agent schedules
   lib/pipeline/        — DHRUV pipeline state machine
   lib/audit/           — Immutable audit trail

4. CREATE data/ directory at project root. Add data/ to .gitignore.

Please show me a full implementation plan listing every file to be created or
modified before writing any code.
```

---

## STEP 1 — Fund Database Schema Extension

PROMPT:
```
We are in Step 1. Step 0 is complete.

CONTEXT:
- Existing db/schema.ts has: users, userProfile, casUploads, portfolioHoldings,
  chatMessages, factsheetChunks, amfiSchemeMaster. Do NOT touch these.
- We are adding the multi-agent Fund Database tables.
- Constraint: Rows are NEVER overwritten. Always INSERT new versions.

ADD to db/schema.ts (new tables only):

1. agent_funds — base fund registry
   Columns: fund_id (UUID PK), scheme_code (text unique NOT NULL), isin (text),
   scheme_name (text NOT NULL), amc_name (text NOT NULL),
   scheme_type (text NOT NULL: equity/debt/hybrid/index/etf/fof/solution-oriented),
   benchmark_index (text), sebi_category (text), is_active (boolean DEFAULT true),
   source_url (text NOT NULL), retrieved_at (timestamp NOT NULL),
   created_at (timestamp DEFAULT NOW)

2. fund_snapshots — versioned NAV + metrics, NO UPDATES EVER
   Columns: snapshot_id (UUID PK), scheme_code (FK agent_funds),
   snapshot_date (date NOT NULL), nav (numeric NOT NULL),
   nav_52w_high, nav_52w_low, aum_cr, expense_ratio,
   return_1y, return_3y, return_5y, return_10y (all numeric),
   alpha_3y, sharpe_3y, sortino_3y, max_drawdown (all numeric),
   source_url (text NOT NULL), retrieved_at (timestamp NOT NULL),
   created_at (timestamp DEFAULT NOW)
   Unique index on (scheme_code, snapshot_date).

3. fund_compositions — holdings by date
   Columns: composition_id (UUID PK), scheme_code (FK), composition_date (date),
   holdings (jsonb: [{stock_name, isin, weight_pct, sector}]),
   top_10_concentration_pct (numeric), sector_distribution (jsonb),
   source_url (text NOT NULL), retrieved_at (timestamp NOT NULL),
   created_at (timestamp DEFAULT NOW)

4. fund_events — manager changes, mergers, etc.
   Columns: event_id (UUID PK), scheme_code (FK), event_date (date NOT NULL),
   event_type (text: MANAGER_CHANGE/EXPENSE_RATIO_CHANGE/BENCHMARK_CHANGE/
   MERGER/NFO_LAUNCH/SCHEME_CLOSURE/AUM_DROP_ALERT),
   event_description (text NOT NULL), before_value (jsonb), after_value (jsonb),
   source_url (text NOT NULL), retrieved_at (timestamp NOT NULL),
   created_at (timestamp DEFAULT NOW)

5. pipeline_runs — tracks every DHRUV pipeline run
   Columns: run_id (UUID PK), client_id (UUID FK users.id),
   status (text: RUNNING/COMPLETED/DEADLOCKED/FAILED),
   revision_cycle (integer DEFAULT 0), started_at (timestamp DEFAULT NOW),
   completed_at (timestamp), final_portfolio_id (UUID nullable)

6. portfolio_drafts — all PRIYA drafts, never deleted
   Columns: draft_id (UUID PK), pipeline_run_id (UUID FK pipeline_runs),
   client_id (UUID FK users.id), version (integer NOT NULL),
   goal_buckets (jsonb NOT NULL), fund_allocations (jsonb NOT NULL),
   hedge_instruments (jsonb), confidence_score (numeric NOT NULL),
   backtest_summary (jsonb), open_critique_items (jsonb),
   status (text: DRAFT/SUBMITTED/APPROVED/REJECTED),
   created_at (timestamp DEFAULT NOW)

7. committee_votes — every vote cast, permanent record
   Columns: vote_id (UUID PK), pipeline_run_id (UUID FK), draft_id (UUID FK),
   voter (text: ARIA/KIRAN/VIKRAM/DHRUV), vote (text: APPROVE/REJECT),
   reasoning (text), critical_faults_count (integer DEFAULT 0),
   hedge_coverage_pct (numeric), voted_at (timestamp DEFAULT NOW)

After writing schema: update db/migrate.ts and run `npm run db:migrate`.

Please show me an implementation plan first before writing any code.
```

---

## STEP 2 — Immutable Audit Trail

PROMPT:
```
We are in Step 2. Steps 0-1 are complete.

CONTEXT:
- The Audit Trail is sacred and append-only (system-spec.md Part 3 and 4.5).
- Technology: better-sqlite3 with WAL mode (installed in Step 0).
- Path from env var AUDIT_TRAIL_DB_PATH.
- UPDATE and DELETE must be IMPOSSIBLE at both the SQL trigger level and TypeScript level.

BUILD: lib/audit/audit-trail.ts

1. DATABASE SETUP:
   Open/create better-sqlite3 DB at AUDIT_TRAIL_DB_PATH.
   Set PRAGMA journal_mode = WAL.
   Create table audit_logs if not exists:
     log_id TEXT PRIMARY KEY,
     pipeline_run_id TEXT NOT NULL,
     timestamp TEXT NOT NULL (ISO8601),
     agent_id TEXT NOT NULL (ARIA/KIRAN/SOMA/VIKRAM/PRIYA/DHRUV/ORACLE/SYSTEM),
     action_type TEXT NOT NULL,
     payload_hash TEXT NOT NULL (SHA-256),
     payload_json TEXT NOT NULL
   Create SQLite BEFORE UPDATE and BEFORE DELETE triggers on audit_logs that
   raise an error: "AUDIT TRAIL IS IMMUTABLE — NO MODIFICATIONS PERMITTED".

2. EXPORT TypeScript const enum AuditActionType:
   PIPELINE_START, PIPELINE_END, PIPELINE_DEADLOCK,
   DELIBERATION_MESSAGE_SENT, DELIBERATION_MESSAGE_RECEIVED,
   ORACLE_FLAG_RAISED, ORACLE_VALIDATION_PASSED,
   COMMITTEE_VOTE_CAST, COMMITTEE_VOTE_RESULT,
   PORTFOLIO_DRAFT_CREATED, PORTFOLIO_DRAFT_REVISED, PORTFOLIO_APPROVED,
   MEMORY_WRITE, MEMORY_READ,
   WEB_RESEARCH_QUERY, WEB_RESEARCH_RESULT,
   CLIENT_FACT_CONFIRMED, AGENT_WEEKLY_RESEARCH_COMPLETE,
   KNOWLEDGE_COMMONS_WRITE

3. EXPORT singleton auditTrail with ONLY these methods:
   - log(entry: AuditEntry): void
     Generates log_id (UUID), hashes payload_json with Node crypto SHA-256.
     Wraps in try/catch — a failed write must NEVER crash the pipeline.
     Logs failure to pino internally only.
   - query(filters: AuditQueryFilters): AuditLog[]
     Filters: pipeline_run_id?, agent_id?, action_type?, from_timestamp?, to_timestamp?
   - getRunSummary(pipeline_run_id: string): AuditRunSummary
     Returns human-readable summary of all events in a pipeline run.

4. On first init, write a SYSTEM log entry:
   "Audit trail initialised at [timestamp]. Database integrity: OK."

Please show me an implementation plan first before writing any code.
```

---

## STEP 3 — Agent Memory Store (Qdrant + TTL)

PROMPT:
```
We are in Step 3. Steps 0-2 are complete.

CONTEXT:
- Technology: Qdrant vector DB + Azure OpenAI embeddings (text-embedding-3-small, 1536 dims).
- Each of 6 agents has an isolated Qdrant collection.
- TTL rules from system-spec.md section 4.4 are enforced at RETRIEVAL time.
- Memories NEVER deleted: ACTIVE -> STALE (past TTL) -> ARCHIVED (past 3x TTL).

BUILD: lib/memory/ttl-config.ts and lib/memory/memory-store.ts

TTL CONFIG (lib/memory/ttl-config.ts):
Export MEMORY_TTL_DAYS constant:
  SOMA_NAV_DATA: 7, SOMA_FUND_COMPOSITION: 30, SOMA_FUND_RESEARCH: 30,
  KIRAN_MACRO_BULLETIN: 7, KIRAN_CLIENT_RISK_PROFILE: 90, KIRAN_HEDGE_MAP: 90,
  VIKRAM_CLIENT_GOAL_ASSESSMENT: 90, VIKRAM_STRATEGY_FRAMEWORK: 365,
  VIKRAM_MARKET_CYCLE_ANALYSIS: 90, ARIA_CRITIQUE_REPORT: 365,
  PRIYA_PORTFOLIO_DRAFT: 90,
  DHRUV_COMMITTEE_VOTE: Infinity, DHRUV_FINAL_PORTFOLIO: Infinity

QDRANT SETUP:
On module init, ensure these collections exist (create if not present):
  agent_memory_aria, agent_memory_kiran, agent_memory_soma,
  agent_memory_vikram, agent_memory_priya, agent_memory_dhruv,
  knowledge_commons
All collections: vector size 1536, distance COSINE.

EVERY QDRANT POINT PAYLOAD must have:
  content, agent_id, memory_type, source_url, retrieved_at,
  ttl_days, confidence_tier ("VERIFIED"|"INFERRED"|"ASSUMED"),
  tags, status ("ACTIVE"|"STALE"|"ARCHIVED"), created_at, pipeline_run_id?

CLASS AgentMemoryStore methods:
  write(agentId, entry): Promise<string>
    — Embeds content, computes status, upserts to Qdrant, logs MEMORY_WRITE to audit.
  recall(agentId, query, options): Promise<MemoryEntry[]>
    — Embeds query, cosine search. Returns ACTIVE only by default.
    — If options.include_stale=true, include STALE with staleness warning prepended.
    — Lazily update status for expired entries before returning.
    — Logs MEMORY_READ to audit.
  writeToKnowledgeCommons(entry): Promise<string>
    — Same as write but targets knowledge_commons collection.
  recallFromKnowledgeCommons(query): Promise<MemoryEntry[]>
    — Returns ACTIVE only from knowledge_commons.
  getStaleEntries(agentId): Promise<MemoryEntry[]>
    — Returns all entries past TTL. Used by DHRUV weekly consolidation.

Please show me an implementation plan first before writing any code.
```

---

## STEP 4 — Deliberation Room (Message Bus)

PROMPT:
```
We are in Step 4. Steps 0-3 are complete.

CONTEXT:
- The Deliberation Room is the ONLY communication channel between agents.
- Direct agent-to-agent calls are FORBIDDEN per system-spec.md Part 3.
- Every message: Zod-validated → ORACLE intercepts (Step 5 hook) → Audit logged → Broadcast.
- Technology: TypeScript EventEmitter with async middleware chain.

BUILD: lib/deliberation/message-schema.ts and lib/deliberation/deliberation-room.ts

MESSAGE SCHEMA using Zod (lib/deliberation/message-schema.ts):
{
  message_id: z.string().uuid(),
  pipeline_run_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  sender: z.enum(["ARIA","KIRAN","SOMA","VIKRAM","PRIYA","DHRUV","ORACLE"]),
  message_type: z.enum(["CRITIQUE","RISK_ALERT","FUND_REPORT","STRATEGY_PROPOSAL",
                         "PORTFOLIO_DRAFT","VOTE","DIRECTIVE","ORACLE_FLAG"]),
  recipient: z.union([z.literal("ALL"), z.enum(["ARIA","KIRAN","SOMA","VIKRAM","PRIYA","DHRUV","ORACLE"])]),
  payload: z.record(z.unknown()),
  oracle_validation: z.object({
    status: z.enum(["PASSED","FLAGGED","PENDING"]),
    flags: z.array(z.string())
  }),
  references: z.array(z.string().uuid()).default([])
}
Export inferred TypeScript type DeliberationMessage.
Export individual payload Zod schemas for each message_type.

CLASS DeliberationRoom (lib/deliberation/deliberation-room.ts):
  addMiddleware(fn: MiddlewareFn): void
    — fn signature: (msg: DeliberationMessage) => Promise<DeliberationMessage>
    — ORACLE will be registered here in Step 5.
  publish(rawMsg: Omit<DeliberationMessage,'message_id'|'timestamp'|'oracle_validation'>): Promise<DeliberationMessage>
    — Auto-generates message_id (UUIDv4) and timestamp (ISO8601 NOW).
    — Sets oracle_validation to {status:"PENDING", flags:[]}.
    — Validates against Zod schema. Throws on invalid.
    — Runs middlewares in sequence.
    — Logs final message to audit trail (DELIBERATION_MESSAGE_SENT).
    — Emits to all matching subscribers.
    — Returns final post-middleware message.
  subscribe(agentId, handler): () => void
    — Receives messages addressed to this agent OR "ALL".
    — Logs DELIBERATION_MESSAGE_RECEIVED to audit on delivery.
    — Returns unsubscribe function.
  getHistory(pipeline_run_id): DeliberationMessage[]
    — Returns all messages for a pipeline run from audit trail.
    — This is how the human operator reads the deliberation room.
  createForRun(pipeline_run_id): BoundDeliberationRoom
    — Returns a version pre-bound to a pipeline_run_id.

Please show me an implementation plan first before writing any code.
```

---

## STEP 5 — ORACLE Middleware

PROMPT:
```
We are in Step 5. Steps 0-4 are complete.

CONTEXT:
- ORACLE is a system-level middleware, NOT a conversational agent.
- It runs on every message via the addMiddleware() hook in Step 4.
- It CANNOT permanently block a message — only FLAG it.
- It CANNOT be overridden by any agent including DHRUV.
- Uses gpt-4o-mini (AGENT_MODEL_ANALYST) for consistency checks only.
- Source: system-spec.md Part 2 Agent 7 and Part 4.1.

BUILD: lib/oracle/tripwire-registry.ts, lib/oracle/confidence-scorer.ts, lib/oracle/oracle.ts

TRIPWIRE REGISTRY (lib/oracle/tripwire-registry.ts):
Export HALLUCINATION_TRIPWIRES array. Each entry: { field_name, pattern: RegExp,
required_sources: string[], description: string }.
Pre-populate with:
- Fund NAV figures (numeric patterns near "NAV")
- Fund manager names (Indian name patterns near "fund manager")
- SEBI registration numbers (IN[A-Z0-9]{7,} pattern)
- Expense ratio figures (percentages near "expense ratio")
- Inception dates (date patterns near "inception"/"launched"/"incepted")
- AUM figures (crore amounts near "AUM"/"assets under management")

CONFIDENCE SCORER (lib/oracle/confidence-scorer.ts):
Export pure function scoreConfidence(claim: ClaimInput): "VERIFIED"|"INFERRED"|"ASSUMED"
- VERIFIED: source_url present, retrieved_at within TTL, no contradictions.
- INFERRED: logical derivation from verified facts, no direct source.
- ASSUMED: no source, not derivable. Highest hallucination risk.

ORACLE MIDDLEWARE (lib/oracle/oracle.ts):
Export async function oracleMiddleware(msg): Promise<DeliberationMessage>
Implement all 6 checks:

CHECK 1 — Source Presence:
  Scan payload for numeric values, named entities, percentages, dates.
  If present but no source_url/evidence_sources/references found: add flag
  "SOURCE_MISSING — factual claims detected without source citation."

CHECK 2 — Source Freshness:
  For each source_url + retrieved_at in payload: compute days elapsed.
  Map sender + message_type to TTL from lib/memory/ttl-config.ts.
  If elapsed > TTL: add flag "SOURCE_STALE — [field] retrieved [N] days ago, TTL=[T] days."

CHECK 3 — Internal Consistency (LLM check):
  Only if payload JSON > 200 tokens. Call gpt-4o-mini:
  System: "Check this JSON for internal contradictions. Return {contradictions: string[]}.
  Empty array if none. Be concise."
  Add each contradiction as a flag.

CHECK 4 — Hallucination Tripwires:
  Run every regex from tripwire-registry.ts against full JSON-stringified payload.
  If match: check if payload source_url contains a required_source domain.
  If not: add flag "HALLUCINATION_RISK — [field_name] cited without approved source."

CHECK 5 — Set final status:
  oracle_validation.status = "PASSED" if zero flags, "FLAGGED" if any flags.

CHECK 6 — Audit Trail:
  Log ORACLE_FLAG_RAISED if FLAGGED, ORACLE_VALIDATION_PASSED if PASSED.

NEVER throw. On internal error: set status "PENDING", add flag
"ORACLE_INTERNAL_ERROR — manual review required", log to pino, return.

AFTER BUILDING: Register oracleMiddleware as the FIRST middleware in
DeliberationRoom constructor via addMiddleware().

Please show me an implementation plan first before writing any code.
```

---

## STEP 6 — Web Research Tool & Knowledge Commons

PROMPT:
```
We are in Step 6. Steps 0-5 are complete.

CONTEXT:
- Every agent uses WebResearchTool for sourced research (system-spec.md Part 3).
- Approved domains: amfiindia.com, sebi.gov.in, nseindia.com, bseindia.com,
  rbi.org.in, finmin.nic.in, mospi.gov.in, moneycontrol.com, economictimes.com,
  livemint.com, federalreserve.gov, imf.org, worldbank.org
- Technology: @tavily/core (installed in Step 0).
- All results pass through ORACLE before going to agent memory.
- KnowledgeCommons: shared space for DHRUV's weekly knowledge consolidation.

BUILD: lib/research/web-research-tool.ts and lib/research/knowledge-commons.ts

WEB RESEARCH TOOL CLASS (lib/research/web-research-tool.ts):
Constructor takes: agentId, memoryStore, deliberationRoom.
Method research(input: ResearchQuery): Promise<ResearchResult[]>

ResearchQuery type:
{
  query_text: string,
  intent: string,
  freshness_required_days: number,
  max_sources: number, // cap at 10
  approved_domains?: string[],
  memory_type: keyof typeof MEMORY_TTL_DAYS
}

Steps inside research():
a. CACHE CHECK: Search agent memory with cosine similarity > 0.92.
   If found and within freshness_required_days, return cached. Skip API call.
b. TAVILY SEARCH: Call Tavily with include_domains = approved domains list.
c. PARSE: Extract title, url, content_snippet, published_date per result.
d. ORACLE VALIDATION: Construct a minimal mock DeliberationMessage from each result
   and run oracleMiddleware. Include oracle_flags in result but do not discard.
e. MEMORY WRITE: Write each result to agent memory using memory_type for TTL.
f. AUDIT: Log WEB_RESEARCH_QUERY on start, WEB_RESEARCH_RESULT on complete.
g. RETURN: ResearchResult[] with { url, title, content_snippet, retrieved_at,
   confidence_tier, oracle_flags, memory_id }

KNOWLEDGE COMMONS (lib/research/knowledge-commons.ts):
Constructor takes: memoryStore, deliberationRoom, auditTrail.
WeeklyLearning type: { summary, source_urls: string[], tags: string[], agent: AgentId }

Methods:
contribute(agentId, learning): Promise<void>
  — source_urls must be non-empty (reject unsourced learnings with an error).
  — writeToKnowledgeCommons() in memory store.
  — Log KNOWLEDGE_COMMONS_WRITE to audit trail.

query(searchQuery, limit?): Promise<MemoryEntry[]>
  — recallFromKnowledgeCommons(). Returns ACTIVE only.

consolidate(weeklyLearnings: Record<AgentId, WeeklyLearning[]>): Promise<void>
  — Called by DHRUV every Friday.
  — Calls contribute() for each agent's learnings.
  — Publishes DIRECTIVE message to Deliberation Room:
    "Weekly knowledge consolidation complete. [N] new learnings added."

Please show me an implementation plan first before writing any code.
```

---

## STEP 7 — AMFI Data Seeding & Fund Database

PROMPT:
```
We are in Step 7. Steps 0-6 are complete.

CONTEXT:
- Existing scripts/sync-amfi-master.ts already syncs amfi_scheme_master.
- We extend it to also populate agent_funds and fund_snapshots (from Step 1).
- SOMA cannot function without fund data. This step enables her.
- AMFI NAV All format: SchemeCode|ISIN1|ISIN2|SchemeName|NAV|Date

BUILD: Extend scripts/sync-amfi-master.ts and create scripts/seed-agent-fund-db.ts

1. EXTEND sync-amfi-master.ts:
   After syncing amfi_scheme_master, also upsert into agent_funds for each scheme.
   Map AMFI category codes to our scheme_type enum. Tag with source_url = AMFI_NAV_URL.

2. CREATE scripts/seed-agent-fund-db.ts:
   Run once with: npx tsx scripts/seed-agent-fund-db.ts

   a. FETCH NAV DATA from AMFI_NAV_URL. Parse all lines.
      INSERT into fund_snapshots for today. source_url = AMFI_NAV_URL, retrieved_at = NOW.

   b. EXTENDED METRICS for top 100 priority funds (curate this list):
      — All Nifty 50 index direct plans
      — All Nifty Next 50 index direct plans
      — All ETFs (Nifty BeES, Gold ETFs, international ETFs)
      — Top 10 flexi-cap, large-cap, mid-cap, small-cap by AUM (direct plans only)
      Use Tavily WebResearchTool to fetch AUM, expense_ratio, 1Y/3Y/5Y returns.
      Store in fund_snapshots with correct source_url and retrieved_at.

   c. COMPOSITIONS for same top 100:
      Attempt to fetch top 10 holdings from AMC factsheets or AMFI data.
      Insert into fund_compositions with source_url and retrieved_at.

   d. END-OF-RUN REPORT: Print:
      "Seeded: [N] agent_funds, [M] fund_snapshots, [K] fund_compositions.
       Incomplete data for: [list of scheme_codes]"

3. ADD to package.json scripts:
   "seed:fund-db": "tsx scripts/seed-agent-fund-db.ts"
   "sync:amfi": already exists — update it to also populate agent_funds

4. CREATE lib/agents/soma-data-checker.ts:
   Export checkFundDataFreshness(schemeCodes: string[]): Promise<DataFreshnessReport>
   Queries fund_snapshots. Returns which funds have snapshots older than 7 days.
   DataFreshnessReport: { stale: string[], fresh: string[], missing: string[] }

Please show me an implementation plan first before writing any code.
```

---

## STEP 8 — SOMA & KIRAN Agents

PROMPT:
```
We are in Step 8. Steps 0-7 are complete.

CONTEXT:
- SOMA and KIRAN both use AGENT_MODEL_ANALYST (gpt-4o-mini).
- Both communicate ONLY via the Deliberation Room. No direct calls between agents.
- Both use lib/memory/memory-store.ts and lib/research/web-research-tool.ts.
- System prompts are in system-spec.md Part 5. Use them EXACTLY as written.
- All outputs must pass Zod validation before being published.

BUILD:
lib/agents/types/soma-types.ts
lib/agents/types/kiran-types.ts
lib/agents/soma.ts
lib/agents/kiran.ts

SOMA TYPES — export Zod schemas + inferred TS types for:
FundProfile { scheme_code, isin, scheme_name, amc, scheme_type, benchmark,
  fund_manager, fund_manager_tenure_years, nav, nav_date, aum_cr, expense_ratio,
  returns: {1y,3y,5y,10y}, alpha_3y, sharpe_3y, sortino_3y, max_drawdown,
  global_influence_factors: string[], // "US tech rally impacts this fund via IT exposure"
  data_freshness: {retrieved_at, is_stale, days_old}, source_urls: string[] }
FundComparisonMatrix { funds, comparison_dimensions, overlap_matrix, research_commentary }
CompositionAudit { scheme_code, audit_date, top_holdings, sector_distribution,
  top_10_concentration_pct, overlap_with, source_url, retrieved_at }
FundWatchlistAlert { scheme_code, scheme_name,
  alert_type: "MANAGER_CHANGE"|"AUM_DROP"|"EXPENSE_RATIO_HIKE"|"BENCHMARK_CHANGE",
  description, detected_at, source_url }

KIRAN TYPES — export Zod schemas + inferred TS types for:
MacroRiskBulletin { bulletin_id(UUID), generated_at,
  risk_level: "LOW"|"ELEVATED"|"HIGH"|"CRITICAL",
  rbi_policy_signal, fed_signal,
  india_vix: number, india_vix_trend: "UP"|"DOWN"|"STABLE",
  brent_crude_usd, gold_mcx_inr, usdinr_rate,
  usdinr_trend: "UP"|"DOWN"|"STABLE", fii_net_flow_cr,
  geopolitical_alerts: string[], key_risks: string[], key_observations: string[],
  sources: {url, retrieved_at}[] }
ClientRiskProfile { profile_id(UUID), client_id, version, generated_at, expires_at,
  age, years_to_goal, income_stability_score(1-10), existing_liabilities,
  dependants, emergency_fund_months, insurance_coverage, tax_bracket_pct,
  behavioural_risk_tolerance: "LOW"|"MEDIUM"|"HIGH",
  stated_risk_tolerance: "LOW"|"MEDIUM"|"HIGH", geographic_income_risk,
  factors: {factor_name, value, source_url, rationale}[] }
HedgeMap { portfolio_id, generated_at,
  positions: {fund_name, scheme_code, allocation_pct, risk_scenario,
    hedge_instrument, hedge_rationale, contingency_if_hedge_fails}[],
  overall_hedge_coverage_pct, sources: {url, retrieved_at}[] }
ScenarioStressTest { portfolio_id, tested_at,
  scenarios: {scenario_name, description, estimated_portfolio_return_pct,
    worst_case_drawdown_pct, recovery_timeline_months,
    most_affected_funds, least_affected_funds}[] }
  MUST include all 5 mandatory scenarios: +30% bull, -30% bear, rate hike +200bps,
  INR depreciation -15%, stagflation.

SOMA AGENT CLASS (lib/agents/soma.ts):
Constructor: deliberationRoom, memoryStore, webResearchTool, db
Methods:
- getFundProfile(schemeCode, pipelineRunId): Promise<FundProfile>
  Check fund_snapshots for data < 7 days. If stale, use WebResearchTool to refresh.
  Publish FUND_REPORT to Deliberation Room.
- compareFunds(schemeCodes, pipelineRunId): Promise<FundComparisonMatrix>
- auditComposition(schemeCode, pipelineRunId): Promise<CompositionAudit>
- runWeeklySweep(): Promise<void> — scheduled every Sunday

KIRAN AGENT CLASS (lib/agents/kiran.ts):
Constructor: deliberationRoom, memoryStore, webResearchTool, db
Methods:
- runDailyMacroScan(pipelineRunId?): Promise<MacroRiskBulletin>
  8-point macro scan from system-spec.md. Publish RISK_ALERT.
  If HIGH or CRITICAL: also publish DIRECTIVE to DHRUV.
- buildClientRiskProfile(clientId, clientData, pipelineRunId): Promise<ClientRiskProfile>
  Use WebResearchTool for behavioural finance research on this client archetype.
  Build factor set dynamically — not from a static questionnaire. Save with 90-day TTL.
- buildHedgeMap(portfolioDraft, pipelineRunId): Promise<HedgeMap>
- runStressTest(portfolioDraft, pipelineRunId): Promise<ScenarioStressTest>
  Use historical data from fund_snapshots table for calculations.
- runWeeklyResearch(): Promise<void> — scheduled every Tuesday (coverage of
  new hedging papers, SEBI/RBI publications, sovereign wealth fund disclosures)

Both agents MUST use the EXACT system prompts from system-spec.md Part 5.

Please show me an implementation plan first before writing any code.
```

---

## STEP 9 — VIKRAM & ARIA Agents

PROMPT:
```
We are in Step 9. Steps 0-8 are complete.

CONTEXT:
- VIKRAM: AGENT_MODEL_ANALYST (gpt-4o-mini). Strategy + goal assessment.
- ARIA: AGENT_MODEL_ANALYST (gpt-4o-mini). Contrarian critic.
- VIKRAM must have KIRAN's ClientRiskProfile before running the client interview.
- ARIA speaks ONLY AFTER PRIYA draft or VIKRAM plan — she cannot initiate.
- Both use EXACTLY the system prompts from system-spec.md Part 5.

BUILD:
lib/agents/types/vikram-types.ts
lib/agents/types/aria-types.ts
lib/agents/vikram.ts
lib/agents/aria.ts

VIKRAM TYPES — Zod schemas + TS types for:
DecomposedGoal { goal_id(UUID), goal_type: "RETIREMENT"|"CHILD_EDUCATION"|
  "HOME_PURCHASE"|"EMERGENCY_CORPUS"|"WEALTH_CREATION"|"VACATION"|"CUSTOM",
  description, target_corpus_lakh, target_date(ISO), current_corpus_lakh,
  monthly_sip_required_lakh, required_cagr_pct, inflation_adjusted_target_lakh,
  inflation_rate_used_pct }
ClientGoalAssessment { assessment_id(UUID), client_id, version, assessed_at,
  expires_at, stated_goals: string[], decomposed_goals: DecomposedGoal[],
  achievability_verdict: "ACHIEVABLE"|"REVISED"|"IMPOSSIBLE",
  revised_plan?: string, goal_sequence_conflicts: string[],
  sources: {url, retrieved_at}[] }
StrategyFramework { framework_id(UUID), client_id,
  selected_frameworks: {name, description, why_applicable, source_url, retrieved_at}[],
  asset_allocation_guidance: {equity_pct_range, debt_pct_range,
    gold_pct_range, international_pct_range} }
MarketContextBrief { brief_id(UUID), generated_at,
  market_regime: "EARLY_BULL"|"LATE_BULL"|"BEAR"|"RECOVERY"|"SIDEWAYS",
  confidence: "HIGH"|"MEDIUM"|"LOW", evidence: string[],
  implications_for_new_investors: string, sources: {url, retrieved_at}[] }

ARIA TYPES — Zod schemas + TS types for:
FaultCategory: "METHODOLOGY"|"CONCENTRATION"|"SURVIVORSHIP_BIAS"|
               "RECENCY_BIAS"|"GOAL_MISMATCH"|"COMPLIANCE"|"OTHER"
Severity: "CRITICAL"|"MAJOR"|"MINOR"|"OBSERVATION"
CritiqueFault { fault_id(UUID), fault_category, fault_description (max 200 words — enforce with Zod .max()),
  evidence_sources: {url, retrieved_at, excerpt_summary}[],
  severity, suggested_remedy?: string (max 100 words), confidence_tier,
  from_fault_library?: boolean }
CritiqueReport { report_id(UUID), pipeline_run_id, draft_version, critiqued_at,
  faults: CritiqueFault[], critical_count, major_count, minor_count,
  observation_count, overall_assessment: string }

VIKRAM AGENT CLASS:
- conductClientInterview(clientRiskProfile, pipelineRunId): Promise<string[]>
  Generate 15-25 contextualised questions. No duplicates.
  Skip questions whose answers are already in clientRiskProfile.
- assessGoals(clientAnswers, clientRiskProfile, pipelineRunId): Promise<ClientGoalAssessment>
  Run 5-step protocol from system-spec.md.
  ACHIEVABILITY MATH IS DETERMINISTIC CODE (not LLM):
  — Compute required CAGR via compound interest: (target/current)^(1/years) - 1
  — Required CAGR > 16%: flag as HIGH_RISK
  — Required CAGR > 20%: flag as UNREALISTIC (verdict: REVISED or IMPOSSIBLE)
  — Monthly SIP > 60% of stated income: flag as UNREALISTIC
  Publish STRATEGY_PROPOSAL to Deliberation Room.
- selectStrategyFramework(assessment, riskProfile, pipelineRunId): Promise<StrategyFramework>
  Recall from memory first. Use WebResearchTool if memory stale.
  Publish StrategyFramework to Deliberation Room.
- runWeeklyResearch(): Promise<void> — runs every Tuesday

ARIA AGENT CLASS:
- critiquePortfolioDraft(draft, context, pipelineRunId): Promise<CritiqueReport>
  Step 1: recall fault library from memory (ARIA_CRITIQUE_REPORT type).
  Step 2: LLM analysis with exact ARIA system prompt from system-spec.md Part 5.
  Step 3: Validate output against CritiqueReport Zod schema. Reject if invalid.
  Step 4: Save CritiqueReport to memory as new fault library entry.
  Step 5: Publish CRITIQUE message to Deliberation Room.
- critiqueGoalPlan(assessment, pipelineRunId): Promise<CritiqueReport>
  Same as above but targeting VIKRAM's ClientGoalAssessment.
- respondToCounterArgument(originalFault, counterArgument, pipelineRunId): Promise<CritiqueFault>
  ARIA must EITHER a) downgrade severity with explicit new reasoning,
  OR b) maintain severity with new specific evidence.
  She CANNOT simply re-state her original argument.
- runWeeklyResearch(): Promise<void> — runs every Monday

Please show me an implementation plan first before writing any code.
```

---

## STEP 10 — PRIYA Agent (Portfolio Architect)

PROMPT:
```
We are in Step 10. Steps 0-9 are complete.

CONTEXT:
- PRIYA uses AGENT_MODEL_ORCHESTRATOR (gpt-4o) — the most complex synthesis task.
- She is the ONLY agent who can assign portfolio weights.
- She CANNOT submit a portfolio with confidence_score < 60.
- She CANNOT use FundProfile data older than 7 days (SOMA_NAV_DATA TTL).
- Backtesting uses REAL fund_snapshots data from PostgreSQL. NEVER fabricate numbers.

BUILD:
lib/agents/types/priya-types.ts
lib/agents/priya-backtest.ts
lib/agents/priya.ts

PRIYA TYPES — Zod schemas + TS types for:
GoalBucket { bucket_id(UUID), goal_id, goal_type, target_corpus_lakh, target_date,
  time_horizon_years, risk_profile: "CONSERVATIVE"|"MODERATE"|"AGGRESSIVE",
  allocation_pct }
FundAllocation { allocation_id(UUID), fund_name, isin, scheme_code,
  allocation_pct, goal_bucket_id, rationale (must cite SOMA FundProfile data),
  fund_profile_retrieved_at (must be within 7-day TTL), overlap_checked: boolean }
BacktestSummary { backtest_id(UUID), period_years (min 5), start_date, end_date,
  portfolio_cagr_pct, benchmark_cagr_pct (Nifty 50 TRI), alpha_pct,
  max_drawdown_pct, max_drawdown_recovery_months, sharpe_ratio, sortino_ratio,
  data_completeness_pct, proxy_funds_used: {original, proxy, reason}[],
  scenario_overlay: ScenarioStressTest }
PortfolioConfidenceScore { total(0-100),
  breakdown: { data_freshness(0|20), goal_achievability(0|10|20),
    hedge_completeness(0|20), critique_severity(0|10|20), backtest_quality(0|20) },
  blocking_reasons: string[] }
PortfolioDraft { portfolio_id(UUID), client_id, pipeline_run_id, version,
  revision_number, goal_buckets: GoalBucket[], fund_allocations: FundAllocation[],
  hedge_instruments: HedgeMap, confidence_score: PortfolioConfidenceScore,
  backtest_summary: BacktestSummary, open_critique_items: CritiqueFault[],
  universe_filters_applied: {filter, threshold}[],
  overlap_flags: {fund_a, fund_b, overlap_pct}[],
  status: "DRAFT"|"SUBMITTED"|"APPROVED"|"REJECTED" }

BACKTESTING ENGINE (lib/agents/priya-backtest.ts) — PURE MATH, NO LLM:
Export runBacktest(allocations: FundAllocation[], db: DrizzleDB): Promise<BacktestSummary>
- Fetch fund_snapshots for each fund for last 10 years (or max available).
- Calculate weighted portfolio NAV series month by month.
- Compute CAGR, max drawdown, Sharpe vs Nifty 50 TRI, Sortino.
- If fund has < 5 years data: substitute proxy (nearest benchmark index fund).
  Document in proxy_funds_used. Do NOT silently drop the fund.
- If data_completeness_pct < 70%: log warning. Deduct backtest_quality points.

CONFIDENCE SCORE FORMULA (deterministic, no LLM):
data_freshness: +20 if all SOMA FundProfiles retrieved within 7 days, else 0
goal_achievability: ACHIEVABLE=+20, REVISED=+10, IMPOSSIBLE=0
hedge_completeness: +20 if HedgeMap.overall_hedge_coverage_pct >= 80, else 0
critique_severity: +20 if 0 CRITICAL faults, +10 if 0 CRITICAL but has MAJOR, else 0
backtest_quality: +20 if backtested >= 5 years and data_completeness >= 70%, else 0

PRIYA AGENT CLASS 7-STEP PROTOCOL:
Step 1 — Inputs Assembly: Verify all inputs present and within TTL.
  Fail fast if missing: publish DIRECTIVE to DHRUV explaining what is missing.
Step 2 — Universe Filtering: Apply and DOCUMENT filters:
  expense_ratio < 1.5% for active, < 0.5% for index/ETF,
  min track record 3 years, min AUM 500Cr equity / 1000Cr debt.
Step 3 — Allocation Design: weights per goal bucket using StrategyFramework guidance.
Step 4 — Overlap Analysis: call soma.auditComposition() for every fund pair.
  Auto-flag any pair with overlap > 40%.
Step 5 — Compute confidence_score. If < 60: DO NOT PUBLISH.
  Send error DIRECTIVE to DHRUV: "Cannot submit. Score = [X]. Reasons: [...]"
Step 6 — Run backtesting engine.
Step 7 — Publish PORTFOLIO_DRAFT to Deliberation Room.
  Save to portfolio_drafts table in PostgreSQL.

Additional methods:
revise(previousDraft, critiqueReport, hedgeMap, pipelineRunId): Promise<PortfolioDraft>
  — Address all CRITICAL and MAJOR faults before resubmitting.
  — Increment version and revision_number.
  — Carry forward unresolved MINOR items in open_critique_items.
runWeeklyResearch(): Promise<void> — every Wednesday

Please show me an implementation plan first before writing any code.
```

---

## STEP 11 — DHRUV Orchestrator & Investment Committee

PROMPT:
```
We are in Step 11. Steps 0-10 are complete.

CONTEXT:
- DHRUV uses AGENT_MODEL_ORCHESTRATOR (gpt-4o).
- He is the pipeline controller AND investment committee chair.
- Voting: ARIA, KIRAN, VIKRAM vote (3 votes). PRIYA abstains. DHRUV only as tiebreaker.
- APPROVE requires: 2/3 majority AND zero CRITICAL faults from ARIA AND
  HedgeMap.overall_hedge_coverage_pct >= 80.
- A single CRITICAL fault from ARIA = automatic REJECT regardless of other votes.
- Deadlock triggers on revision cycle 5.
- Committee votes and final portfolios in DHRUV's memory NEVER expire.

BUILD:
lib/agents/types/dhruv-types.ts
lib/pipeline/pipeline-state-machine.ts
lib/agents/dhruv.ts

DHRUV TYPES:
PipelineStage: "ONBOARDING"|"KIRAN_RISK_PROFILE"|"VIKRAM_INTERVIEW"|
  "VIKRAM_GOAL_ASSESSMENT"|"SOMA_FUND_UNIVERSE"|"VIKRAM_STRATEGY"|
  "KIRAN_HEDGE_MAP"|"PRIYA_BUILD"|"DELIBERATION"|"COMMITTEE_VOTE"|
  "REVISION"|"APPROVED"|"DEADLOCKED"|"FAILED"
CommitteeVoteRecord { vote_id(UUID), pipeline_run_id, draft_version,
  votes: {voter:"ARIA"|"KIRAN"|"VIKRAM"|"DHRUV", vote:"APPROVE"|"REJECT", reasoning}[],
  critical_faults_from_aria, hedge_coverage_from_kiran,
  outcome: "APPROVED"|"REJECTED", outcome_reason, voted_at }
DeadlockReport { report_id(UUID), pipeline_run_id, triggered_at,
  revision_cycles_completed,
  agent_objections: {agent, objection_summary, unresolved_faults}[],
  dhruv_compromise_proposal, compromise_vote_outcome: "ACCEPTED"|"REJECTED"|"PENDING",
  recommended_action }
FinalPortfolioPacket { packet_id(UUID), pipeline_run_id, client_id,
  generated_at, valid_until (NOW + 90 days),
  executive_summary (max 500 words — enforce),
  client_goal_summary: ClientGoalAssessment,
  achievability_verdict, full_portfolio: PortfolioDraft,
  risk_and_hedge_map: HedgeMap, backtest_summary: BacktestSummary,
  confidence_score_breakdown: PortfolioConfidenceScore,
  open_observations: CritiqueFault[], // MINOR items only
  sebi_disclaimer, data_freshness_disclosure, backtest_disclaimer,
  conflict_of_interest_disclosure, validity_disclosure, // exact text from spec
  audit_trail_pipeline_run_id }

DISCLAIMER TEXTS (hardcoded from system-spec.md section 4.3):
sebi_disclaimer: "This portfolio recommendation is generated by an AI system and is
  for informational and educational purposes only. It does not constitute investment
  advice under the SEBI (Investment Advisers) Regulations, 2013. Please consult a
  SEBI-registered investment adviser before making investment decisions."
backtest_disclaimer: "Past performance of mutual funds does not guarantee future
  returns. Backtested results are simulated and may not account for all real-world
  conditions."
conflict_of_interest_disclosure: "This system does not receive commissions or
  payments from any AMC or distributor. Fund recommendations are based solely on
  research and analysis."
validity_disclosure: "This portfolio recommendation is valid for 90 days from the
  date of generation."

PIPELINE STATE MACHINE (lib/pipeline/pipeline-state-machine.ts):
Class PipelineStateMachine with:
- Tracks current PipelineStage for a given pipeline_run_id.
- transition(from, to, pipeline_run_id): validates legal transitions, logs to audit trail.
- Illegal transitions throw with clear error message.

DHRUV AGENT CLASS (lib/agents/dhruv.ts):
startPipeline(clientId, clientData): Promise<string>
  — Creates pipeline_runs record. Returns pipeline_run_id.
  — Logs PIPELINE_START to audit trail.

runFullPipeline(pipelineRunId): Promise<FinalPortfolioPacket | DeadlockReport>
  Full sequential orchestration:
  1. kiran.buildClientRiskProfile()
  2. vikram.conductClientInterview() → return questions to caller, await answers
  3. vikram.assessGoals(answers)
  4. aria.critiqueGoalPlan() → VIKRAM must address CRITICAL items before proceeding
  5. soma: getFundProfile() for relevant universe
  6. vikram.selectStrategyFramework()
  7. kiran.buildHedgeMap() + kiran.runStressTest()
  8. priya.buildPortfolio()
  9. runCommitteeSession() → if REJECTED: priya.revise() → loop (max 5 cycles)
  10. If APPROVED after vote: compileFinalPortfolioPacket()
  11. If revision_cycle reaches 5: executeDeadlockProtocol()

runCommitteeSession(draft, pipelineRunId): Promise<CommitteeVoteRecord>
  — Run in parallel: aria.critiquePortfolioDraft(), kiran hedge validation, vikram alignment check.
  — Apply voting rules strictly (see CONTEXT above).
  — Save to committee_votes table in PostgreSQL.
  — Publish VOTE message to Deliberation Room.

executeDeadlockProtocol(pipelineRunId, allDrafts): Promise<DeadlockReport>
  — Summarise all agent objections from Deliberation Room history.
  — Propose a compromise. Run final vote.
  — Select highest-confidence-scoring draft as fallback output.
  — Log PIPELINE_DEADLOCK to audit trail.

compileFinalPortfolioPacket(draft, pipelineRunId): Promise<FinalPortfolioPacket>
  — Assemble all 10 required elements. Hardcode all 4 disclaimer texts.
  — Set valid_until = new Date(Date.now() + 90*24*60*60*1000).toISOString()

runWeeklyKnowledgeConsolidation(): Promise<void>
  — Every Friday. Gather WeeklyLearningSummary from all agents.
  — Call knowledgeCommons.consolidate().

runWeeklyResearch(): Promise<void> — every Thursday

Please show me an implementation plan first before writing any code.
```

---

## STEP 12 — Cron Scheduler for All Agent Duties

PROMPT:
```
We are in Step 12. Steps 0-11 are complete.

CONTEXT:
Research schedule from system-spec.md Part 3:
  KIRAN:  Daily macro scan — every morning at 7:00 AM
  SOMA:   Weekly sweep — every Sunday 6:00 AM
  ARIA:   Weekly research — every Monday 8:00 AM
  VIKRAM: Weekly research — every Tuesday 8:00 AM
  PRIYA:  Weekly research — every Wednesday 8:00 AM
  DHRUV:  Governance research — every Thursday 8:00 AM
  DHRUV:  Knowledge consolidation — every Friday 10:00 AM
Technology: node-cron (installed in Step 0).

BUILD: lib/scheduler/agent-scheduler.ts and update app/api/scheduler/route.ts

SCHEDULER (lib/scheduler/agent-scheduler.ts):
Export startAgentScheduler(agents: AllAgents): void
AllAgents type: { dhruv, kiran, soma, aria, vikram, priya }

Register cron jobs:
- '0 7 * * *'   → kiran.runDailyMacroScan(undefined)
- '0 6 * * 0'   → soma.runWeeklySweep()
- '0 8 * * 1'   → aria.runWeeklyResearch()
- '0 8 * * 2'   → vikram.runWeeklyResearch()
- '0 8 * * 3'   → priya.runWeeklyResearch()
- '0 8 * * 4'   → dhruv.runWeeklyResearch()
- '0 10 * * 5'  → dhruv.runWeeklyKnowledgeConsolidation()

EACH JOB MUST:
- Wrap in try/catch. Log errors to pino. NEVER crash the server.
- Write audit trail entry on start (AGENT_WEEKLY_RESEARCH_COMPLETE action).
- Track last_run_at, next_run_at, last_status per job in a module-level Map.

SCHEDULER INIT (app/api/scheduler/route.ts):
GET handler that:
1. Uses global.__schedulerStarted flag to call startAgentScheduler() only once.
2. Returns scheduler status JSON:
   { status: "RUNNING", jobs: [{name, cron, last_run, next_run, last_status}] }
Call this endpoint on server startup via Next.js instrumentation or layout.

Important: Use a module-level singleton pattern. Do NOT restart scheduler on
Next.js hot reload. Guard with: if (!global.__schedulerStarted) { ... }

Please show me an implementation plan first before writing any code.
```

---

## STEP 13 — API Routes

PROMPT:
```
We are in Step 13. Steps 0-12 are complete.

CONTEXT:
Existing routes: /api/health, /api/me, /api/onboarding, /api/portfolio/holdings,
/api/portfolio/upload, /api/chat. Do NOT modify these.
All new routes follow the same patterns: pino logging, Zod body validation,
consistent error shape {error: string, code: string}, lib/auth pattern for user.
No advice language — respect lib/contracts/no-advice.ts.

ADD these new route files:

1. POST /api/pipeline/start  (app/api/pipeline/start/route.ts)
   Body: { client_data: OnboardingData }
   Action: dhruv.startPipeline(userId, clientData)
   Validate: no active pipeline_runs with status=RUNNING exists for this user.
   Response: { pipeline_run_id: string, status: "STARTED" }

2. GET /api/pipeline/[runId]/status  (app/api/pipeline/[runId]/status/route.ts)
   Fetch pipeline_runs record for runId. Verify ownership (client_id = current user).
   Response: { run_id, status, current_stage, revision_cycle, started_at }

3. POST /api/pipeline/[runId]/interview  (app/api/pipeline/[runId]/interview/route.ts)
   Body: { answers: Record<string, string> }
   Action: Pass answers to VIKRAM to advance from VIKRAM_INTERVIEW stage.
   Triggers vikram.assessGoals() internally.
   Response: { stage: "VIKRAM_GOAL_ASSESSMENT", message: "Goals assessment in progress" }

4. GET /api/pipeline/[runId]/deliberation  (app/api/pipeline/[runId]/deliberation/route.ts)
   Returns full Deliberation Room history via deliberationRoom.getHistory(runId).
   Ordered chronologically. Includes oracle_validation for each message.
   Response: { messages: DeliberationMessage[], total: number }

5. GET /api/pipeline/[runId]/result  (app/api/pipeline/[runId]/result/route.ts)
   If status COMPLETED: return FinalPortfolioPacket.
   If status DEADLOCKED: return DeadlockReport.
   If status RUNNING: return { status: "IN_PROGRESS", current_stage }
   If status FAILED: return 500 with error details.

6. GET /api/audit  (app/api/audit/route.ts)
   Query params: pipeline_run_id?, agent_id?, action_type?, from?, to?
   Calls auditTrail.query(filters).
   Response: { logs: AuditLog[], total: number }

7. GET /api/macro-bulletin  (app/api/macro-bulletin/route.ts)
   Returns KIRAN's most recent MacroRiskBulletin from memory or DB.
   Response: MacroRiskBulletin | 404 if none generated yet.

8. EXTEND GET /api/health  (existing file — extend only):
   Add these checks to existing health response:
   - qdrant_connected: boolean
   - audit_trail_accessible: boolean
   - scheduler_running: boolean
   - latest_macro_bulletin_age_days: number | null

Please show me an implementation plan first before writing any code.
```

---

## STEP 14 — Test Suite

PROMPT:
```
We are in Step 14 (final). Steps 0-13 are complete.

CONTEXT:
Existing test framework: vitest (npm test) and playwright (npx playwright test).
Tests live in tests/ directory. LLM calls must be MOCKED in all unit tests.

BUILD THE FOLLOWING:

MOCK HELPERS (tests/mocks/azure-openai.mock.ts):
Export mock implementations for all Azure OpenAI calls:
- mockChatCompletion(model, messages): Returns deterministic JSON based on
  keywords in the last user message. Map common keywords to expected output shapes.
- mockEmbedding(text): Returns a fixed 1536-dim Float32Array derived from
  text.length and a simple hash. Fast, reproducible.
Use vi.mock() to inject these in each unit test file.

UNIT TESTS (vitest):

tests/unit/oracle.test.ts
- Message with numeric values but no source_url → FLAGGED with SOURCE_MISSING
- Fund NAV mentioned with amfiindia.com source → PASSED
- Fund NAV mentioned without any approved source → HALLUCINATION_RISK flag
- Retrieved_at 10 days ago for SOMA_NAV_DATA (TTL 7 days) → SOURCE_STALE flag
- ORACLE internal error → returns PENDING status, never throws

tests/unit/confidence-score.test.ts
- All 5 components present and passing → score = 100
- ACHIEVABLE verdict + CRITICAL fault → score = 40 (blocked, reason listed)
- REVISED verdict + no faults + full backtest → score = 80 (allowed)
- IMPOSSIBLE verdict → goal_achievability = 0 regardless of other components
- Score exactly 60 → allowed. Score 59 → blocked.

tests/unit/backtest.test.ts
- Known NAV series → verify CAGR calculation matches expected value (use simple example)
- Max drawdown calculation on a series that drops then recovers
- Proxy fund substitution triggers when data < 5 years
- data_completeness_pct < 70% → warning logged, backtest_quality = 0

tests/unit/committee-vote.test.ts
- 3 APPROVE + 0 CRITICAL + hedge 85% → APPROVED
- 2 APPROVE + 0 CRITICAL + hedge 85% → APPROVED (majority)
- 1 APPROVE + 0 CRITICAL + hedge 85% → REJECTED (no majority)
- 2 APPROVE + 1 CRITICAL from ARIA → auto REJECTED (CRITICAL veto)
- hedge_coverage = 79% → auto REJECTED regardless of votes
- PRIYA vote is ignored (she abstains)

tests/unit/memory-ttl.test.ts
- Write entry with TTL 7 days, advance clock 8 days → recall returns STALE warning
- Advance clock 22 days (3x TTL) → recall returns ARCHIVED warning
- DHRUV_COMMITTEE_VOTE: TTL = Infinity → always returns ACTIVE
- include_stale=false (default): STALE entries NOT returned
- include_stale=true: STALE entries returned with "[STALE — X days ago]" prefix

tests/unit/audit-trail.test.ts
- Single log() call → record queryable with query()
- Simulate UPDATE attempt on audit_logs → SQLite trigger throws error
- payload_hash matches SHA-256 of payload_json (verify with crypto.createHash)
- Failed log() write → error caught internally, does NOT throw to caller
- getRunSummary returns all events for a given pipeline_run_id

tests/unit/vikram-achievability.test.ts
- Required CAGR = 24% → verdict REVISED with explanation
- Required CAGR = 12% over 15 years → verdict ACHIEVABLE
- Required CAGR = 22% → verdict IMPOSSIBLE
- Monthly SIP > 60% of income → flagged as UNREALISTIC in assessment
- Retirement date before child education date → goal_sequence_conflicts populated

tests/unit/aria-critique.test.ts
- Portfolio with 80% in one AMC → CONCENTRATION fault raised
- 1-year return used as primary selection criterion → RECENCY_BIAS fault raised
- Portfolio with 0 CRITICAL faults → critique_count correct
- respondToCounterArgument with valid new evidence → severity may change
- respondToCounterArgument without new evidence → severity maintained with explanation

INTEGRATION TESTS (vitest, with real SQLite + mock Qdrant):

tests/integration/deliberation-room.test.ts
- publish() → ORACLE intercepts → audit trail entry created → subscriber receives
- Subscriber ARIA receives messages to "ALL" and messages to "ARIA"
- Subscriber ARIA does NOT receive messages to "KIRAN"
- getHistory() returns messages in chronological order for a pipeline_run_id
- Invalid message (missing required field) → publish() throws Zod error

tests/integration/pipeline-state-machine.test.ts
- Legal transition PRIYA_BUILD → DELIBERATION → logs to audit trail
- Illegal transition ONBOARDING → COMMITTEE_VOTE → throws error
- DEADLOCKED is a terminal state — no further transitions allowed

E2E TEST (Playwright):

tests/e2e/pipeline-happy-path.spec.ts
- Navigate to /onboarding. Fill form. Submit.
- POST /api/pipeline/start. Capture pipeline_run_id.
- Poll GET /api/pipeline/[runId]/status (max 120s) until stage = COMMITTEE_VOTE.
- GET /api/pipeline/[runId]/deliberation. Assert: messages from ARIA, KIRAN, VIKRAM present.
- Poll until status = COMPLETED or DEADLOCKED (max 300s).
- GET /api/pipeline/[runId]/result.
- Assert: response contains sebi_disclaimer text.
- Assert: confidence_score.total >= 60.
- Assert: fund_allocations array is non-empty.
- Assert: backtest_summary.period_years >= 5.

Please show me an implementation plan first before writing any code.
```
