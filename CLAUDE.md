# CLAUDE.md — Personal Finance Copilot

## What this is
An educational tool for Indian retail investors. Shows real returns (nominal minus personal inflation), explains mutual fund factsheets with strict citations from official AMFI factsheets, and parses NSDL/CDSL CAS PDFs. It does NOT give investment advice.

## Hard constraints (NEVER violate)
1. **LLM provider: Azure OpenAI ONLY.** Do not add Google Gemini, Anthropic, OpenAI direct, or any other provider.
2. **No advice language EVER.** The assistant never says "buy", "sell", "invest in", "should", "recommend", "best fund", "good fund", "bad fund", "top pick" in any output. See `/lib/contracts/no-advice.ts`.
3. **Strict-RAG for fund explainer.** The `explain_fund` tool must refuse-on-no-grounding. Every numeric claim must cite a chunk ID. One retry on contract violation, then refuse. See `/lib/rag/explain-fund.ts` and `/lib/prompts/explain-fund.ts`.
4. **CAS validation gate is non-negotiable.** Partial-write of holdings is forbidden. All-or-nothing per upload. See `/lib/contracts/cas-validation.ts`.
5. **Deployment mode v1: localhost-only.** No public URL, no auth, no rate limiting. Single user. Cloud + auth deferred to v2.
6. **CAS PDF buffers are memory-only.** Never persist the raw PDF to disk or blob. Free buffer after extraction completes.
7. **Advisory Committee Rule**: Votes require a 2/3 majority (2/3 of ARIA, KIRAN, VIKRAM) **AND** 0 CRITICAL compliance faults from ARIA **AND** `overall_hedge_coverage_pct >= 80` to approve. A single CRITICAL fault from ARIA is an automatic rejection. Max 5 revision cycles before deadlock.

## Stack lockdown
- Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- PostgreSQL 16 + pgvector (local Docker for v1)
- Drizzle ORM 0.45+
- Azure OpenAI SDK (`openai` package, `AzureOpenAI` class) — GPT-4o, GPT-4o-mini, text-embedding-3-small
- pdf-parse v2 (text extraction primary), pdf2pic (vision fallback)
- vitest (unit + eval tests), playwright (e2e)
- pino (structured logging)
- zod (runtime validation — including `ToolArgSchemas` in `/lib/tools/arg-schemas.ts`)
- node-cron (for background agent scheduler tasks)

## File structure conventions
- `/lib/contracts/` — invariants enforced across the codebase (`no-advice.ts`, `cas-validation.ts`, `error-envelope.ts`, `refusal-types.ts`)
- `/lib/prompts/` — system prompts, versioned (every prompt exports `{ version, text, changelog }`)
- `/lib/inflation/` — pure deterministic inflation engine (no I/O, fully unit-tested)
  - `compute.ts` — sleeve model, confidence levels
  - `real-returns.ts` — Fisher equation with `inflation ≤ −1` guard
  - `parse-return.ts` — extracts 1Y return from factsheet text (handles `%` and bare-number formats)
- `/lib/cas/` — CAS PDF parsing (`parse-text.ts`, `parse-vision.ts`, `amfi-master.ts`, `parse.ts`)
- `/lib/rag/` — factsheet retrieval + strict-RAG agent (`retrieval.ts`, `explain-fund.ts`, `validate-response.ts`)
- `/lib/tools/` — orchestrator tool definitions, handlers, and Zod arg schemas
  - `arg-schemas.ts` — `ToolArgSchemas` with `z.coerce.string()` for scheme codes (handles LLM returning numbers)
- `/lib/agents/` — agent definitions (DHRUV, KIRAN, SOMA, ARIA, VIKRAM, PRIYA) and their respective type interfaces
- `/lib/pipeline/` — state machine orchestrator for sequential multi-agent stages
- `/lib/scheduler/` — cron registration of background macro scans/checks
- `/lib/deliberation/` — deliberation room where agents discuss the client portfolio draft
- `/lib/memory/` — agent Memory Store (stores observations in Qdrant or uses MockQdrantClient under test)
- `/lib/orchestrator.ts` — GPT-4o-mini tool-call loop (≤5 iterations, module-level client singleton)
- `/lib/logger.ts` — structured logger (pino)
- `/lib/db.ts` — Drizzle pool; throws at startup if `DATABASE_URL` is missing
- `/db/schema.ts` — Drizzle schema (**read-only — don't add columns without explicit user direction**)
- `/app/api/` — all routes return `ApiResponse<T>` from `/lib/contracts/error-envelope.ts`; all DB calls wrapped in try/catch
- `/tests/mocks/` — testing mock helpers (such as `azure-openai.mock.ts`)
- `/tests/unit/` — unit tests for pure functions and pipeline states
- `/tests/eval/` — LLM eval cases + golden CAS fixtures
- `/tests/e2e/` — Playwright end-to-end user path flows

## Before making changes
1. Read this file.
2. Read the relevant contract in `/lib/contracts/`.
3. If touching a **prompt**: bump version, update changelog, run `npm run eval` after.
4. If touching the **schema**: stop and ask the user.
5. If touching the **strict-RAG prompt**: run `npm run eval` and compare baselines.
6. If adding a **new tool**: add a Zod schema to `ToolArgSchemas` in `/lib/tools/arg-schemas.ts`.

## Established patterns (follow these)

### API routes
Every route wraps its DB operations in try/catch and returns:
```typescript
NextResponse.json(err('DB_ERROR', e instanceof Error ? e.message : 'database error'), { status: 500 })
```

### Module-level singletons
Azure OpenAI clients and deployment names are created once at module load, not per request:
```typescript
const _client = getGpt4oMini()
const _deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI!
```

### Zod arg validation in the orchestrator
LLM-supplied tool arguments are validated against `ToolArgSchemas` before dispatch. Unknown tools fall through to the `default` case. Validation failures log a warning and dispatch with empty args.

### CAS validation guards
- `isValidPositiveNumber` — guards `units` and `nav` against 0, NaN, Infinity
- `isValidNonNegativeNumber` — guards `market_value` (0 is valid for liquidated funds)
- Date comparison uses explicit UTC midnight on both sides to avoid IST false positives

### Fisher equation
`fisherReal(nominal, inflation)` returns full-precision. Guard: `inflation ≤ −1` returns `Infinity` (exact zero denominator) or `NaN` (negative denominator). Callers apply rounding at display boundaries.

### Inflation staleness
`computePersonalInflationTool` logs a warning (does not recompute) when the stored rate is >90 days old.

### CAS vision batch gate
- `parseCASVision` warns on any failed batch and aborts (returns `null`) if >50% of batches fail, preventing a partial-portfolio write from silently passing `validateCAS`.
- When verifying Kiran's portfolios/holdings, accept both database `fund_allocations` and UI `holdings` arrays to prevent validation mismatches.

## Testing convention
- Every pure function in `/lib/inflation/` and `/lib/cas/` gets unit tests.
- Every LLM surface gets eval cases.
- After any change touching `/lib/prompts/` or `/lib/contracts/`, run `npm run eval`.
- Mocking is enabled when `MOCK_LLM=true` via `tests/mocks/azure-openai.mock.ts` and `MockQdrantClient`. Run `npm test` or `npx playwright test` with mock settings to run without connecting to live OpenAI/Qdrant servers.
- Corrupted-PDF negative test: `passed = !result.ok` (a successful parse of a corrupted file is a test failure).

## What this product is NOT
- Not an advisor (education only)
- Not a brokerage, transaction platform, or portfolio manager
- Not multi-user (v1)
- Not deployed to a public URL (v1)
