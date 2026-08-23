# PF Copilot — Baseline Audit

> Immutable baseline captured before any production code changes.
> Created: 2026-08-23
> Commit: `c425c7b3d953c210a121fb6e8b00fc8c9f168cbb`

---

## 1. Environment & Dependency State

### 1.1 `npm install`

```bash
npm install
```

**Result:** completed with warnings.

- `up to date, audited 515 packages in 11s`
- Peer dependency warnings: `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react` expect ESLint `^9.x` but project pins `eslint@10.4.0`.
- `10 vulnerabilities (4 moderate, 6 high)` — not blocking the baseline but must be tracked.

### 1.2 Node / Package Manager

- npm (bundled with Node) used successfully.
- No lockfile changes during install.

---

## 2. Type Checking

### 2.1 Command

```bash
npx tsc --noEmit
```

**Result:** ❌ FAILED — 2 errors, 1 file.

```text
lib/agents/dhruv.ts:999:30 - error TS1005: ',' expected.

999     const { deriveARIAVote } from './aria'
                                 ~~~~

lib/agents/dhruv.ts:999:35 - error TS1005: ',' expected.

999     const { deriveARIAVote } from './aria'
                                      ~~~~~~~~

Found 2 errors in the same file, starting at: lib/agents/dhruv.ts:999
```

### 2.2 Interpretation

Line 999 of `lib/agents/dhruv.ts` uses an invalid import syntax inside a function body (`const { ... } from '...'` instead of `import { ... } from '...'` or a dynamic `import()`). This is a parse error that blocks TypeScript, Next.js build, and any tooling that parses the file.

---

## 3. Lint

### 3.1 `npm run lint`

```bash
npm run lint
```

**Result:** ❌ FAILED.

```text
Invalid project directory provided, no such directory: /Users/anshtiwari/Financial Co-pilot/pf-copilot/lint
```

`next lint` appears to be misinterpreting the space in the working directory path (`Financial Co-pilot`).

### 3.2 Direct ESLint invocation

```bash
npx eslint . --max-warnings=100
```

**Result:** ❌ FAILED — no ESLint config file.

```text
ESLint: 10.4.0
ESLint couldn't find an eslint.config.(js|mjs|cjs) file.
From ESLint v9.0.0, the default configuration file is now eslint.config.js.
```

### 3.3 Interpretation

The project has `eslint@10` (flat-config era) and `eslint-config-next@16` installed, but no `eslint.config.*` file exists. Lint is not currently runnable. This is a baseline blocker for CI.

---

## 4. Unit Tests

### 4.1 Command

```bash
npm test -- --run
```

**Result:** ❌ FAILED — 28 test files failed, 21 passed.

```text
 Test Files  28 failed | 21 passed (49)
      Tests  42 failed | 318 passed (360)
   Start at  14:59:18
   Duration  18.59s (transform 5.32s, setup 17.73s, import 22.58s, tests 5.37s, environment 42.42s)
```

### 4.2 Failed test files

| File | Failure driver |
|------|----------------|
| `tests/unit/audit-trail.test.ts` | `better-sqlite3` dependency missing / SQLite audit module not loadable |
| `tests/unit/validate-rag-response.test.ts` | Validation logic rejects valid inputs (citation, Hinglish, multi-fund coverage, numeric claim detection) |
| `tests/unit/drift-detector.test.ts` | Missing `pipelineResults` / `portfolioDrafts` schema |
| `tests/unit/cross-run-validator.test.ts` | Missing `pipelineResults` schema |
| `tests/unit/backtest.test.ts` | Missing `fundSnapshots` schema; undefined fund lookups |
| `tests/unit/aria-critical-block.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/aria-critique.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/aria-vote-matrix.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/confidence-score.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/memory-key-scoping.test.ts` | `@qdrant/js-client-rest` dependency missing |
| `tests/unit/memory-ttl.test.ts` | `@qdrant/js-client-rest` dependency missing |
| `tests/unit/mentor.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/vikram-achievability.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/vikram-hypothesis.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/vikram-interview.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/committee-vote.test.ts` | Missing `committeeVotes` / pipeline schema |
| `tests/unit/smoke-test-step13.test.ts` | Missing `complianceReports` / pipeline schema |
| `tests/unit/vote-matrix.test.ts` | Missing `committeeVotes` / pipeline schema |
| `tests/unit/deliberation-threading.test.ts` | Missing `deliberationMessages` / pipeline schema |
| `tests/unit/pipeline-idempotency.test.ts` | Missing `pipelineRuns` / pipeline schema |
| `tests/unit/riya.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/atlas.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/pdf-generator.test.ts` | Missing `pipelineResults` / schema |
| `tests/unit/recommendation-packet-tool.test.ts` | Missing `pipelineResults` / schema |
| `tests/unit/scheduler-mutex.test.ts` | Missing `schedulerLocks` / `schedulerRuns` schema |
| `tests/unit/sebi.test.ts` | Pipeline agent import / schema issues |
| `tests/unit/sip-tracker.test.ts` | Missing `sipAdherenceReports` / schema |
| `tests/unit/token-budget-context.test.ts` | Token budget context mismatch |

