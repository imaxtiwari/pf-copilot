# Pipeline Architecture Decision

## 1. Scope & Purpose

Restore the DHRUV multi-agent portfolio committee pipeline as an **educational simulation** only. The pipeline demonstrates how an investment committee might reason about a portfolio. It does **not** provide investment advice, buy/sell recommendations, or guaranteed outcomes.

Every output — committee votes, portfolio drafts, backtests, and final packets — must carry an educational disclaimer:

> "This is an educational simulation. It is not investment advice. Please consult a SEBI-registered investment advisor before acting."

## 2. User Flow

1. User uploads a CAS PDF via `POST /api/cas/ingest`.
2. After holdings are persisted, the ingest route sends `pipeline.start` to Inngest.
3. Inngest function creates a `pipeline_runs` row and advances through stages.
4. Stitch frontend polls status via REST `GET /api/pipeline/{runId}/status`.
5. When complete, frontend fetches result via REST `GET /api/pipeline/{runId}/result`.
6. Chat remains independent and unaffected by pipeline failures.

## 3. Agents & Responsibilities

| Agent | Role | Restoration Priority |
|-------|------|---------------------|
| DHRUV | Committee chair / pipeline coordinator | P0 |
| VIKRAM | Goal assessment interviewer | P0 |
| RIYA | Behavioral profiling | P0 |
| SOMA | Fund universe curation & data freshness | P0 |
| KIRAN | Risk map / hedge scenarios | P0 |
| ARIA | Critique / contrarian review | P0 |
| PRIYA | Portfolio draft builder | P0 |
| PRIYA-backtest | Historical simulation | P0 |
| SEBI | Compliance / disclaimers | P0 |
| ATLAS | Draft comparison reports | P1 |
| MENTOR | Meta-learning from deliberation | P1 |
| ORACLE | Validation gate / tripwire | P0 |

## 4. Runtime Architecture

### 4.1 Async Runtime: Inngest

Events:
- `pipeline.start` → starts a new run
- `pipeline.stage.completed` → internal step signal
- `pipeline.completed` → run finished
- `pipeline.failed` → run failed

The pipeline function uses `ctx.step.run()` per stage for automatic retry and observability.

### 4.2 State Machine Stages

```
INTAKE
  → RIYA_BEHAVIORAL_PROFILING
  → PROFILING_AND_GOAL_ASSESSMENT
  → SOMA_FUND_UNIVERSE
  → VIKRAM_STRATEGY
  → KIRAN_HEDGE_MAP
  → ARIA_PREFLIGHT
  → PRIYA_BUILD
  → SEBI_COMPLIANCE
  → DELIBERATION
  → COMMITTEE_VOTE
  → [REVISION loop max 5 cycles]
  → ATLAS_COMPARISON
  → PDF_GENERATION
  → COMPLETED
  → DEADLOCKED (on revision cycle 5)
  → FAILED
```

### 4.3 Trigger

`app/api/cas/ingest/route.ts` sends `pipeline.start` after the holdings transaction commits. This is non-blocking to the HTTP response.

Rate limit: one `pipeline.start` per user per 10 minutes.

If a second CAS upload arrives while a pipeline is active, the new upload still ingests holdings but does not start a second pipeline until the active one completes.

## 5. Frontend API Surface

The frontend integrates with the pipeline exclusively through REST endpoints. There is no MCP server.

Authentication: Supabase session cookie / bearer token via `getCurrentUser()`.

### 5.1 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/pipeline/start` | Start a new run for the current upload. |
| `GET` | `/api/pipeline/{runId}/status` | Poll run status, stage, revision cycle. |
| `GET` | `/api/pipeline/{runId}/result` | Fetch the simulation packet or not-ready status. |
| `GET` | `/api/pipeline/{runId}/deliberation` | Fetch deliberation messages. |
| `GET` | `/api/pipeline/{runId}/comparison` | Fetch comparison reports (P1). |
| `GET` | `/api/pipeline/{runId}/pdf` | Download generated PDF (P1). |

### 5.2 Standard Disclaimer

All simulation endpoints and UI surfaces prepend or include:

