# PF Copilot — Deep Architectural Review & Production Roadmap

> **Scope:** Production-grade review of the PF Copilot codebase. This document identifies architectural flaws, dead/orphaned code, security gaps, operational risks, and concrete remediation steps. It is meant to be read alongside the code; every major finding references specific files and lines.

---

## Executive Summary

PF Copilot has an ambitious vision: a multi-agent portfolio intelligence system for Indian retail investors with strict no-advice guardrails. The chat surface is built around a single-model tool-calling loop (`lib/orchestrator.ts`) that fakes a multi-agent UI via `lib/agent-mapping.ts`, while a separate, much larger multi-agent recommendation pipeline (`lib/agents/dhruv.ts`, `lib/pipeline/pipeline-state-machine.ts`, etc.) exists in a half-implemented state with no backing PostgreSQL schema. This architectural schizophrenia is the central risk. Several other issues block production:

- **Secrets are committed to Git** (`.env.local`).
- **No real authentication / authorization** — a year-long cookie mints UUID users on first visit.
- **No rate limiting, no cost controls, no request timeouts** on LLM calls beyond Next.js defaults.
- **Health check calls live LLMs** on every probe (`app/api/health/route.ts`).
- **Background work on Vercel** is unreliable (phase-1 pipeline fired with `.catch()` from an API route).
- **Database has schema drift** — many agent tables are referenced but never defined in `db/schema.ts`.
- **Tests are sparse** and coverage is configured for only a handful of files.

The good news: the RAG/citation pipeline, the no-advice validator, the CAS/Demat parsing pipeline, and the portfolio analytics pages are coherent and well-scoped. They only need hardening, not rewriting.

---

## 1. The Central Architectural Problem: Two Competing Systems in One Repo

### 1.1 The Chat Surface — “Multi-Agent” Theater

**Files:** `lib/orchestrator.ts`, `lib/agent-mapping.ts`, `app/api/chat/stream/route.ts`, `components/ai-workspace-shell.tsx`, `components/agent-activity-panel.tsx`

What the UI sells as a committee of analysts is actually a single `gpt-4o-mini` (configured as `gpt-4.1-mini`) completion call with tool definitions. `lib/orchestrator.ts` runs a loop of up to `MAX_TOOL_ITERATIONS = 5` calls. Tool results are then converted into fake agent activity states in `lib/agent-mapping.ts` (`mapToolTraceToAgentStates`).

**Why this matters:**
- It is not wrong per se — OpenAI tool-calling is a valid architecture — but the codebase *documents* and *tests* a multi-agent deliberation system. This mismatch will confuse future engineers, investors, and auditors.
- The agent names in the UI are derived from `TOOL_TO_AGENT`, not from independent agents. There is no real deliberation, no committee vote, no critique loop in the chat path.

**Production recommendation:**
- Decide the public narrative. If the chat is a single-model tool loop, rename the UI from “AI team / analysts” to “Copilot reasoning steps” and stop implying independent agents.
- If you want real multi-agent deliberation in chat, move it to an explicit coordinator that delegates to small, task-specific LLM calls (e.g., a routing agent, a retrieval agent, a critique agent) with an audit trail. The current `agent-mapping.ts` layer is pure presentation and should not be confused with architecture.

### 1.2 The Recommendation Pipeline — A Skyscraper Built on Missing Foundations

**Files:** `lib/agents/dhruv.ts`, `lib/agents/mentor.ts`, `lib/pipeline/pipeline-state-machine.ts`, plus many files under `lib/agents/`

`lib/agents/dhruv.ts` is a ~1,100-line class that implements DHRUV, the investment committee chair. It instantiates Riya, Kiran, Vikram, Aria, Soma, Priya, Sebi, Atlas, and Mentor, drives a state machine, records committee votes, persists deliberation messages, and compiles final portfolio packets.

The problem: almost none of the tables it depends on exist in `db/schema.ts`:

