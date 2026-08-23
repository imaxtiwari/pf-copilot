# PF Copilot — Architecture Decision: Chat-First Tool-Calling

> Decision owner: Systems Architect + Product Strategist  
> Date: 2026-08-23  
> Commit baseline: `c425c7b3d953c210a121fb6e8b00fc8c9f168cbb`

---

## 1. Decision

**Adopt Option A — Consolidate on chat-first tool-calling.**

PF Copilot will ship as a single-model, tool-calling chat assistant with an analyst-style workspace UI. The Dhruv multi-agent recommendation pipeline, its scheduler, memory store, web-research tool, SQLite audit trail, and associated API routes will be removed from the main branch and archived in a feature branch (`feature/dhruv-pipeline`).

The chat path already works end-to-end (`lib/orchestrator.ts`, `app/api/chat/route.ts`, `app/chat/page.tsx`). The pipeline does not have backing schema, required npm dependencies, or a viable runtime environment on Vercel serverless. Shipping both in parallel is the highest-risk path identified in `docs/ARCHITECTURAL_REVIEW_PRODUCTION_ROADMAP.md` and `docs/BASELINE_AUDIT.md`.

---

## 2. Rationale

### 2.1 Evidence from baseline audit

| Signal | Chat path | Dhruv pipeline |
|--------|-----------|----------------|
| Builds cleanly | ✅ yes (no import errors) | ❌ no — 41 Turbopack errors |
| Schema exists | ✅ `chatMessages`, `portfolioHoldings`, etc. | ❌ 16 tables missing |
| Dependencies installed | ✅ all in `package.json` | ❌ `@qdrant/js-client-rest`, `@tavily/core`, `better-sqlite3`, `node-cron` missing |
| Runtime viability | ✅ synchronous request/response within Vercel limits | ❌ background `.catch()` phase transitions unreliable on serverless |
| Test coverage | ✅ 318 unit tests pass | ❌ 28 test files fail due to missing schema/deps |
| No-advice enforcement | ✅ RAG validation + refusal reasons wired | ⚠️ partially designed but never exercised end-to-end |

### 2.2 Product rationale

- **Time-to-production:** Option A removes the critical blockers (missing schema, broken build, missing deps) within days rather than months.
- **User value today:** The chat surface already delivers portfolio Q&A, fund explanations, real-return analysis, and stock research with citations. These are concrete, SEBI-compliant, non-advisory features.
- **Differentiation can come later:** The Dhruv committee concept is a genuine differentiator, but only if it is fully implemented with a job queue, real schema, and independent agent evals. A half-implemented pipeline undermines trust.
- **Regulatory clarity:** The chat path’s no-advice guardrails (`lib/rag/validate-response.ts`, `lib/contracts/no-advice.ts`, refusal reasons) are easier to explain to compliance reviewers than a complex deliberation system with no audit log.

---

## 3. Trade-off Analysis

### 3.1 Option A vs Option B

| Dimension | Option A — Chat-first tool-calling | Option B — Full Dhruv pipeline |
|-----------|------------------------------------|--------------------------------|
| **Correctness** | High. Single model, deterministic tool loop, observable traces. | Medium. Distributed state, committee votes, convergence checks — high chance of subtle bugs. |
| **Time-to-production** | 1–2 weeks to harden and deploy. | 3–6 months to implement schema, job queue, evals, and UI. |
| **Maintainability** | High. Fewer moving parts; `lib/orchestrator.ts` is ~400 lines. | Low. ~1,600-line Dhruv class, 16 new tables, scheduler, memory, audit subsystems. |
| **Differentiation** | Low today (many AI copilots exist). | High if executed well (investment committee narrative). |
| **Risk** | Low operational risk; main risk is feature parity. | High risk of never shipping; schema drift and runtime crashes already block the build. |
| **Cost controls** | Easier to add per-turn token budgets and rate limits. | Harder; must budget across many agent calls and deliberation loops. |
| **Observability** | Single trace per chat turn. | Complex trace across agents, memory, votes, drafts. |
| **SEBI compliance** | Simpler to audit and disclaim. | More complex; every agent output needs guardrails and logging. |

### 3.2 Drizzle ORM vs raw SQL migrations for missing tables

Because Option A removes the tables rather than implementing them, this trade-off applies only if the project later revives Option B from the archive branch.