> "This is an educational simulation. It is not investment advice. Please consult a SEBI-registered investment advisor before acting."

## 6. Database & Audit Trail

### 6.1 Restored Tables

- `pipeline_runs`
- `pipeline_results`
- `portfolio_drafts`
- `deliberation_messages`
- `committee_votes`
- `comparison_reports`
- `compliance_reports`
- `behavioral_fingerprints`
- `agent_funds`
- `fund_snapshots`
- `fund_compositions`
- `drift_reports`
- `sip_adherence_reports`
- `scheduler_locks`
- `scheduler_runs`
- `knowledge_commons`

### 6.2 Audit Trail Migration

The existing `lib/audit/audit-trail.ts` uses SQLite (`better-sqlite3`). This is **not** production-grade for Vercel/Supabase because:
- SQLite files are not shared across serverless invocations.
- Writes on Vercel are ephemeral.

**Decision:** Migrate audit logs to a new PostgreSQL table `pipeline_audit_logs` with:
- `log_id` (PK)
- `pipeline_run_id` (FK)
- `user_id` (FK)
- `timestamp`
- `agent_id`
- `action_type`
- `oracle_confidence`
- `payload_hash`
- `payload_json`

Immutability enforced via PostgreSQL triggers that reject UPDATE/DELETE.

## 7. Data Sources & Fallback Strategy

- **Fund metadata:** `amfi_scheme_master` table (already synced daily).
- **Fund factsheets:** `factsheet_chunks` table with embeddings (already ingested).
- **Daily NAV:** `fund_snapshots` table populated from AMFI daily NAV files.
- **Historical NAV gaps:** Where scheme-level history is insufficient, PRIYA-backtest will:
  1. Use available snapshots from `fund_snapshots`.
  2. Fall back to category-level proxy returns derived from AMFI category averages.
  3. Flag proxy usage in the simulation output.
- **Fund compositions:** If unavailable, SEBI/ATLAS will flag "composition data missing" instead of blocking.

## 8. Security Boundaries

- All pipeline tables have RLS enabled with `auth.uid()` = `user_id`/`client_id`.
- API routes verify `getCurrentUser()`.
- Service-role operations (Inngest function) bypass RLS by using the service client; they must validate that the `userId` in the event payload is consistent with the pipeline run owner.
- Audit logs are immutable at the database level.
- Web research tool must use an allowlisted domain set (e.g., `amfiindia.com`, `sebi.gov.in`, RBI, NSC) and never call arbitrary URLs.
- No secrets in code; all API keys via environment variables.

## 9. No-Advice Guardrails

Forbidden words in any prompt or output:
- buy, sell, invest in, should, must, recommend, recommended, best fund, good fund, bad fund, best stock, good stock, bad stock, top pick.

Advisory verdicts replaced with neutral language:
- `ACHIEVABLE` → `ALIGNS_WITH_GOALS`
- `REVISED` → `NEEDS_DISCUSSION`
- `IMPOSSIBLE` → `OUT_OF_SCOPE`

Committee votes are labeled as "simulated committee opinion."
Portfolio drafts are labeled as "hypothetical allocation for educational discussion."

## 10. File Inventory