| Referenced table | Defined in `db/schema.ts`? | Where referenced |
|---|---|---|
| `pipelineRuns` | ❌ | `dhruv.ts` passim, API routes under `app/api/pipeline/` |
| `pipelineResults` | ❌ | `dhruv.ts`, `mentor.ts`, API routes |
| `committeeVotes` | ❌ | `dhruv.ts`, `mentor.ts` |
| `deliberationMessages` | ❌ | `lib/deliberation/deliberation-room.ts` |
| `portfolioDrafts` | ❌ | `dhruv.ts`, `pipeline-state-machine.ts` |
| `fundSnapshots` | ❌ | many agent files |
| `complianceReports` | ❌ | `scripts/smoke-test-step13.ts` |

**Evidence:** run `grep -R "schema\.pipelineRuns\|schema\.committeeVotes\|schema\.deliberationMessages\|schema\.pipelineResults\|schema\.portfolioDrafts\|schema\.fundSnapshots" lib app scripts tests` and compare with `db/schema.ts`. The agent layer assumes these tables exist, but only `users`, `userProfile`, `casUploads`, `portfolioHoldings`, `portfolioSnapshots`, `chatMessages`, `factsheetChunks`, `amfiSchemeMaster`, `portfolioInsights`, `dematHoldings`, and `stockDocuments` are defined.

**Impact:**
- The production build will crash at runtime the first time any pipeline API is exercised.
- The elaborate agent orchestration is effectively dead code today.
- Multiple scripts (`scripts/run-niti-gupta.ts`, `scripts/run-rohan-mehta-e2e.ts`, `scratch/query-db-comprehensive.ts`) reference this phantom schema and cannot run against the current database.

**Production recommendation:**
- Either **finish the schema** and wire the pipeline end-to-end, or **delete/move** the dead pipeline code to a branch. Shipping both is the worst of both worlds.
- If keeping it, add a migration that defines `pipeline_runs`, `pipeline_results`, `committee_votes`, `deliberation_messages`, `portfolio_drafts`, `fund_snapshots`, `compliance_reports`, and any other tables the agents reference.
- Remove `any`-typed `db` injection (`this.db: any` in `dhruv.ts`, `mentor.ts`, etc.). Use a properly typed Drizzle client.

---

## 2. Security & Compliance

### 2.1 Secrets Committed to Git

**File:** `.env.local`

`AZURE_OPENAI_API_KEY`, `DATABASE_URL` (with password), and `VERCEL_OIDC_TOKEN` are committed. Even if you later `git rm`, the keys remain in Git history.

**Production actions:**
1. Rotate **every** exposed credential immediately.
2. Add `.env.local` to `.gitignore` and run `git filter-repo` (or BFG Repo-Cleaner) to purge secrets from history.
3. Move secrets to Vercel environment variables or a secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault).
4. Add a CI check (e.g., `gitleaks` or `trufflehog`) to block future commits.

### 2.2 Authentication Is a Placeholder

**File:** `lib/auth/dev-user.ts`

```ts
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year
export async function resolveOrCreateUserId(): Promise<DevUserResult> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value
  if (existing) return { userId: existing, isNew: false }
  const [user] = await db.insert(users).values({}).returning({ id: users.id })
  return { userId: user.id, isNew: true }
}
```

- No password, no OTP, no OAuth, no session expiry.
- Knowing a UUID gives full access to that user’s portfolio, CAS, chat history, and pipeline results.
- Cookie is `httpOnly` and `secure` in production, but `SameSite=lax` and valid for a year.

**Production actions:**
- Replace with a real auth provider: **Supabase Auth**, **NextAuth.js / Auth.js**, or **Clerk**. Indian fintech use cases especially need mobile-OTP login.
- Add Row-Level Security (RLS) policies in Postgres so a user can only read their own `portfolioHoldings`, `chatMessages`, `casUploads`, etc. Currently every query trusts the UUID from the cookie.
- Add CSRF protection for non-GET chat/pipeline endpoints.