### 4.3 DB-dependent test workaround

No local PostgreSQL/pgvector instance is running. DB-dependent tests fail at module-import time due to missing schema tables (`pipelineRuns`, `fundSnapshots`, etc.) rather than connection errors. The current test setup does not mock the Drizzle client for these modules, so the failures are deterministic import/schema failures, not flaky network failures.

---

## 5. E2E Tests

### 5.1 Command

```bash
npm run test:e2e
```

**Result:** Not executed.

**Reason:** E2E tests require:

1. A running Next.js dev server (`npm run dev`).
2. A reachable PostgreSQL + pgvector database with the schema applied.
3. Azure OpenAI credentials (live LLM calls).
4. The golden/synthetic CAS PDF fixture.

None of these were available in the baseline run environment. The `happy-path.spec.ts` already skips when the fixture is missing (`test.skip(!casFileExists, ...)`), so running E2E would not add meaningful signal without standing up the full local stack.

**Recommendation for later run:** use `playwright test` against a Dockerized Postgres + pgvector with seeded AMFI master and a synthetic CAS fixture. Avoid live Azure OpenAI by mocking the chat/completion endpoints.

---

## 6. Build

### 6.1 Command

```bash
npm run build
```

**Result:** ❌ FAILED — 41 Turbopack errors.

### 6.2 Primary build errors

| # | Error | Location | Impact |
|---|-------|----------|--------|
| 1 | `const { deriveARIAVote } from './aria'` parse error | `lib/agents/dhruv.ts:999` | Blocks scheduler route and all pipeline routes |
| 2 | Module not found: `@qdrant/js-client-rest` | `lib/memory/memory-store.ts:1` | Memory store unusable |
| 3 | Module not found: `@tavily/core` | `lib/research/web-research-tool.ts:1` | Web research tool unusable |
| 4 | Module not found: `better-sqlite3` | `lib/audit/audit-trail.ts:1` | SQLite audit trail unusable |
| 5 | Module not found: `node-cron` | `lib/scheduler/agent-scheduler.ts:1` | Scheduler unusable |
| 6 | Missing export `portfolioDrafts` | `lib/agents/priya.ts` import of `db/schema` | Pipeline PDF/status routes fail |
| 7 | Missing exports `schedulerLocks`, `schedulerRuns` | `lib/scheduler/mutex.ts` import of `db/schema` | Scheduler route fails |
| 8+ | Missing schema exports (`pipelineRuns`, `pipelineResults`, `committeeVotes`, etc.) | Multiple pipeline/agent files | Pipeline runtime crashes |

### 6.3 Root cause summary

The build fails because the recommendation-pipeline / scheduler / memory / audit subsystems reference code and dependencies that are either:

- syntactically broken (`dhruv.ts:999`),
- not installed (`@qdrant/js-client-rest`, `@tavily/core`, `better-sqlite3`, `node-cron`), or
- reference PostgreSQL tables that do not exist in `db/schema.ts`.

---

## 7. Schema Drift Analysis

### 7.1 Tables defined in `db/schema.ts`

1. `users`
2. `userProfile`
3. `casUploads`
4. `portfolioHoldings`
5. `portfolioSnapshots`
6. `chatMessages`
7. `factsheetChunks`
8. `amfiSchemeMaster`
9. `portfolioInsights`
10. `dematHoldings`
11. `stockDocuments`

### 7.2 Tables referenced in code but missing from `db/schema.ts`