| File | Purpose | Priority | Notes |
|------|---------|----------|-------|
| db/schema.ts | Pipeline tables export | P0 | Add restored tables |
| db/migrations/0005_restore_pipeline_schema.sql | Migration | P0 | Includes RLS + audit triggers |
| lib/audit/audit-trail.ts | Audit trail (PG migration) | P0 | Currently SQLite |
| lib/deliberation/message-schema.ts | Message Zod schemas | P0 | |
| lib/deliberation/deliberation-room.ts | Message bus | P0 | Postgres-backed |
| lib/pipeline/pipeline-state-machine.ts | Stage transitions | P0 | |
| lib/memory/memory-store.ts | Qdrant memory wrapper | P0 | |
| lib/memory/semantic-summary.ts | Memory summarization | P1 | |
| lib/memory/ttl-config.ts | Memory TTL config | P1 | |
| lib/scheduler/mutex.ts | Scheduler locking | P1 | |
| lib/scheduler/agent-scheduler.ts | Agent cron scheduler | P2 | |
| lib/research/web-research-tool.ts | Web research | P1 | Tavily or stub |
| lib/research/knowledge-commons.ts | Shared memory | P1 | |
| lib/oracle/oracle.ts | Validation gate | P0 | |
| lib/oracle/confidence-scorer.ts | Confidence scoring | P0 | |
| lib/oracle/cross-run-validator.ts | Cross-run checks | P1 | |
| lib/oracle/tripwire-registry.ts | Tripwires | P1 | |
| lib/agents/types/*.ts | Shared Zod types | P0 | |
| lib/agents/dhruv.ts | Committee chair | P0 | Refactor if >800 lines |
| lib/agents/vikram.ts | Goal interviewer | P0 | |
| lib/agents/riya.ts | Behavioral profiler | P0 | |
| lib/agents/soma.ts | Fund universe | P0 | |
| lib/agents/soma-data-checker.ts | Freshness checker | P0 | |
| lib/agents/kiran.ts | Risk map | P0 | |
| lib/agents/aria.ts | Critique | P0 | |
| lib/agents/priya.ts | Draft builder | P0 | |
| lib/agents/priya-backtest.ts | Backtester | P0 | |
| lib/agents/sebi.ts | Compliance | P0 | |
| lib/agents/atlas.ts | Comparison | P1 | |
| lib/agents/mentor.ts | Meta-learning | P1 | |
| lib/agents/prompts/*.ts | Versioned prompts | P0 | Educational framing |
| lib/pdf/portfolio-rationale-generator.ts | PDF generation | P1 | |
| lib/cas/drift-detector.ts | Drift detection | P2 | |
| lib/sip/sip-tracker.ts | SIP tracking | P2 | |
| lib/jobs/definitions.ts | Inngest event schemas | P0 | Add pipeline events |
| lib/jobs/handlers/pipeline/start.ts | Pipeline Inngest function | P0 | |
| app/api/inngest/route.ts | Inngest serve | P0 | Register pipeline functions |
| app/api/cas/ingest/route.ts | CAS ingest trigger | P0 | Send pipeline.start |
| app/api/pipeline/start/route.ts | Start pipeline REST | P0 | |
| app/api/pipeline/[runId]/status/route.ts | Status REST | P0 | |
| app/api/pipeline/[runId]/result/route.ts | Result REST | P0 | |
| app/api/pipeline/[runId]/deliberation/route.ts | Deliberation REST | P0 | |
| app/api/pipeline/[runId]/comparison/route.ts | Comparison REST | P1 | |
| app/api/pipeline/[runId]/pdf/route.ts | PDF REST | P1 | |
| app/api/portfolio/drift/route.ts | Drift REST | P2 | |
| tests/unit/* | Unit tests | P0 | |
| tests/integration/pipeline-inngest.test.ts | Inngest integration | P0 | |
| tests/integration/pipeline-api.test.ts | API integration | P0 | |
| tests/e2e/pipeline-happy-path.spec.ts | E2E simulation flow | P1 | Rewrite existing |

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Old prompts contain advisory language | High | High | Regex scan + rewrite in Prompt 12 |
| Backtest data incomplete | High | Medium | Category proxies + disclosure |
| DHRUV class too large | Medium | Medium | Refactor into sub-modules in Prompt 8 |
| REST polling latency for long runs | Medium | Low | Status endpoint is cheap; consider SSE push later |
| SQLite audit trail not durable | High | High | Migrate to PostgreSQL in Prompts 2-3 |
| Pipeline failure affects chat | Low | High | Isolate pipeline; failures logged, chat unaffected |
| Cross-user data leakage | Low | High | RLS + auth checks on every route/tool |

## 12. Acceptance Criteria for This Document

- [x] Scope defined as educational simulation.
- [x] Inngest event schema documented.
- [x] REST API surface documented.
- [x] PostgreSQL audit trail migration justified.
- [x] Data fallback strategy documented.
- [x] RLS and auth boundaries documented.
- [x] File inventory with priorities included.
- [x] Risk register included.

## 13. Next Step

Proceed to Prompt 2: Database Schema & Migration Restoration.