### 2.3 No Authorization Beyond Ownership

**File:** `app/api/pipeline/[runId]/result/route.ts` checks `run.clientId !== userId`, but most other routes do not verify resource ownership explicitly. Example: `/api/chat/audit` and `/api/audit` trust the cookie. Because there is no real auth, this is currently impossible to enforce properly; adding real auth is a prerequisite.

### 2.4 SEBI / No-Advice Guardrails Are Good But Need Enforcement

**Files:** `lib/contracts/no-advice.ts`, `lib/rag/validate-response.ts`, prompts under `lib/prompts/`

The forbidden-word list and the no-advice system prompt are well designed. However:
- There is no **server-side classifier** that runs *before* the response is streamed to the user. A jailbreak or prompt injection could bypass the system prompt.
- The validation in `validateRagResponse` only covers RAG tool outputs, not the final orchestrator synthesis.
- There is no human escalation path for borderline requests.

**Production actions:**
- Add a second-pass safety model (`gpt-4o-mini` is enough) that classifies every outgoing message into `safe / borderline / advice`. Persist the classification in `chatMessages`.
- Add a `safety_score` column and alert on borderline messages.
- Keep a human-in-the-loop review queue for messages flagged as potential advice.

---

## 3. Operational Reliability

### 3.1 Health Check Calls Live LLMs

**File:** `app/api/health/route.ts` (lines 28–39)

```ts
const client = getGpt4oMini()
const response = await client.chat.completions.create({
  model: deployment,
  messages: [{ role: 'user', content: 'respond with OK' }],
  max_tokens: 10,
})
```

A Kubernetes/Vercel health probe will invoke the LLM every few seconds, burning tokens and creating a cold-start dependency. If Azure OpenAI is slow, the app is marked unhealthy.

**Fix:** Health checks should test DB connectivity and a cheap embedding or a cached vector. Move LLM health to a separate `/api/health/deep` route called manually.

### 3.2 No Rate Limiting or Cost Controls

Search the repo for `rate limit`, `throttle`, `token budget`, or `max cost`: there is none.

**Risks:**
- A single user can upload a 10 MB PDF repeatedly (`MAX_BYTES = 10 MB` is only size, not rate).
- Chat has no per-user message cap. The tool loop can call GPT-4o (RAG tools) up to 5 times per turn.
- Embedding ingestion has a 200 ms delay but no concurrency or daily cap.
- Azure OpenAI has TPM/rate limits; the app will 429 and show generic errors.

**Production actions:**
- Add Redis-backed rate limiting per user/IP: e.g., 20 chat messages/minute, 5 CAS uploads/hour, 100 pipeline status checks/minute.
- Add a per-turn token/cost budget in `runOrchestratorWithOptions`. Abort if the cumulative `completion.usage` exceeds a threshold.
- Track monthly LLM spend per user in `users` table; cap free-tier users.

### 3.3 Background Work on Vercel Serverless

**File:** `app/api/pipeline/start/route.ts` lines 91–93

```ts
dhruv.runPhase1(runId, userId, clientData).catch((err) => {
  logger.error({ err, runId }, 'API-START: Background runPhase1 failed')
})
```

Vercel serverless functions may be frozen shortly after the response is sent. A multi-minute LLM deliberation pipeline cannot reliably run here. `runPhase1` may be killed mid-flight, leaving the pipeline in an inconsistent DB state.

**Production actions:**
- Move long-running pipelines to a job queue: **Inngest**, **Trigger.dev**, **BullMQ on Redis**, or a separate worker service.
- API routes should only enqueue jobs and return `pipeline_run_id` + status.
- Store per-run state in Postgres and make every stage idempotent (so retries are safe).

### 3.4 Error Handling Is Inconsistent