| Approach | Pros | Cons |
|----------|------|------|
| **Drizzle ORM (`db/schema.ts` + `drizzle-kit generate`)** | Type-safe schema; single source of truth; generates migrations and snapshots; aligns with existing tables. | Some pgvector/HNSW options still need raw SQL supplements. |
| **Raw SQL migrations only** | Full control over indexes, constraints, pgvector syntax. | No TypeScript types; easy to drift from code; harder to maintain. |

**Recommendation:** use Drizzle ORM for all new tables and add raw SQL only where Drizzle cannot express the DDL (e.g. HNSW vector indexes with `m`/`ef_construction`). This matches the current pattern in `db/migrate.ts`.

---

## 4. Rollback Plan

If the chat-first product fails to gain traction or the team later needs the committee narrative:

1. **Retrieve the archive:** check out `feature/dhruv-pipeline` (created during Option A execution).
2. **Re-implement schema:** add the 16 tables in `db/schema.ts` using Drizzle ORM, generate migrations, and reconcile duplicate migration filenames.
3. **Add missing dependencies:** `@qdrant/js-client-rest`, `@tavily/core`, `better-sqlite3`, `node-cron` (or replace SQLite audit with Postgres audit logs).
4. **Move to a job queue:** replace the `.catch()` background call in `app/api/pipeline/start/route.ts` with Inngest, Trigger.dev, or BullMQ.
5. **Gradual re-integration:** expose the pipeline as an optional, asynchronous recommendation report that the chat surface can query, rather than making it the primary architecture.

---

## 5. File-by-File Impact List

### 5.1 Files and directories to delete (move to `feature/dhruv-pipeline`)

| Path | Reason |
|------|--------|
| `app/api/pipeline/` | All pipeline API routes depend on Dhruv/schema that no longer exists. |
| `app/api/scheduler/route.ts` | Scheduler triggers the Dhruv pipeline. |
| `app/api/audit/route.ts` | SQLite audit trail is only used by pipeline agents. |
| `app/pipeline/` | UI pages for pipeline status/results/deliberation. |
| `lib/agents/dhruv.ts` | Central pipeline orchestrator; broken syntax at line 999. |
| `lib/agents/mentor.ts` | Reads `committeeVotes`, `deliberationMessages`, `pipelineResults`. |
| `lib/agents/riya.ts` | Behavioral profiling; references `behavioralFingerprints`, `driftReports`. |
| `lib/agents/soma.ts` | Fund universe agent; references `agentFunds`, `fundSnapshots`, `fundCompositions`. |
| `lib/agents/kiran.ts` | Hedge-map agent; references `agentFunds`, `fundSnapshots`. |
| `lib/agents/vikram.ts` | Strategy/goal agent; references `agentFunds`, `pipelineResults`. |
| `lib/agents/priya.ts` | Portfolio builder; references `portfolioDrafts`. |
| `lib/agents/priya-backtest.ts` | Backtest engine; references `agentFunds`, `fundSnapshots`. |
| `lib/agents/atlas.ts` | Comparison agent; references `comparisonReports`. |
| `lib/agents/sebi.ts` | Compliance agent; references `complianceReports`. |
| `lib/agents/aria.ts` | Critique agent used only inside Dhruv committee. |
| `lib/agents/types/` | Types used only by Dhruv agents. |
| `lib/pipeline/pipeline-state-machine.ts` | References `pipelineRuns` and `portfolioDrafts`. |
| `lib/scheduler/` | `agent-scheduler.ts` and `mutex.ts` reference `schedulerLocks`, `schedulerRuns`. |
| `lib/memory/` | Qdrant memory store used only by pipeline agents. |
| `lib/research/web-research-tool.ts` | Tavily research used only by pipeline agents. |
| `lib/deliberation/deliberation-room.ts` | PostgreSQL-backed deliberation; references `deliberationMessages`. |
| `lib/audit/audit-trail.ts` | SQLite audit trail used by pipeline agents. |
| `lib/oracle/cross-run-validator.ts` | Cross-run consistency; references `pipelineResults`. |
| `lib/pdf/portfolio-rationale-generator.ts` | PDF generation for pipeline results. |
| `lib/sip/sip-tracker.ts` | SIP adherence reports; references `sipAdherenceReports`. |
| `lib/cas/drift-detector.ts` | Plan drift; references `pipelineResults` and `driftReports`. |
| `lib/tools/get-recommendation-packet.ts` | Tool exposing pipeline results to chat. |
| `lib/tools/get-sip-status.ts` | Tool exposing SIP adherence to chat. |
| `tests/unit/aria-*.test.ts` | Tests for deleted agents. |
| `tests/unit/committee-vote.test.ts` | Tests for deleted committee vote logic. |
| `tests/unit/vote-matrix.test.ts` | Tests for deleted vote logic. |
| `tests/unit/deliberation-threading.test.ts` | Tests for deleted deliberation room. |
| `tests/unit/pipeline-idempotency.test.ts` | Tests for deleted pipeline. |
| `tests/unit/mentor.test.ts` | Tests for deleted agent. |
| `tests/unit/riya.test.ts` | Tests for deleted agent. |
| `tests/unit/soma*.test.ts` / `kiran*.test.ts` / `vikram*.test.ts` / `priya*.test.ts` / `atlas*.test.ts` / `sebi*.test.ts` | Tests for deleted agents. |
| `tests/unit/backtest.test.ts` | Tests for deleted backtest engine. |
| `tests/unit/cross-run-validator.test.ts` | Tests for deleted oracle validator. |
| `tests/unit/drift-detector.test.ts` | Tests for deleted drift detector. |
| `tests/unit/pdf-generator.test.ts` | Tests for deleted PDF generator. |
| `tests/unit/recommendation-packet-tool.test.ts` | Tests for deleted tool. |
| `tests/unit/scheduler-mutex.test.ts` | Tests for deleted scheduler. |
| `tests/unit/sip-tracker.test.ts` | Tests for deleted SIP tracker. |
| `tests/unit/token-budget-context.test.ts` | Tests for deleted context-budget helper. |
| `tests/unit/audit-trail.test.ts` | Tests for deleted SQLite audit trail. |
| `tests/unit/memory-*.test.ts` | Tests for deleted memory store. |
| `scripts/run-niti-gupta*.ts` | E2E scripts for deleted pipeline. |
| `scripts/run-rohan-mehta-e2e.ts` | E2E script for deleted pipeline. |
| `scripts/seed-agent-fund-db.ts` | Seeds deleted `agentFunds` table. |
| `scripts/ingest-historical-nav.ts` | Seeds deleted `fundSnapshots` table. |
| `scripts/smoke-test-step13.ts` | Smoke test for deleted compliance report. |
| `scripts/read-latest-deliberations.ts` | Reads deleted deliberation table. |

