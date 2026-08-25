# Implementation Plan: Restore DHRUV Educational Simulation Pipeline + MCP Server

## Overview

Restore the deleted multi-agent portfolio committee pipeline as an **educational simulation** that runs asynchronously after CAS upload, and expose it to the Stitch frontend via an MCP server. The pipeline will not give investment advice; all outputs will be clearly labeled as simulations with SEBI disclaimers. The audit trail will be migrated from SQLite to PostgreSQL for production-grade durability.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Purpose | Educational simulation only, not investment advice |
| Trigger | Background job after successful CAS upload |
| Runtime | Inngest async with `/api/pipeline/[runId]/status` polling |
| Audit trail | Migrate from SQLite (`lib/audit/audit-trail.ts`) to PostgreSQL `pipeline_audit_logs` |
| Frontend integration | MCP server (SSE) + REST API |
| Agents restored | DHRUV, ARIA, KIRAN, VIKRAM, SOMA, PRIYA, RIYA, ATLAS, SEBI, MENTOR, ORACLE |

## Execution Sequence

This plan is delivered as 12 self-contained SOP prompts. Each prompt assumes the previous ones are complete and CI-green.

### Prompt 1: Discovery, Scope & Architecture Decision
- **Role:** Staff Software Engineer + Systems Architect + Security Reviewer + API/Product Strategist
- **Deliverable:** `docs/PIPELINE_ARCHITECTURE_DECISION.md`
- **Summary:** Inspect codebase, inventory deleted files, decide Inngest event schema, define MCP tools/resources/prompts, document security boundaries and educational framing rules.

### Prompt 2: Database Schema & Migration Restoration
- **Role:** Staff Software Engineer + Database Architect + Security Reviewer
- **Deliverables:** Updated `db/schema.ts`, `db/migrations/0005_restore_pipeline_schema.sql`, RLS policies, audit-log immutability triggers
- **Summary:** Restore all pipeline tables, migrate audit trail to PostgreSQL, enable RLS, verify migration applies cleanly.

### Prompt 3: Core Infrastructure Layer
- **Role:** Staff Software Engineer + Systems Architect + QA Engineer
- **Deliverables:** `lib/deliberation/*`, `lib/pipeline/*`, `lib/scheduler/*`, `lib/memory/*`, migrated `lib/audit/audit-trail.ts`, unit tests
- **Summary:** Restore deliberation room, state machine, scheduler mutex, memory store, and PostgreSQL-based audit trail.

### Prompt 4: Agent Types & Shared Schemas
- **Role:** Staff Software Engineer + TypeScript Architect + QA Engineer
- **Deliverables:** `lib/agents/types/*`, `tests/unit/agent-types.test.ts`
- **Summary:** Restore all Zod schemas; replace advisory verdicts with neutral educational language.

### Prompt 5: Research & Data Infrastructure Agents
- **Role:** Staff Software Engineer + Prompt Engineer + QA Engineer
- **Deliverables:** `lib/research/*`, `lib/agents/soma*.ts`, unit tests
- **Summary:** Restore web research tool, knowledge commons, SOMA fund universe, and data freshness checker.

### Prompt 6: Specialist Agents Part 1 — Risk, Portfolio Construction & Backtesting
- **Role:** Staff Software Engineer + Prompt Engineer + QA Engineer
- **Deliverables:** `lib/agents/kiran.ts`, `lib/agents/priya.ts`, `lib/agents/priya-backtest.ts`, unit tests
- **Summary:** Restore KIRAN risk map, PRIYA draft builder, and backtest agent with educational framing.

### Prompt 7: Specialist Agents Part 2 — Profiling, Interview & Critique
- **Role:** Staff Software Engineer + Prompt Engineer + QA Engineer
- **Deliverables:** `lib/agents/vikram.ts`, `lib/agents/riya.ts`, `lib/agents/aria.ts`, unit tests
- **Summary:** Restore VIKRAM interviewer, RIYA behavioral profiler, and ARIA critique agent.

### Prompt 8: Coordinator, Comparison, Compliance & Meta-Agents
- **Role:** Staff Software Engineer + Systems Architect + Prompt Engineer + QA Engineer
- **Deliverables:** `lib/agents/dhruv.ts`, `lib/agents/atlas.ts`, `lib/agents/sebi.ts`, `lib/agents/mentor.ts`, `lib/oracle/*`, tests
- **Summary:** Restore DHRUV coordinator, ATLAS comparison, SEBI compliance, MENTOR learning, and ORACLE validation gate.

### Prompt 9: Inngest Functions & CAS Trigger
- **Role:** Staff Software Engineer + Systems Architect + Security Reviewer
- **Deliverables:** `lib/jobs/handlers/pipeline/*`, updated `app/api/inngest/route.ts`, updated `app/api/cas/ingest/route.ts`, integration tests
- **Summary:** Wire pipeline as Inngest background job triggered automatically after CAS upload.

### Prompt 10: Pipeline REST API Routes
- **Role:** Staff Software Engineer + API Architect + Security Reviewer
- **Deliverables:** `app/api/pipeline/*`, `app/api/portfolio/drift/route.ts`, integration tests
- **Summary:** Restore pipeline REST endpoints with auth, RLS, validation, rate limiting, and disclaimers.

### Prompt 11: Frontend REST Integration & Polling
- **Role:** Staff Software Engineer + Frontend Engineer + API Security Reviewer
- **Deliverables:** React hooks/components polling `GET /api/pipeline/{runId}/status`, fetching `GET /api/pipeline/{runId}/result`, displaying simulation packets with disclaimers.
- **Summary:** Wire the educational-simulation UI to the REST pipeline surface; no MCP server.

### Prompt 12: Educational Framing, Security Hardening, Observability & Final CI
- **Role:** Staff Software Engineer + Security Reviewer + SRE + Prompt Engineer + QA Engineer
- **Deliverables:** Updated docs, security review, observability, green CI
- **Summary:** Remove advisory language, add logging/metrics, run full CI (`tsc`, `lint`, `test:coverage`, `build`), update runbooks.

## Dependencies

- Existing: `inngest`, `drizzle-orm`, `pg`, `zod`, `openai`, `pino`, `@supabase/supabase-js`, `@upstash/redis`
- Optional: `@tavily/core` for web research (fallback stub if unavailable)

## Files Already Present (Survived Deletion)

These can be reused/updated rather than restored from git:
- `lib/validation/portfolio-draft.ts`
- `lib/prompts/aria-preflight.ts`
- `lib/prompts/atlas-comparison.ts`
- `lib/prompts/riya-behavioral.ts`
- `lib/prompts/sebi-compliance.ts`
- `lib/prompts/vikram-hypothesis.ts`
- `lib/audit/audit-trail.ts` (SQLite — must migrate to PostgreSQL)
- `tests/unit/audit-trail.test.ts`
- `tests/unit/portfolio-draft-validator.test.ts`
- `tests/e2e/pipeline-happy-path.spec.ts` (must be rewritten for educational simulation)

## Testing Strategy

- Unit tests for every restored module
- Integration tests for Inngest and API routes
- Updated E2E test for pipeline happy path
- Full CI: `npx tsc --noEmit`, `npm run lint`, `npm run test:coverage -- --run`, `npm run build`

## Risks

- Old pipeline was advisory; all prompts/outputs must be rewritten for educational framing.
- Backtesting depends on historical NAV data that may be incomplete; fallback strategy required.
- MCP server adds authentication/transport complexity.
- Pipeline is large; refactoring DHRUV monolith is essential.

## Next Step

Run Prompt 1 and produce `docs/PIPELINE_ARCHITECTURE_DECISION.md` for review before proceeding.