- `lib/orchestrator.ts` catches validation errors and logs them but still passes empty args to tools (`parsedArgs = {}` on schema failure).
- Some routes return `ok/err` envelopes; others return ad-hoc `{ error, code }` objects.
- `app/layout.tsx` calls `fetch('http://localhost:.../api/scheduler')` during render, which can throw in serverless environments where `localhost` is meaningless.

**Production actions:**
- Standardize on a single error envelope (`lib/contracts/error-envelope.ts`) everywhere.
- Do not swallow tool-arg validation errors silently; return a structured error to the model.
- Remove the scheduler self-trigger from `layout.tsx`; use a real cron job or Vercel Cron.

---

## 4. Data Layer

### 4.1 Schema Drift & Missing Tables

As noted in §1.2, the agent pipeline references many tables not present in `db/schema.ts`.

Additional issues:
- `db/migrate.ts` runs raw SQL for pgvector/HNSW indexes. This is fine, but the migration folder has duplicate/confusing names (`0000_kind_hammerhead.sql` and `0000_productive_krista_starr.sql`, `0001_chunky_dust.sql` and `0001_pgvector.sql`). Only one of each pair is tracked in `meta/_journal.json` likely, but the duplicates create risk.
- `factsheet_chunks.embedding` is `vector(3072)` (text-embedding-3-large), while `lib/memory/memory-store.ts` creates Qdrant collections with `vectors: { size: 1536 }`. This mismatch suggests the agent memory was written for `text-embedding-3-small` or OpenAI Ada-002, while the factsheet RAG uses the large model.

**Production actions:**
- Align embedding dimensions everywhere, or separate the two vector stores clearly. Document which model/dimensions each store uses.
- Add a single source-of-truth schema for all agent tables.
- Run `drizzle-kit generate` and `drizzle-kit push` from CI on every schema change.

### 4.2 No Data Freshness Tracking

`portfolioSnapshots`, `factsheetChunks`, and `stockDocuments` store dates, but there is no freshness cron, alerting, or automatic invalidation. The `portfolio/page.tsx` shows “Latest real return” but if factsheets are stale, the user is not warned.

**Production actions:**
- Add `last_synced_at`, `freshness_days`, and `is_stale` flags to data tables.
- Run nightly ingestion jobs (AMFI NAV, factsheets, annual reports) via Vercel Cron or a worker.
- Surface data age in the UI (“factsheet data as of 2025-08-15”).

### 4.3 `as_of_date` Fallback Hides Bad Inputs

**File:** `lib/cas/parse-text.ts` lines 23–27

```ts
const extractedDate = extractDate(text)
if (!extractedDate) {
  logger.warn({ preview: text.slice(0, 200) }, 'cas: extractDate returned null — using today as fallback')
}
const as_of_date = extractedDate ?? new Date().toISOString().slice(0, 10)
```

Good: it now logs a warning (`TODOS.md` item). Bad: it still silently stamps today’s date, which corrupts XIRR, snapshots, and insights.

**Fix:** Reject CAS uploads where date extraction fails, and route the user to a manual review screen with the raw PDF.

---

## 5. RAG & LLM Layer

### 5.1 RAG Pipeline Is Solid but Brittle

**Files:** `lib/rag/explain-fund.ts`, `lib/rag/compare-funds.ts`, `lib/rag/validate-response.ts`, `lib/factsheets/embed.ts`

Strengths:
- Citation validation ensures chunk IDs exist in retrieved chunks.
- Forbidden-word checks block advice language in RAG outputs.
- One-retry loop on validation failure.
- Hinglish translation preserves citations.

Risks:
- `validateRagResponse` rejects numeric claims without `[chunk_…]` citations, but the regex is simplistic (`split(/(?<=[.!?\n])\s+/)`). It can miss parenthetical citations or multi-sentence claims.
- Two failed validation attempts return a `contract_violation` refusal. This is good for safety but may frustrate users if common false positives exist.
- Stock RAG (`lib/rag/retrieval-stock.ts`) filters by `isin` then orders by vector distance. If a company has dozens of annual-report chunks, the top-k may all come from one document section, hurting diversity.