### 5.2 Files to modify

| Path | Change |
|------|--------|
| `lib/orchestrator.ts` | Keep as core chat engine. Add per-turn token/cost budget (future). No structural change. |
| `lib/agent-mapping.ts` | Keep as presentation layer. Optionally rename agent labels to “reasoning steps” in UI copy to reduce architectural theater. |
| `lib/tools/definitions.ts` | Remove tool definitions for `get_recommendation_packet` and `get_sip_status`. |
| `app/layout.tsx` | Remove scheduler self-trigger call if present. |
| `app/page.tsx` / nav components | Remove links to pipeline pages. |
| `db/schema.ts` | No new pipeline tables. Existing tables remain. |
| `db/migrations/` | Do not add pipeline migrations. Reconcile duplicate filenames as cleanup. |
| `vitest.config.ts` | Remove deleted files from coverage/include if referenced. |
| `package.json` | Remove unused scripts (`eval`, `eval:setup` if tied only to pipeline). Do not add deleted deps. |
| `next.config.js` | No changes unless pipeline-specific rewrites exist. |

### 5.3 Files to create

| Path | Purpose |
|------|---------|
| `docs/ARCHITECTURE_DECISION.md` | This document. |
| `docs/BASELINE_AUDIT.md` | Already created; references this decision. |
| `feature/dhruv-pipeline` branch | Archive of all deleted code before removal. |

---

## 6. Missing Schema Tables — Accounted For

The following tables are referenced by Dhruv, Mentor, and the pipeline state machine but do not exist in `db/schema.ts`. Under Option A they are intentionally not implemented; the code that references them is removed.