| Missing table | Files referencing it |
|---------------|----------------------|
| `pipelineRuns` | `app/api/pipeline/[runId]/*/route.ts`, `app/api/pipeline/start/route.ts`, `lib/agents/dhruv.ts`, `lib/agents/kiran.ts`, `lib/agents/priya.ts`, `lib/agents/riya.ts`, `lib/agents/soma.ts`, `lib/agents/vikram.ts`, `lib/oracle/cross-run-validator.ts`, `lib/pipeline/pipeline-state-machine.ts`, `lib/tools/get-recommendation-packet.ts`, `scripts/run-niti-gupta*.ts`, `scripts/run-rohan-mehta-e2e.ts`, `tests/unit/pipeline-idempotency.test.ts` |
| `pipelineResults` | `app/api/pipeline/[runId]/result/route.ts`, `lib/agents/dhruv.ts`, `lib/agents/mentor.ts`, `lib/cas/drift-detector.ts`, `lib/oracle/cross-run-validator.ts`, `lib/pdf/portfolio-rationale-generator.ts`, `lib/tools/get-recommendation-packet.ts`, `scripts/run-niti-gupta*.ts`, `tests/unit/cross-run-validator.test.ts`, `tests/unit/drift-detector.test.ts`, `tests/unit/pdf-generator.test.ts`, `tests/unit/recommendation-packet-tool.test.ts` |
| `committeeVotes` | `lib/agents/dhruv.ts`, `lib/agents/mentor.ts`, `tests/unit/committee-vote.test.ts`, `tests/unit/vote-matrix.test.ts` |
| `deliberationMessages` | `app/api/pipeline/[runId]/deliberation/route.ts`, `lib/deliberation/deliberation-room.ts`, `tests/unit/deliberation-threading.test.ts` |
| `portfolioDrafts` | `app/api/pipeline/[runId]/comparison/route.ts`, `lib/agents/dhruv.ts`, `lib/agents/priya.ts`, `lib/pipeline/pipeline-state-machine.ts`, `tests/unit/drift-detector.test.ts` |
| `fundSnapshots` | `lib/agents/dhruv.ts`, `lib/agents/kiran.ts`, `lib/agents/priya-backtest.ts`, `lib/agents/priya.ts`, `lib/agents/riya.ts`, `lib/agents/soma.ts`, `lib/agents/vikram.ts`, `scripts/ingest-historical-nav.ts`, `scripts/seed-agent-fund-db.ts`, `tests/unit/backtest.test.ts` |
| `complianceReports` | `scripts/smoke-test-step13.ts`, `tests/unit/smoke-test-step13.test.ts` |
| `agentFunds` | `lib/agents/dhruv.ts`, `lib/agents/kiran.ts`, `lib/agents/priya.ts`, `lib/agents/riya.ts`, `lib/agents/soma.ts`, `lib/agents/vikram.ts`, `scripts/seed-agent-fund-db.ts` |
| `comparisonReports` | `app/api/pipeline/[runId]/comparison/route.ts`, `lib/agents/atlas.ts` |
| `schedulerLocks` | `lib/scheduler/mutex.ts`, `tests/unit/scheduler-mutex.test.ts` |
| `schedulerRuns` | `lib/scheduler/mutex.ts` |
| `behavioralFingerprints` | `lib/agents/dhruv.ts`, `lib/agents/kiran.ts` |
| `sipAdherenceReports` | `lib/sip/sip-tracker.ts`, `tests/unit/sip-tracker.test.ts` |
| `driftReports` | `app/api/portfolio/drift/route.ts`, `lib/cas/drift-detector.ts` |
| `fundCompositions` | `lib/agents/kiran.ts` |

### 7.3 Migrations folder hygiene

The `db/migrations/` directory contains duplicate/conflicting filenames (e.g. `0000_kind_hammerhead.sql` and `0000_productive_krista_starr.sql`, `0001_chunky_dust.sql` and `0001_pgvector.sql`). Only one of each pair is tracked in `meta/_journal.json`, creating risk that a future developer applies the wrong file or that CI drift-checks fail.

---

## 8. API Routes & Auth Patterns

### 8.1 Routes list