**Production actions:**
- Add a re-ranking step (cross-encoder or LLM judge) and `mmr` (maximal marginal relevance) for diversity.
- Add a small eval harness that runs `ORCHESTRATOR_CASES` against real data and measures citation precision/recall.
- Add retrieval latency/quality metrics per query.

### 5.2 Prompts Are Hard-Coded, Not Versioned

**Files:** `lib/prompts/*.ts`

Prompts are TypeScript string constants. There is no A/B test framework, no prompt registry, and no version metadata stored with chat messages.

**Production actions:**
- Move prompts to a registry (LangSmith, Promptlayer, or a simple `prompts` table with version, model, and hash).
- Store `prompt_version` in `chatMessages` and pipeline artifacts so outputs are reproducible.

### 5.3 No Observability Into LLM Calls

`lib/orchestrator.ts` logs iterations and elapsed time. `lib/rag/...` logs duration and tokens. But there is no centralized trace tying a user request → tool calls → LLM calls → citations. Debugging a bad answer requires grepping logs.

**Production actions:**
- Add OpenTelemetry / LangSmith / Langfuse tracing with `request_id` as the trace ID.
- Export metrics: p50/p95 latency per tool, token usage per user, refusal rate, citation violation rate.

---

## 6. Frontend & UX

### 6.1 Client-Side Language Detection May Race

**File:** `app/chat/page.tsx` lines 228–233

```ts
useEffect(() => {
  if (input.trim().length > 0) {
    const detected = detectDevanagari(input) ? 'hi-en' : 'en'
    if (detected !== language) setLanguage(detected)
  }
}, [input, language])
```

The language state can flip while the user is typing; if they submit just after typing a Hindi word, the request may go out in English or Hinglish inconsistently.

**Fix:** Detect language once at send time, not on every keystroke. Pass the detected language explicitly to the API.

### 6.2 No Streaming Error Recovery

**File:** `app/chat/page.tsx` lines 295–305

If the SSE stream errors, the UI appends a fallback assistant message. It does not retry or allow the user to resend the same message easily.

**Fix:** Add a retry button and preserve the failed user message in input.

### 6.3 Mobile UX Has a Persistent Bottom Sheet

**File:** `components/ai-workspace-shell.tsx` lines 39–43

The agent panel is rendered as a fixed bottom sheet on mobile even when collapsed. This may block viewport content.

**Fix:** Add a collapsed state for mobile and a drag handle.

---

## 7. Testing

### 7.1 Coverage Is Narrow

**File:** `vitest.config.ts`

```ts
coverage: {
  include: [
    'lib/inflation/**',
    'lib/cas/parse-text-helpers.ts',
    'lib/contracts/cas-validation.ts',
    'lib/tools/arg-schemas.ts',
  ],
  thresholds: { lines: 100, branches: 100 },
}
```

Only inflation, CAS helpers, and arg schemas are required to be covered. The orchestrator, RAG, database routes, and agent pipeline have almost no unit coverage.

### 7.2 E2E Tests Are Conditional

**File:** `tests/e2e/happy-path.spec.ts`

The happy-path suite `test.skip(!casFileExists, ...)` if the golden CAS PDF is missing. This makes CI green even when the most important test is not running.

**Production actions:**
- Commit a small, synthetic CAS fixture to the repo (no real PII) and run the E2E tests in CI.
- Expand unit tests to cover `lib/orchestrator.ts`, `lib/rag/validate-response.ts`, and API routes.
- Add integration tests against a Dockerized Postgres + pgvector.

---

## 8. Phased Production Roadmap