| Table | Referenced by | Disposition |
|-------|---------------|-------------|
| `pipelineRuns` | `dhruv.ts`, `pipeline-state-machine.ts`, all `app/api/pipeline/*` routes | Delete with pipeline |
| `pipelineResults` | `dhruv.ts`, `mentor.ts`, `vikram.ts`, `cross-run-validator.ts`, `pdf-generator.ts`, `get-recommendation-packet.ts` | Delete with pipeline |
| `committeeVotes` | `dhruv.ts`, `mentor.ts`, `vote-matrix.test.ts` | Delete with pipeline |
| `deliberationMessages` | `mentor.ts`, `deliberation-room.ts`, `deliberation-threading.test.ts` | Delete with pipeline |
| `portfolioDrafts` | `dhruv.ts`, `priya.ts`, `pipeline-state-machine.ts`, `drift-detector.test.ts` | Delete with pipeline |
| `fundSnapshots` | `dhruv.ts`, `kiran.ts`, `priya.ts`, `riya.ts`, `soma.ts`, `vikram.ts`, `priya-backtest.ts`, `ingest-historical-nav.ts`, `backtest.test.ts` | Delete with pipeline |
| `complianceReports` | `sebi.ts`, `smoke-test-step13.ts` | Delete with pipeline |
| `agentFunds` | `dhruv.ts`, `kiran.ts`, `priya.ts`, `riya.ts`, `soma.ts`, `vikram.ts`, `seed-agent-fund-db.ts` | Delete with pipeline |
| `comparisonReports` | `atlas.ts`, `app/api/pipeline/[runId]/comparison/route.ts` | Delete with pipeline |
| `schedulerLocks` | `lib/scheduler/mutex.ts`, `scheduler-mutex.test.ts` | Delete with scheduler |
| `schedulerRuns` | `lib/scheduler/mutex.ts` | Delete with scheduler |
| `behavioralFingerprints` | `dhruv.ts`, `kiran.ts`, `riya.ts` | Delete with pipeline |
| `sipAdherenceReports` | `lib/sip/sip-tracker.ts`, `sip-tracker.test.ts` | Delete with SIP tracker |
| `driftReports` | `lib/cas/drift-detector.ts`, `app/api/portfolio/drift/route.ts`, `riya.ts` | Delete with drift detector |
| `fundCompositions` | `soma.ts` | Delete with pipeline |

If Option B is revived, all 16 tables must be added to `db/schema.ts` via Drizzle ORM and a single coherent migration chain.

---

## 7. Migration-Chain Duplication

`db/migrations/` currently contains duplicate filenames:

- `0000_kind_hammerhead.sql` and `0000_productive_krista_starr.sql`
- `0001_chunky_dust.sql` and `0001_pgvector.sql`
- `0004_portfolio_insights.sql` and `0004_chilly_eternity.sql`
- `0005_chat_audit.sql` and `0005_slimy_norrin_radd.sql`
- `0006_demat_tables.sql` and `0006_simple_trish_tilby.sql`
- `0007_embedding_dimensions.sql` and `0007_tan_wasp.sql`

Only one of each pair is tracked in `meta/_journal.json`. Under Option A, the cleanup action is:

1. Identify which file of each pair is referenced by `meta/_journal.json`.
2. Delete the untracked duplicate.
3. Run `drizzle-kit generate` and `drizzle-kit push` for any future schema changes.
4. Add a CI check that fails if `drizzle-kit generate --dry` produces diffs.

---

## 8. Execution Checklist

- [ ] Create `feature/dhruv-pipeline` branch from current `main` and push to remote.
- [ ] Delete all files listed in §5.1.
- [ ] Modify files listed in §5.2.
- [ ] Remove unused pipeline-specific npm dependencies (none were installed, so no removal needed).
- [ ] Fix `lib/agents/dhruv.ts:999` syntax error by deleting the file.
- [ ] Reconcile duplicate migration filenames.
- [ ] Run `npx tsc --noEmit` until it passes.
- [ ] Run `npm test -- --run` and verify remaining chat/portfolio tests pass.
- [ ] Run `npm run build` and verify it succeeds.
- [ ] Add `eslint.config.js` and restore lint command.
- [ ] Update `README.md` to describe the chat-first architecture.

---

## 9. Conclusion

**Ship Option A.** It is the only path that unblocks production within weeks, eliminates the broken pipeline surface, and preserves the working chat experience. The Dhruv committee vision is valuable but must be rebuilt from a clean feature branch with real schema, a job queue, and independent evals before it can be trusted by users or regulators.
