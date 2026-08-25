# Pipeline Restoration Plan

## Decision record

| Question | Decision |
|----------|----------|
| Purpose | **Educational simulation only.** The pipeline demonstrates how an investment committee might reason about a portfolio. It is explicitly **not** investment advice. |
| Scope | Restore **all** agents: DHRUV, ARIA, KIRAN, VIKRAM, SOMA, PRIYA, RIYA, ATLAS, SEBI, MENTOR, ORACLE. |
| Entry point | Background job triggered automatically after a successful CAS upload (`app/api/cas/ingest/route.ts`). |
| Runtime | Asynchronous via **Inngest** with `/api/pipeline/[runId]/status` polling. |
| Historical data | Backtesting will use available AMFI NAV history + factsheet-derived category/regime assumptions. Where long-dated fund-level history is missing, the simulation will disclose the limitation instead of blocking. |
| No-advice framing | All agent prompts, committee votes, and final packet outputs rewritten as educational/simulation language with prominent disclaimers. |
| Integration | Pipeline is a **separate system** from chat. Chat may later expose a read-only summary tool, but the pipeline does not depend on chat. |
| Frontend | The user has a separate Stitch UI/MCP frontend. This codebase exposes REST + Inngest endpoints for that frontend to consume. |

## Educational framing rules

1. The final output is a **"simulation packet"**, not a recommendation.
2. Committee votes are labeled **"simulated committee opinion"**.
3. Portfolio drafts are labeled **"hypothetical allocation for educational discussion"**.
4. Verdicts use neutral language: `"ALIGNS_WITH_GOALS"`, `"NEEDS_DISCUSSION"`, `"OUT_OF_SCOPE"` instead of `ACHIEVABLE`/`REVISED`/`IMPOSSIBLE`.
5. Every UI screen and PDF page includes:
   > "This is an educational simulation. It is not investment advice. Please consult a SEBI-registered investment advisor before acting."

## Phase map

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Decision docs + CLAUDE.md update | In progress |
| 1 | Restore DB schema + migration | |
| 2 | Restore core infrastructure | |
| 3 | Restore all agents with educational framing | |
| 4 | Restore API routes | |
| 5 | Wire Inngest functions + CAS trigger | |
| 6 | Tests + observability + guardrails | |
| 7 | Final CI + handoff docs | |

## Data sources for historical NAV / backtesting

- **AMFI daily NAV files** are already synced by `scripts/sync-amfi-master.ts`.
- **Fund factsheet chunks** are already stored in `factsheetChunks` with embeddings.
- For multi-year backtests where scheme-level history is missing, PRIYA will:
  1. Use available NAV snapshots from `fund_snapshots`.
  2. Fall back to category-level proxy returns derived from AMFI category averages.
  3. Flag any proxy usage in the simulation output.
- `agent_funds` table stores the curated universe of funds the committee can consider.
- `fund_snapshots` table stores point-in-time NAV snapshots for data freshness checks.

## Async runtime model

1. `app/api/cas/ingest/route.ts` calls `inngest.send({ name: 'pipeline.start', data: { userId, uploadId } })` after holdings are persisted.
2. Inngest function `pipeline/start.ts` creates a `pipeline_runs` row and steps through stages.
3. Each stage is an Inngest step with `ctx.step.run('name', fn)` for automatic retry.
4. Status is polled via `GET /api/pipeline/[runId]/status`.
5. Result is fetched via `GET /api/pipeline/[runId]/result`.
