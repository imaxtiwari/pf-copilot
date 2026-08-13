# CLAUDE.md — Personal Finance Copilot

## What this is

An educational tool for Indian retail investors. Shows real returns (nominal minus personal inflation), explains mutual fund factsheets with strict citations from official AMFI factsheets, parses NSDL/CDSL CAS PDFs, and answers portfolio questions through a transparent multi-agent AI workspace. It does NOT give investment advice.

Production deployment: https://pf-copilot-eight.vercel.app

---

## Hard constraints (NEVER violate)

1. **LLM provider: Azure OpenAI ONLY.** Do not add Google Gemini, Anthropic, OpenAI direct, or any other provider.
2. **No advice language EVER.** The assistant never says "buy", "sell", "invest in", "should", "recommend", "best fund", "good fund", "bad fund", "top pick" in any output. See `/lib/contracts/no-advice.ts`.
3. **Strict-RAG for fund explainer.** The `explain_fund` tool must refuse-on-no-grounding. Every numeric claim must cite a chunk ID. One retry on contract violation, then refuse. See `/lib/rag/explain-fund.ts` and `/lib/prompts/explain-fund.ts`.
4. **CAS validation gate is non-negotiable.** Partial-write of holdings is forbidden. All-or-nothing per upload. See `/lib/contracts/cas-validation.ts`.
5. **CAS PDF buffers are memory-only.** Never persist the raw PDF to disk or blob. Free buffer after extraction completes.
6. **Deployment is public.** The app is deployed on Vercel; environment variables must be configured in the Vercel dashboard. Local development still uses `.env.local`.
7. **No advice in UI copy either.** Buttons, labels, empty states, and insights must be descriptive or educational, never prescriptive.

---

## Stack lockdown

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- PostgreSQL 16 + pgvector (local Docker for development; Supabase or managed Postgres in production)
- Drizzle ORM 0.45+
- Azure OpenAI SDK (`openai` package, `AzureOpenAI` class) — GPT-4o, GPT-4o-mini, text-embedding-3-large
- pdf-parse v2 (text extraction primary), pdf2pic (vision fallback)
- vitest (unit + eval tests), playwright (e2e)
- pino (structured logging)
- zod (runtime validation — including `ToolArgSchemas` in `/lib/tools/arg-schemas.ts`)

---

## File structure conventions

- `/app/api/` — all API routes; streaming routes use `text/event-stream` headers
- `/app/chat/page.tsx` — client page with streaming SSE integration
- `/app/portfolio/page.tsx` — server page with compact AI Workspace summary
- `/components/agent-activity-panel.tsx` — collapsible workspace panel (chat + portfolio)
- `/components/agent-card.tsx` — individual agent card with status, evidence, next step
- `/components/agent-avatar.tsx` — avatar initials + accessible label per agent
- `/components/activity-feed.tsx` — scrollable, aria-live announced event feed
- `/components/copilot-status.tsx` — copilot status pill with icon + text label
- `/components/ai-workspace-shell.tsx` — responsive shell for the workspace panel
- `/lib/contracts/` — invariants enforced across the codebase (`no-advice.ts`, `cas-validation.ts`, `error-envelope.ts`, `refusal-types.ts`, `agent-events.ts`, `demat-validation.ts`)
- `/lib/prompts/` — system prompts, versioned (every prompt exports `{ version, text, changelog }`)
- `/lib/inflation/` — pure deterministic inflation engine (no I/O, fully unit-tested)
  - `compute.ts` — sleeve model, confidence levels
  - `real-returns.ts` — Fisher equation with `inflation ≤ −1` guard
  - `parse-return.ts` — extracts 1Y return from factsheet text (handles `%` and bare-number formats)
- `/lib/cas/` — CAS PDF parsing (`parse-text.ts`, `parse-vision.ts`, `amfi-master.ts`, `parse.ts`, `review-session.ts`)
- `/lib/demat/` — demat statement parsing (`parse-text.ts`, `parse-vision.ts`, `parse.ts`)
- `/lib/rag/` — factsheet retrieval + strict-RAG agent (`retrieval.ts`, `explain-fund.ts`, `validate-response.ts`, `explain-stock.ts`, `retrieval-stock.ts`, `compare-funds.ts`)
- `/lib/tools/` — orchestrator tool definitions, handlers, and Zod arg schemas
  - `arg-schemas.ts` — `ToolArgSchemas` with `z.coerce.string()` for scheme codes (handles LLM returning numbers)