```text
app/api/audit/route.ts
app/api/cas/confirm/route.ts
app/api/cas/ingest/route.ts
app/api/cas/review-session/route.ts
app/api/chat/audit/chunk/route.ts
app/api/chat/audit/route.ts
app/api/chat/route.ts
app/api/chat/stream/route.ts
app/api/demat/ingest/route.ts
app/api/health/route.ts
app/api/macro-bulletin/route.ts
app/api/me/route.ts
app/api/onboarding/route.ts
app/api/pipeline/[runId]/comparison/route.ts
app/api/pipeline/[runId]/deliberation/route.ts
app/api/pipeline/[runId]/interview/route.ts
app/api/pipeline/[runId]/life-event/route.ts
app/api/pipeline/[runId]/pdf/route.ts
app/api/pipeline/[runId]/result/route.ts
app/api/pipeline/[runId]/status/route.ts
app/api/pipeline/[runId]/trajectory/route.ts
app/api/pipeline/start/route.ts
app/api/portfolio/allocation/route.ts
app/api/portfolio/drift/route.ts
app/api/portfolio/equity/route.ts
app/api/portfolio/holdings/route.ts
app/api/portfolio/insights/route.ts
app/api/portfolio/timeline/route.ts
app/api/scheduler/route.ts
```

### 8.2 Authentication pattern

Every route uses `resolveOrCreateUserId()` from `lib/auth/dev-user.ts`. This helper:

1. Reads a 1-year `httpOnly` cookie named `pf_user_id`.
2. If the cookie exists, returns that UUID as `userId`.
3. If the cookie does not exist, inserts an empty row into `users` and sets the cookie.

There is no password, OTP, OAuth, session expiry, or Row-Level Security. Knowing/guessing a UUID grants full access to that user's data.

### 8.3 Authorization pattern

- Portfolio and chat routes trust the cookie-derived `userId` without explicit resource ownership checks.
- Pipeline routes check `run.clientId !== userId` (e.g. `app/api/pipeline/[runId]/result/route.ts`).
- Because the auth itself is a placeholder, ownership checks are currently defense-in-depth only.

### 8.4 Error-envelope usage

- `lib/contracts/error-envelope.ts` defines `ok<T>(data)`, `err(code, message, details?, requestId?)`, and `ApiResponse<T>`.
- Routes that use it: `portfolio/allocation`, `portfolio/drift`, `portfolio/equity`, `chat/audit`, `chat/audit/chunk`, `macro-bulletin`, `audit`, `cas/review-session`.
- Routes that return ad-hoc `{ error, code }` shapes: most `pipeline/[runId]/*` routes.
- Routes that return raw `NextResponse.json(...)` with inline error objects: `cas/ingest`, `cas/confirm`, `demat/ingest`, `chat`, `chat/stream`, `onboarding`, `portfolio/holdings`, `portfolio/insights`, `portfolio/timeline`.

---

## 9. Secrets in `.env.local`

The following keys are present in `.env.local`. Values are intentionally omitted from this audit.

| Key | Must rotate? | Notes |
|-----|--------------|-------|
| `AZURE_OPENAI_API_KEY` | ✅ YES | Live Azure OpenAI key committed to repo |
| `DATABASE_URL` | ✅ YES | Contains Supabase Postgres password |
| `VERCEL_OIDC_TOKEN` | ✅ YES | JWT bearer token for Vercel OIDC |
| `AZURE_OPENAI_ENDPOINT` | ⚠️ no need alone | Endpoint is not a secret by itself, but rotate with key |
| `AZURE_OPENAI_API_VERSION` | no | Public API version string |
| `AZURE_OPENAI_DEPLOYMENT_GPT4O` | no | Deployment name |
| `AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI` | no | Deployment name |
| `AZURE_OPENAI_DEPLOYMENT_EMBEDDING` | no | Deployment name |
| `AMFI_NAV_URL` | no | Public URL |
| `LOG_LEVEL` | no | Observability config |

`.env.local` is currently tracked by Git. It must be added to `.gitignore`, removed from the index, and the secrets above must be rotated. Git history should be purged with BFG Repo-Cleaner or `git filter-repo`.

---

## 10. Risk Heat Map