### Phase 0 — Stop the Bleeding (1–2 weeks)
1. **Rotate all secrets** in `.env.local` and purge history with BFG/gitleaks.
2. **Add `.env.local` to `.gitignore`** and a CI secret-scanning job.
3. **Replace the LLM health check** in `app/api/health/route.ts`.
4. **Fix schema drift**: either delete dead agent pipeline code or add missing tables.
5. **Add rate limiting** to chat, upload, and pipeline endpoints (Vercel Edge Config or Upstash Redis).

### Phase 1 — Make the Codebase Coherent (2–4 weeks)
1. **Pick one architecture:**
   - *Option A (recommended for speed):* Keep chat as a tool-calling loop. Rename UI “agents” to “reasoning steps.” Move the Dhruv pipeline to a feature branch until it is schema-complete.
   - *Option B (recommended for differentiation):* Fully implement the multi-agent pipeline with real schema, job queue, and UI.
2. **Standardize error envelopes** across all API routes.
3. **Add typed DB client** everywhere; remove `this.db: any`.
4. **Add request/cost budgets** to the orchestrator.

### Phase 2 — Productionize Infrastructure (4–6 weeks)
1. **Real auth:** Supabase Auth / Auth.js with OTP/OAuth.
2. **RLS policies** in Postgres for all user-scoped tables.
3. **Move long-running pipelines** to Inngest/Trigger.dev/BullMQ workers.
4. **Nightly data jobs** for AMFI NAV, factsheets, annual reports.
5. **Vector store alignment:** decide on 1536 vs 3072 dims and document.
6. **Observability:** OpenTelemetry/Langfuse, alerts on p95 latency, cost per user, refusal rate.

### Phase 3 — Harden & Differentiate (ongoing)
1. **Safety classifier** for every outgoing chat message.
2. **Human review queue** for borderline advice.
3. **RAG re-ranking, MMR, and eval harness** (citation precision/recall).
4. **Prompt registry** with versioning.
5. **Expanded tests:** unit + integration + E2E in CI.
6. **Compliance documentation** for SEBI (IA) Regulations 2013 — clearly label the product as non-advisory, record disclaimers, and keep audit logs.

---

## 9. Quick-Win Checklist

| # | Action | File(s) | Effort |
|---|---|---|---|
| 1 | Rotate secrets, purge Git history, add `.env.local` to `.gitignore` | repo-level | hours |
| 2 | Remove LLM call from health check | `app/api/health/route.ts` | minutes |
| 3 | Add Upstash/Vercel rate limiting middleware | `app/api/chat/*`, `app/api/cas/*`, `app/api/pipeline/*` | hours |
| 4 | Add per-turn token/cost budget | `lib/orchestrator.ts` | hours |
| 5 | Reject CAS uploads with unparseable dates | `lib/cas/parse-text.ts` | minutes |
| 6 | Standardize all API responses on `error-envelope.ts` | `app/api/**/*.ts` | day |
| 7 | Remove scheduler self-trigger from layout | `app/layout.tsx` | minutes |
| 8 | Add synthetic CAS fixture and unskip E2E | `tests/eval/golden-cas/` | day |
| 9 | Delete or branch the Dhruv pipeline if schema is missing | `lib/agents/dhruv.ts`, etc. | day |
| 10 | Add RLS policies once auth is real | `db/migrations/*.sql` | day |

---

## 10. Conclusion

PF Copilot’s strongest assets are its domain focus (Indian mutual funds, no-advice compliance), the RAG citation pipeline, and the CAS/Demat ingestion UX. Its biggest liabilities are the split-personality architecture, the dead multi-agent pipeline, the absence of auth/rate limits, and operational shortcuts that will break under real load.

The fastest path to production-grade quality is:
1. Stop shipping secrets and unbounded endpoints.
2. Resolve the schema/architecture mismatch decisively.
3. Add real auth, RLS, and job-queue infrastructure.
4. Then invest in observability, evals, and compliance documentation.

This document can be used as a sprint backlog. Each numbered item maps to specific files and acceptance criteria.
