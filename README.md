# PF Copilot

[![CI](https://github.com/imaxtiwari/pf-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/imaxtiwari/pf-copilot/actions/workflows/ci.yml)

Personal Finance Copilot for Indian retail investors.
**Educational tool — NOT investment advice.**

Shows real returns after personal inflation, explains mutual fund factsheets with strict citations from official AMFI factsheets, parses Consolidated Account Statements (CAS) from NSDL/CDSL, and answers questions about your portfolio through a transparent multi-agent AI workspace.

Live demo: https://pf-copilot-eight.vercel.app

---

## Quick start

```bash
cp .env.example .env.local
# Fill in Azure OpenAI credentials, DATABASE_URL, and AMFI_NAV_URL
npm install
npm run db:migrate
npm run dev       # http://localhost:3000
```

## Local Postgres + pgvector

```bash
docker run --name pf-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d ankane/pgvector

docker exec -it pf-pg psql -U postgres -c "CREATE DATABASE pf_copilot;"
```

---

## Pages

| Route | Description |
|-------|-------------|
| `/onboarding` | Profile setup — age, city tier, rent, dependents, medical. Computes a personalised inflation rate. |
| `/portfolio` | Holdings breakdown with nominal vs real 1-year returns after personal inflation. Includes a compact AI Workspace summary. |
| `/portfolio/upload` | Upload a NSDL or CDSL CAS PDF. Text extraction first; GPT-4o vision fallback. All-or-nothing validation. |
| `/portfolio/review` | Manual review page for low-confidence CAS extractions before confirming. |
| `/portfolio/equity` | Dedicated equity allocation view. |
| `/chat` | Conversational assistant backed by GPT-4o-mini with live SSE streaming of agent events. |
| `/chat/audit` | Chat audit log for recent conversations. |

## API routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Liveness check — DB + Azure OpenAI connectivity. |
| `/api/me` | GET | Resolve or create dev user, return profile. |
| `/api/onboarding` | POST | Upsert onboarding profile, compute inflation rate. |
| `/api/portfolio/holdings` | GET | Return current holdings for the session user. |
| `/api/portfolio/insights` | GET | Return the latest generated portfolio insight. |
| `/api/portfolio/allocation` | GET | Return AMFI-category-based allocation buckets. |
| `/api/portfolio/timeline` | GET | Return historical portfolio snapshots. |
| `/api/portfolio/equity` | GET | Return equity-focused allocation data. |
| `/api/cas/ingest` | POST | Legacy CAS upload endpoint (auto-confirm on high confidence). |
| `/api/cas/review-session` | POST | Create a review session for a CAS PDF; returns extraction, thumbnails, confidence. |
| `/api/cas/confirm` | POST | Persist a reviewed extraction to the database. |
| `/api/chat` | POST | Single synchronous chat turn via the orchestrator. |
| `/api/chat/stream` | POST | Streaming chat turn via Server-Sent Events (SSE). |
| `/api/chat/audit` | GET | Return recent chat messages for the audit page. |
| `/api/chat/audit/chunk` | GET | Paginated chat audit feed. |
| `/api/demat/ingest` | POST | Upload a demat statement PDF (work in progress). |

---

## Architecture

```
Browser
  ├── /onboarding      → POST /api/onboarding → userProfile (DB)
  ├── /portfolio       → server component
  │                       ├── holdings query (DB)
  │                       ├── DISTINCT ON factsheet_chunks (DB) → real-returns engine
  │                       ├── latest insight (DB)
  │                       ├── allocation (DB + AMFI master)
  │                       └── buildPortfolioWorkspaceState → compact AgentActivityPanel
  ├── /portfolio/upload → POST /api/cas/review-session
  │                       → parseCAS (text path → vision fallback)
  │                       → validateCAS (all-or-nothing gate)
  │                       → crossCheckSchemes (single AMFI batch query)
  ├── /portfolio/review → confirm via POST /api/cas/confirm
  └── /chat            → POST /api/chat/stream
                           → runOrchestratorWithEvents (GPT-4o-mini, ≤5 tool iterations)
                                ├── get_portfolio
                                ├── compute_personal_inflation
                                ├── compute_real_returns
                                ├── lookup_chat_history
                                ├── explain_fund → RAG (GPT-4o, strict grounding, 1-retry)
                                └── compare_funds / explain_stock
                           → SSE: agent events, copilot status, final assistant payload
```

### Streaming chat flow

1. The chat page POSTs `{ message, language }` to `/api/chat/stream`.
2. The route validates the body with Zod and calls `runOrchestratorWithEvents`.
3. Every orchestrator event is emitted as SSE:
   - `event: agent` — normalised agent lifecycle events (`agent_started`, `tool_called`, `tool_completed`, `finding_created`, `agent_completed`).
   - `event: copilot_status` — high-level status updates (`analysing`, `researching`, `cross-checking`, `synthesizing`, `complete`).
4. The final `event: assistant` carries the assistant message, citations, tool traces, model version, refusal reason, request ID, and workspace state.
5. The client helper `subscribeToChatStream` reads the stream line-by-line and dispatches to `onEvent`, `onStatusChange`, `onComplete`, and `onError` callbacks.

### AI Workspace

The workspace is a shared UI surface rendered by `AIWorkspaceShell` and `AgentActivityPanel`:

- **Chat page** — live panel during streaming; collapsible; shows working agents, completed agents, activity feed, and copilot status.
- **Portfolio page** — compact panel near the top showing a static `WorkspaceState` built from holdings, inflation rate, real return, allocation, and latest insight.

Agents:

| Agent | Role |
|-------|------|
| Portfolio Analyst | Maps holdings to portfolio value. |
| Inflation Analyst | Computes and supplies personal inflation rate. |
| Performance Analyst | Computes real-return analysis. |
| Fund Research Agent | Grounded fund explanation from AMFI factsheet chunks. |
| Risk Analyst | Allocation and concentration review. |
| Copilot | Synthesises outputs and delivers the final response. |

### Key invariants

- **No advice language** — `FORBIDDEN_IN_ASSISTANT_OUTPUT` in `lib/contracts/no-advice.ts` blocks "buy", "sell", "invest in", "should", "recommend", and related phrases.
- **Strict-RAG** — every numeric claim in an `explain_fund` response must cite a retrieved chunk ID. Responses failing the contract are retried once, then refused.
- **CAS all-or-nothing** — `validateCAS` gates every upload. Partial writes are forbidden.
- **Azure OpenAI only** — no other LLM providers.
- **PDF buffers are memory-only** — raw CAS PDFs are never persisted to disk.
- **Reduced-motion support** — animations and auto-scroll respect `prefers-reduced-motion`.
- **Accessibility** — status changes are announced with `aria-live="polite"`; copilot status combines icon + text label so it is not colour-only.

---

## Inflation engine

`lib/inflation/` is a pure deterministic module with no I/O:

- **`compute.ts`** — weighted sleeve model (general / medical / education / lifestyle). Confidence: low (default) → medium (partial profile) → high (full profile).
- **`real-returns.ts`** — Fisher equation: `real = (1+nominal)/(1+inflation) − 1`. Guards for `inflation ≤ −1` (returns `Infinity` or `NaN`).
- **`parse-return.ts`** — extracts 1-year return from factsheet chunk text. Handles `%` suffix and bare-number table cell formats.

---

## CAS parsing

- **`lib/cas/parse-text.ts`** — primary path. Regex-based extraction from NSDL/CDSL text PDFs.
- **`lib/cas/parse-vision.ts`** — GPT-4o vision fallback. Pages batched 10 at a time. Aborts if >50% of batches fail to prevent partial-portfolio writes.
- **`lib/cas/amfi-master.ts`** — single `LIKE ANY(ARRAY[...])` batch query to cross-check scheme names against the AMFI master table.
- **`lib/cas/review-session.ts`** — generates a review session with extraction, thumbnails, and confidence scores.

---

## Demat parsing

- **`lib/demat/parse-text.ts`** — text extraction for demat statements.
- **`lib/demat/parse-vision.ts`** — vision fallback for demat PDFs.
- **`lib/demat/parse.ts`** — orchestrates text → vision fallback.

---

## Chat / orchestrator

- **`lib/orchestrator.ts`** — GPT-4o-mini tool-call loop (≤5 iterations, module-level client singleton). Exports both `runOrchestrator` (synchronous) and `runOrchestratorWithEvents` (streaming with agent events).
- **`lib/sse-client.ts`** — browser helpers for consuming SSE: `subscribeToChatStream` (fetch-based line reader for the POST endpoint) and `subscribeWithEventSource` (generic EventSource wrapper).
- **`lib/agent-mapping.ts`** — builds `WorkspaceState` from tool traces, status, and messages.
- **`lib/portfolio/workspace-state.ts`** — builds a static `WorkspaceState` for the portfolio page.
- **`lib/tools/`** — tool definitions, Zod arg schemas, and handlers.

---

## Testing

```bash
npm test                     # vitest unit + integration tests (watch mode)
npm run test:coverage       # full suite with coverage thresholds
npm run lint                # eslint
npx tsc --noEmit            # typecheck
npm run build               # production build
npm run test:e2e            # playwright e2e suite (requires dev server)
npm run eval:setup          # generate golden CAS PDFs (run once)
npm run eval                # LLM eval suite (requires .env.local + running DB)
```

CI runs typecheck, lint, a TruffleHog secret scan, the full test suite with coverage thresholds, and a production build on every push and PR.

Coverage targets (enforced in `vitest.config.ts`):

| Metric | Threshold |
|--------|-----------|
| Lines | 70% |
| Statements | 70% |
| Branches | 60% |
| Functions | 60% |

Test matrix:

| Suite | Files | Notes |
|-------|-------|-------|
| Unit + Integration | 54 files, 510+ tests | Pure functions, auth, rate-limiting, CAS/demat parsing, orchestrator tooling, and API route integration tests with mocked DB/auth/orchestrator. |
| E2E | `tests/e2e/chat-stream.spec.ts`, `tests/e2e/happy-path.spec.ts` | Requires running dev server; `happy-path` uses the committed synthetic CAS fixture (`tests/fixtures/cas-sample.pdf`). |
| Eval | `tests/eval/runner.ts` + golden fixtures | LLM-based evals for CAS extraction and fund explanation. |

Some component tests are sensitive to parallel execution and may time out when the full suite runs concurrently. They pass reliably when run in isolation. If you see a timeout in `agent-panel.test.tsx` or `chat-page-workspace.test.tsx`, rerun the affected file.

---

## Environment variables

See `.env.example` for the full list. Required at startup (missing `DATABASE_URL` throws immediately):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pf_copilot
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT_GPT4O=gpt-4o
AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI=gpt-4o-mini
AZURE_OPENAI_DEPLOYMENT_EMBEDDING=text-embedding-3-large
AMFI_NAV_URL=https://www.amfiindia.com/spages/NAVAll.txt
LOG_LEVEL=info
```

For Vercel deployments, add these as project environment variables. The build runs `npm run vercel-build` which executes migrations before `next build`.

---

## Deployment

The project is configured for Vercel:

```bash
vercel login
vercel --prod
```

Production deployment: https://pf-copilot-eight.vercel.app

Make sure the following environment variables are set in the Vercel dashboard or via `vercel env add` for Production:

- `DATABASE_URL`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT_GPT4O`
- `AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI`
- `AZURE_OPENAI_DEPLOYMENT_EMBEDDING`
- `AMFI_NAV_URL`
- `LOG_LEVEL`

---

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · PostgreSQL 16 + pgvector · Drizzle ORM · Azure OpenAI SDK · pino · zod · vitest · playwright

See `CLAUDE.md` for full constraints, conventions, and hard rules for contributors.