| Risk | Severity | Evidence | Mitigation priority |
|------|----------|----------|---------------------|
| Secrets committed to Git | **Critical** | `.env.local` tracked, contains API key + DB password + OIDC token | Rotate + purge history + add to `.gitignore` immediately |
| Build broken (parse error + missing schema) | **Critical** | `lib/agents/dhruv.ts:999`, 41 Turbopack errors | Fix syntax; add missing tables or remove dead pipeline code |
| No real authentication/authorization | **Critical** | `lib/auth/dev-user.ts` mints 1-year UUID cookies | Replace with real auth + RLS before any user data |
| Missing pipeline/scheduler/memory schema | **Critical** | 16 tables referenced but not defined in `db/schema.ts` | Decide architecture; delete or implement schema |
| Missing production dependencies | **High** | `@qdrant/js-client-rest`, `@tavily/core`, `better-sqlite3`, `node-cron` not in `package.json` | Add deps or remove dependent code |
| Health check calls live LLM | **High** | `app/api/health/route.ts:28-39` | Replace with DB connectivity check |
| No rate limiting / cost controls | **High** | No `rate limit`, `throttle`, `token budget` in repo | Add per-user/IP rate limits and per-turn token budget |
| Background pipeline on Vercel serverless | **High** | `app/api/pipeline/start/route.ts:91-93` uses `.catch()` | Move to job queue (Inngest/Trigger.dev/BullMQ) |
| Inconsistent error envelopes | **Medium** | Pipeline routes use ad-hoc `{ error, code }` | Standardize on `error-envelope.ts` |
| Lint not runnable | **Medium** | No `eslint.config.*` file | Add flat ESLint config |
| E2E tests conditional on local fixture | **Medium** | `tests/e2e/happy-path.spec.ts` skips without CAS PDF | Commit synthetic fixture and run in CI |
| Schema drift in migrations folder | **Medium** | Duplicate migration filenames | Rename/reconcile migration files |
| Embedding dimension mismatch | **Medium** | `factsheetChunks` uses 3072d, memory store assumes 1536d | Align or document separate vector stores |
| Type-check and build blocked by single syntax error | **Low-hanging** | `dhruv.ts:999` | One-line fix unblocks many downstream checks |

---

## 11. Determinism Check

The four baseline commands were run once each. Their outputs are deterministic given the current repository state:

| Command | Output hash / summary | Stable? |
|---------|-----------------------|---------|
| `npx tsc --noEmit` | 2 errors in `lib/agents/dhruv.ts:999` | Yes |
| `npm run lint` | `Invalid project directory .../lint` | Yes (but path-dependent) |
| `npx eslint . --max-warnings=100` | Missing `eslint.config.*` | Yes |
| `npm test -- --run` | 42 failed / 318 passed | Yes |
| `npm run build` | 41 Turbopack errors | Yes |

**Note:** Re-running the same commands without code changes will produce identical results. The lint command's failure is partially due to the workspace path containing a space; this should be fixed by adding a proper `eslint.config.js` and invoking ESLint directly.

---

## 12. Verdict: Is the Codebase Safe to Modify?

**No — blockers exist.**

The codebase is **not safe to modify in its current state** for production-facing work because:

1. **Build is broken.** A single syntax error in `lib/agents/dhruv.ts` plus missing schema exports prevent `npm run build` from completing.
2. **Secrets are committed.** `.env.local` is tracked and contains live credentials that must be rotated immediately.
3. **Auth is a placeholder.** There is no real authentication or RLS; any change to user-scoped routes must be made with this risk in mind.
4. **Dead pipeline code is entangled.** The Dhruv recommendation pipeline and its scheduler/memory/audit dependencies are imported by live API routes but lack backing schema and dependencies. This will cause runtime crashes if any pipeline endpoint is hit.

### Recommended first steps before feature work

1. **Stop the bleeding:** rotate all secrets, purge Git history, add `.env.local` to `.gitignore`.
2. **Unblock the build:** fix `lib/agents/dhruv.ts:999` syntax error.
3. **Decide on the pipeline:** either (a) delete/move all pipeline/scheduler/memory/audit code that lacks schema to a feature branch, or (b) add the missing 16 tables and missing npm dependencies.
4. **Restore tooling:** add `eslint.config.js`, fix or replace `next lint` invocation, and configure CI to run `tsc --noEmit`, lint, unit tests, and build.
5. **Address health check:** remove the LLM call from `/api/health`.

Once the build passes and secrets are rotated, the RAG/chat/portfolio surfaces can be modified safely.

---

## 13. Appendix — Exact Commands Summary

```bash
# Dependencies
npm install

# Type check
npx tsc --noEmit

# Lint (currently broken)
npm run lint
npx eslint . --max-warnings=100

# Unit tests
npm test -- --run

# E2E tests (skipped — see §5)
npm run test:e2e

# Build
npm run build

# Schema references scan
grep -R "schema\.[a-zA-Z_]+" --include="*.ts" --include="*.tsx" lib app scripts tests | grep -oE "schema\.[a-zA-Z_]+" | sort | uniq -c | sort -rn
```