- `/lib/orchestrator.ts` — GPT-4o-mini tool-call loop (≤5 iterations, module-level client singleton); exports `runOrchestrator` and `runOrchestratorWithEvents`
- `/lib/sse-client.ts` — browser helpers for consuming SSE from `/api/chat/stream`
- `/lib/agent-mapping.ts` — builds `WorkspaceState` from tool traces and messages
- `/lib/portfolio/workspace-state.ts` — builds static `WorkspaceState` for the portfolio page
- `/lib/portfolio/insights.ts` — deterministic educational insight generator
- `/lib/portfolio/snapshots.ts` — portfolio snapshot history
- `/lib/portfolio/allocation.ts` — AMFI-category-based allocation logic
- `/lib/portfolio/get-allocation.ts` — allocation query helper
- `/lib/portfolio/xirr.ts` — portfolio XIRR computation
- `/lib/logger.ts` — structured logger (pino)
- `/lib/db.ts` — Drizzle pool; throws at startup if `DATABASE_URL` is missing
- `/db/schema.ts` — Drizzle schema (**read-only — don't add columns without explicit user direction**)
- `/db/migrate.ts` — runs migrations and HNSW index creation at build time
- `/tests/unit/` — unit tests for pure functions and components
- `/tests/eval/` — LLM eval cases + golden CAS fixtures
- `/tests/e2e/` — Playwright end-to-end tests

---

## Before making changes

1. Read this file.
2. Read the relevant contract in `/lib/contracts/`.
3. If touching a **prompt**: bump version, update changelog, run `npm run eval` after.
4. If touching the **schema**: stop and ask the user.
5. If touching the **strict-RAG prompt**: run `npm run eval` and compare baselines.
6. If adding a **new tool**: add a Zod schema to `ToolArgSchemas` in `/lib/tools/arg-schemas.ts`.
7. If adding a **new page or API route**: update `README.md` and this file.
8. If changing **UI components** in the workspace: verify accessibility (aria-live, colour-not-only, reduced motion).

---

## Established patterns (follow these)

### API routes

Every route wraps its DB operations in try/catch and returns:

```typescript
NextResponse.json(err('DB_ERROR', e instanceof Error ? e.message : 'database error'), { status: 500 })
```

### Streaming SSE route

`/api/chat/stream` returns `text/event-stream` with lines shaped like:

```text
event: agent
data: {"type":"agent_started","agent":"Portfolio Analyst",...}

event: copilot_status
data: {"status":"analysing",...}

event: assistant
data: {"assistant_message":"...","citations":[],...}

```

### Client-side SSE consumption

Use `subscribeToChatStream` from `/lib/sse-client.ts`:

```typescript
const close = subscribeToChatStream(
  '/api/chat/stream',
  { message, language },
  {
    onEvent: (event) => { ... },
    onStatusChange: (status) => { ... },
    onComplete: (data) => { ... },
    onError: (error) => { ... },
  }
)
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

`parseCASVision` warns on any failed batch and aborts (returns `null`) if >50% of batches fail, preventing a partial-portfolio write from silently passing `validateCAS`.

### Workspace state

- `buildWorkspaceState(toolTraces, message, isComplete)` — chat fallback when the stream does not include `workspace_state`.
- `buildPortfolioWorkspaceState(input)` — static state for the portfolio page.
- Both return a full `WorkspaceState` with `agents`, `activity`, `summary`, and `copilotStatus`.

### Accessibility

- Activity feed container has `aria-live="polite"` so new events are announced.
- Agent cards expose their name + status through `aria-label`.
- Copilot status uses an icon + text label; never colour alone.
- Reduced motion is respected via `prefers-reduced-motion` media query in `app/globals.css` and per-component checks.

---

## Testing convention

- Every pure function in `/lib/inflation/` and `/lib/cas/` gets unit tests.
- Every LLM surface gets eval cases.
- After any change touching `/lib/prompts/` or `/lib/contracts/`, run `npm run eval`.
- Eval suite tracks model deployment name in results.
- Corrupted-PDF negative test: `passed = !result.ok` (a successful parse of a corrupted file is a test failure).
- Component tests use vitest + Testing Library + happy-dom.
- Some component tests (`agent-panel.test.tsx`, `chat-page-workspace.test.tsx`) are sensitive to parallel resource contention and may time out in a full run; they pass reliably in isolation.

---

## Build and deployment

Local:

```bash
npm install
npm run db:migrate
npm run dev
```

Production (Vercel):

```bash
vercel --prod
```

`npm run vercel-build` runs `db:migrate` before `next build`, so migrations are applied automatically on deployment. Ensure `DATABASE_URL` and all Azure OpenAI environment variables are configured in the Vercel project.

---

## What this product is NOT

- Not an advisor (education only)
- Not a brokerage, transaction platform, or portfolio manager
- Not a source of buy/sell/hold recommendations
