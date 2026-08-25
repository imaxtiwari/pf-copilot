# PF Copilot

[![CI](https://github.com/imaxtiwari/pf-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/imaxtiwari/pf-copilot/actions/workflows/ci.yml)

**Personal Finance Copilot for Indian retail investors.**

> ⚠️ **Educational tool — NOT investment advice.** PF Copilot explains concepts, parses your statements, and shows factual portfolio analytics. It will never tell you to buy, sell, hold, or switch any security.

Live demo: https://pf-copilot-eight.vercel.app

---

## Table of contents

1. [What is PF Copilot?](#1-what-is-pf-copilot)
2. [High-level architecture](#2-high-level-architecture)
3. [Repository layout](#3-repository-layout)
4. [Getting started](#4-getting-started)
5. [Pages and user flows](#5-pages-and-user-flows)
6. [API reference](#6-api-reference)
7. [The chat orchestrator](#7-the-chat-orchestrator)
8. [Data ingestion pipeline](#8-data-ingestion-pipeline)
9. [Portfolio analytics engine](#9-portfolio-analytics-engine)
10. [Safety and guardrails](#10-safety-and-guardrails)
11. [Testing](#11-testing)
12. [Deployment](#12-deployment)
13. [Troubleshooting](#13-troubleshooting)
14. [Development conventions](#14-development-conventions)
15. [Glossary](#15-glossary)

---

## 1. What is PF Copilot?

PF Copilot helps Indian retail investors make sense of their own money without crossing into advisory territory. It combines deterministic financial calculations with grounded, citation-backed AI explanations.

### Core capabilities

- **Real returns after personal inflation** — Computes your effective return by subtracting your personal inflation rate (derived from age, city tier, rent, dependents, and medical expenses) from nominal fund returns.
- **Mutual fund fact-sheet explainer** — Answers questions about any mutual fund using only official AMFI factsheets; every numeric claim cites the source chunk.
- **CAS / demat statement parsing** — Uploads NSDL/CDSL Consolidated Account Statements or demat statements, extracts holdings, and asks you to review low-confidence extractions before persisting them.
- **Conversational portfolio assistant** — Chat about your portfolio through a transparent multi-agent workspace. You see which agent is working, what evidence it found, and how it arrived at its answer.
- **Portfolio insights** — Generates deterministic, educational insights (concentration, allocation drift, real-return summary) from your current holdings.

### What it is NOT

- Not a SEBI-registered investment advisor.
- Not a brokerage, transaction platform, or portfolio manager.
- Not a source of buy / sell / hold / switch recommendations.
- Not a replacement for a qualified financial planner.

### Core design principles

1. **Deterministic finance, probabilistic AI.** Numerical engines are pure functions with unit tests. LLMs are constrained by schemas, citations, and guardrails.
2. **Fail-safe by default.** If the safety classifier fails, it defaults to "safe" and logs the incident. Structured LLM calls return deterministic fallbacks. CAS writes are all-or-nothing.
3. **Transparent by design.** Every chat turn exposes tool traces, citations, and workspace state so the user can inspect the reasoning.
4. **Privacy-first defaults.** Raw PDF bytes are never persisted; only extracted holdings and audit metadata are stored.

---

## 2. High-level architecture

```mermaid
flowchart TB
    subgraph Client
        Browser["Browser (React / SSE)"]
    end

    subgraph Vercel["Vercel Edge / Node runtime"]
        Next["Next.js 16 App Router"]
        API["API Routes"]
        Auth["Auth: dev-user cookie / Supabase"]
    end

    subgraph Data["Data Layer"]
        PG[(PostgreSQL + pgvector)]
        Qdrant[(Qdrant vector search)]
        Redis[(Upstash Redis rate limiting)]
    end

    subgraph LLM["LLM Layer"]
        Azure["Azure OpenAI"]
        Mock["MOCK_LLM fallback"]
    end

    subgraph Jobs["Background Jobs"]
        Inngest["Inngest"]
    end

    Browser --> Next
    Next --> API
    API --> Auth
    API --> PG
    API --> Qdrant
    API --> Redis
    API --> Azure
    API --> Mock
    API --> Inngest
    Inngest --> PG
    Inngest --> Azure
```

### Request flow

```
Browser
  → Next.js App Router (server component or API route)
    → Auth layer (dev-user cookie / Supabase session)
    → Rate limiter (Upstash Redis, with in-memory fallback for local dev)
    → Business logic
      → PostgreSQL via Drizzle ORM
      → Qdrant for vector search (factsheets / stock documents)
      → Azure OpenAI for LLM calls (or MOCK_LLM in dev/test)
    → Standardized JSON response { ok: true, data: ... }
                            or { ok: false, error: { code, message, request_id } }
```

### Technology stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL 15+ with `pgvector` extension |
| ORM | Drizzle ORM 0.45+ |
| Auth | Supabase Auth (production), dev-user cookie (local) |
| LLM | Azure OpenAI SDK (`openai` package) — GPT-4o, GPT-4o-mini, text-embedding-3-large |
| Vector store | Qdrant (optional; pgvector is used inside Postgres) |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`) |
| Background jobs | Inngest |
| Logging | pino (structured JSON) |
| Validation | zod |
| Testing | vitest (unit + integration), Playwright (E2E), custom eval runner |
| Deployment | Vercel |

### Key architectural decisions

| Decision | Why |
|----------|-----|

---

## 3. Repository layout

```
/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   ├── chat/               # Chat UI page
│   ├── portfolio/          # Portfolio pages
│   └── onboarding/         # Onboarding page
├── components/             # React components (workspace, charts, upload, etc.)
├── db/
│   ├── schema.ts           # Drizzle table definitions
│   └── migrations/         # Incremental SQL migrations
├── lib/
│   ├── agent-mapping.ts    # Maps tool names to workspace agents
│   ├── azure-openai.ts     # Azure OpenAI client factory + mock fallback
│   ├── cas/                # CAS PDF parsing
│   ├── config/policy.ts    # Tunable thresholds
│   ├── contracts/          # Shared invariants: no-advice, error-envelope, CAS validation
│   ├── db.ts               # Lazy Drizzle / pg Pool proxies
│   ├── demat/              # Demat statement parsing
│   ├── inflation/          # Personal inflation + real returns engine
│   ├── jobs/               # Inngest job definitions and handlers
│   ├── llm/                # Structured LLM call helper
│   ├── logger.ts           # pino logger
│   ├── metrics.ts          # Chat latency / token / refusal metrics
│   ├── orchestrator.ts     # Multi-tool chat orchestrator
│   ├── portfolio/          # Portfolio allocation, snapshots, XIRR, insights
│   ├── prompts/            # Versioned system prompts
│   ├── qdrant/             # Qdrant dimension checks
│   ├── rag/                # Strict-RAG explain/compare tools
│   ├── rate-limit.ts       # Rate limiting middleware
│   ├── safety/             # Safety classifier
│   ├── tools/              # Tool definitions and handlers used by the orchestrator
│   ├── tracing.ts          # OpenTelemetry-style spans
│   └── validation/         # Zod schemas
├── scripts/                # One-off scripts (AMFI sync, factsheet ingestion)

---

## 4. Getting started

### 4.1 Prerequisites

- Node.js 20+ (see `.nvmrc`)
- npm 10+
- PostgreSQL 15+ with `pgvector` extension
- (Optional) Qdrant for vector search
- (Optional) Azure OpenAI account

### 4.2 Local PostgreSQL + pgvector

The simplest way is Docker:

```bash
# Start a local Postgres with pgvector
docker run --name pf-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d ankane/pgvector

# Create the application database
docker exec -it pf-pg psql -U postgres -c "CREATE DATABASE pf_copilot;"

# Verify the vector extension is available
docker exec -it pf-pg psql -U postgres -d pf_copilot -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 4.3 Environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`. The minimal local-dev set is:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pf_copilot

# Optional: Azure OpenAI (not required if MOCK_LLM=true)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_DEPLOYMENT_GPT4O=gpt-4o
AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI=gpt-4o-mini
AZURE_OPENAI_DEPLOYMENT_EMBEDDING=text-embedding-3-large

# Supabase Auth (required in production; local dev can use legacy dev-user cookie)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key


---

## 5. Pages and user flows

### 5.1 `/onboarding`

The onboarding flow collects:

- Age
- City tier (metro / tier-1 / tier-2 / tier-3)
- Monthly rent / EMI
- Number of dependents
- Medical expense estimate

From these inputs, the app computes a **personal inflation rate** using the sleeve model in `lib/inflation/compute.ts`. The rate is stored in `userProfile.inflationRate` and used across the portfolio view to show real returns.

### 5.2 `/portfolio`

The main dashboard. It is a Next.js server component that:

1. Resolves the current user.
2. Loads the latest holdings from `portfolioHoldings` / `dematHoldings`.
3. Fetches the latest factsheet chunk per ISIN to obtain 1-year nominal returns.
4. Applies the user's personal inflation rate via the Fisher equation in `lib/inflation/real-returns.ts`.
5. Renders allocation charts, concentration warnings, and a compact AI Workspace summary.

The page never calls the LLM at render time; insights are generated on upload or backfilled on demand via `/api/portfolio/insights`.

### 5.3 `/portfolio/upload`

CAS upload page. The flow is:

1. User selects a NSDL/CDSL CAS PDF.
2. The PDF is sent to `/api/cas/review-session`.
3. The backend extracts text using `pdf-parse`; if extraction is poor, it falls back to GPT-4o vision via `pdf2pic` rendered thumbnails.
4. A review session is created with holdings, confidence scores, and thumbnails.
5. If confidence is high across all holdings, the user can confirm; otherwise they are sent to `/portfolio/review`.

### 5.4 `/portfolio/review`

Manual review page for low-confidence CAS extractions. It displays:

- Extracted ISIN, scheme name, units, NAV, market value
- Confidence badge per field

---

## 6. API reference

All API routes return a standardized envelope:

```typescript
// Success
{ ok: true, data: T }

// Error
{
  ok: false,
  error: {
    code: string,
    message: string,
    details?: unknown,
    request_id: string
  }
}
```

### Health

| Route | Method | Description |
|-------|--------|-------------|
| `GET /api/health` | GET | Liveness + DB + Redis checks. |
| `GET /api/health/deep` | GET | Includes Azure OpenAI + Qdrant connectivity. |

Example:

```bash
curl http://localhost:3000/api/health
```

### User and onboarding

| Route | Method | Description |
|-------|--------|-------------|

---

## 7. The chat orchestrator

The orchestrator (`lib/orchestrator.ts`) is the brain of the conversational experience. It runs a loop of:

1. **Receive user message.** Detect language (English vs. Hinglish).
2. **Load context.** Recent chat history, user profile, portfolio holdings.
3. **LLM call with tools.** GPT-4o-mini is given a system prompt and a set of tool definitions.
4. **Tool dispatch.** If the model requests a tool, arguments are validated with `ToolArgSchemas`, the tool runs, and its result is appended to the conversation.
5. **Repeat.** Up to `maxToolIterations` (default 5) or until the model returns a final answer.
6. **Safety classification.** The final answer is classified as `safe`, `borderline`, or `advice`.
7. **Persist and respond.** If advice is detected, the answer is replaced with a refusal; otherwise it is persisted and returned with tool traces, citations, and workspace state.

### Available tools

| Tool | Purpose | File |
|------|---------|------|
| `get_portfolio` | Fetch user's current holdings. | `lib/tools/get-portfolio.ts` |
| `compute_personal_inflation` | Return the user's stored inflation rate (warns if stale). | `lib/tools/compute-inflation.ts` |
| `compute_real_returns` | Compute nominal vs. real returns for holdings. | `lib/tools/compute-real-returns.ts` |
| `lookup_chat_history` | Search previous turns. | `lib/tools/lookup-chat-history.ts` |
| `explain_fund` | Explain a mutual fund with factsheet citations. | `lib/tools/explain-fund.ts` |
| `explain_stock` | Explain a stock with document citations. | `lib/tools/explain-stock.ts` |
| `compare_funds` | Compare two mutual funds. | `lib/tools/compare-funds.ts` |

### Cost and latency controls

- **Token budget:** `maxTokensPerTurn` defaults to 4,000 tokens.
- **Latency budget:** 12,000 ms p95 target.
- **Cost tracking:** Every turn increments `users.monthlyTokens` and `users.monthlyCost`. Cost is configurable via `TOKEN_COST_PER_1K_USD`.
- **Structured output:** Tool results that need JSON use `lib/llm/structured-call.ts` with Zod schemas, retries, and deterministic fallbacks.

### Workspace state

The orchestrator emits a `WorkspaceState` object containing:

- `agents`: list of agents with status, evidence, and next step
- `activity`: chronological event feed

---

## 8. Data ingestion pipeline

### 8.1 CAS parsing

Consolidated Account Statements from NSDL/CDSL contain all mutual fund holdings across registrars. The pipeline is:

1. **PDF upload** → raw buffer in memory.
2. **Text extraction** via `pdf-parse` (`lib/cas/parse-text.ts`).
3. **Normalization** → ISIN, scheme name, units, NAV, market value, date.
4. **Confidence scoring** per field (`lib/cas/parse-confidence.ts`).
5. **AMFI master lookup** to enrich scheme metadata (`lib/cas/amfi-master.ts`).
6. **Validation gate** `validateCAS` ensures no partial writes (`lib/contracts/cas-validation.ts`).
7. **Vision fallback** (`lib/cas/parse-vision.ts`) if text extraction is incomplete. Vision aborts if >50% of thumbnail batches fail.
8. **Review session** or direct persist depending on confidence.

### 8.2 Demat parsing

Demat statements list direct equity holdings. The parser follows the same text-first, vision-fallback pattern as CAS parsing (`lib/demat/parse.ts`, `lib/demat/parse-text.ts`).

### 8.3 AMFI master sync

`scripts/sync-amfi-master.ts` fetches the daily NAV file from `AMFI_NAV_URL` and upserts scheme metadata. This is usually run as a background job via Inngest.

### 8.4 Factsheet ingestion

`scripts/ingest-factsheets.ts` downloads official AMFI factsheet PDFs, chunks them, and stores embeddings in `factsheet_chunks` (with HNSW index) for strict-RAG lookups.

---

## 9. Portfolio analytics engine

### 9.1 Allocation (`lib/portfolio/allocation.ts`)

Maps each holding to AMFI categories and computes:

- Equity / debt / liquid / other percentages
- Age-based equity band recommendation
- Single-fund concentration warning
- Category drift flags

### 9.2 Snapshots and timeline (`lib/portfolio/snapshots.ts`)

Every successful CAS confirm refreshes a point-in-time snapshot of the portfolio. The timeline API returns these snapshots plus computed XIRR.

### 9.3 Real returns (`lib/inflation/real-returns.ts`)

Uses the Fisher equation:

```
real_return = (1 + nominal) / (1 + inflation) - 1
```

Guarded against `inflation ≤ -1` (exact or near-zero denominator).

### 9.4 Insights (`lib/portfolio/insights.ts`)

Generates deterministic educational insights such as:

- "Your equity allocation is X%, which is above/below the typical band for your age."
- "Your largest fund concentration is Y%."
- "Your portfolio's real 1-year return after personal inflation is Z%."

Insights are persisted on upload and backfilled on demand.

### 9.5 XIRR (`lib/portfolio/xirr.ts`)

Computes the internal rate of return across portfolio snapshots and cash-flow-like events.

---

## 11. Testing

### 11.1 Commands

```bash
npm test                     # vitest watch mode
npm run test:coverage       # full suite with coverage thresholds
npm run lint                # eslint
npx tsc --noEmit            # typecheck
npm run build               # production build
npm run test:e2e            # Playwright E2E suite (requires dev server)
npm run eval:setup          # generate golden CAS PDFs (run once)
npm run eval                # LLM eval suite (requires .env.local + running DB)
```

### 11.2 Coverage thresholds

Configured in `vitest.config.ts`:

| Metric | Threshold |
|--------|-----------|
| Lines | 70% |
| Statements | 70% |
| Branches | 60% |
| Functions | 60% |

### 11.3 Test matrix

| Suite | Files | Notes |
|-------|-------|-------|
| Unit + Integration | 54 files, 450+ tests | Pure functions, auth, rate-limiting, CAS/demat parsing, orchestrator tooling, API route integration tests with mocked DB/auth/orchestrator. |
| E2E | `tests/e2e/chat-stream.spec.ts`, `tests/e2e/happy-path.spec.ts` | Requires running dev server; `happy-path` uses the committed synthetic CAS fixture `tests/fixtures/cas-sample.pdf`. |
| Eval | `tests/eval/runner.ts` + golden fixtures | LLM-based evals for CAS extraction and fund explanation. |

### 11.4 Testing tips

- Some component tests (`agent-panel.test.tsx`, `chat-page-workspace.test.tsx`) are sensitive to parallel resource contention and may time out in a full run; they pass reliably in isolation.
- The `db` Proxy supports `vi.spyOn(db, 'update')` for unit tests that need to mock database calls.
- Set `MOCK_LLM=true` in tests to avoid real Azure calls.

---

## 12. Deployment

### 12.1 Vercel (recommended)

```bash
vercel login
vercel --prod
```

### 12.2 Required production environment variables

Add these via the Vercel dashboard or `vercel env add`:

- `DATABASE_URL`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT_GPT4O`
- `AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI`
- `AZURE_OPENAI_DEPLOYMENT_EMBEDDING`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

---

## 13. Troubleshooting

### `next build` fails with "DATABASE_URL is not set"

This should no longer happen after the lazy-initialization refactor. If it does, ensure you are on the latest `main` and no file eagerly constructs `new Pool()` outside `lib/db.ts`.

### `npm run db:migrate` fails with "type chat_role already exists"

Your local database was likely created via `drizzle-kit push`, so the `__drizzle_migrations` table is empty. Seed it with entries for `0000_absurd_iron_monger` through `0002_safety_prompt_version`, then rerun migrations to apply `0003` and `0004`.

### `npm run test:e2e` fails in global setup

Ensure your local DB has the `users.monthly_tokens` and `users.monthly_cost` columns (migration `0003`). If migrations cannot run, see the previous item.

### Chat returns a refusal for an innocent question

Check `/chat/audit/safety` for the `request_id` and the classifier score. If the classifier is too aggressive, tune the prompt in `lib/safety/classifier.ts` or set `SAFETY_CLASSIFIER_ENABLED=false` only in a non-production environment.

### High Azure latency

- Reduce `maxToolIterations` in `DEFAULT_ORCHESTRATOR_CONFIG`.
- Ensure you are using `gpt-4o-mini` for the orchestrator, reserving `gpt-4o` for vision fallback only.
- Check Azure quota and rate limits.

---

## 14. Development conventions

See `CLAUDE.md` for the full contributor rulebook. Highlights:

- **Azure OpenAI ONLY.** No other LLM providers.
- **No advice language EVER.** Not in prompts, tool output, or UI copy.
- **All API routes use `ok`/`err`.** Import from `lib/contracts/error-envelope.ts`.
- **Lazy initialization.** Do not create Azure clients or DB pools at module load.
- **Versioned prompts.** Every prompt file exports `{ version, text, changelog }`.
- **Unit-test pure functions.** Every function in `lib/inflation/` and `lib/cas/` should have tests.
- **Eval after prompt changes.** Run `npm run eval` after touching `lib/prompts/` or `lib/contracts/`.

---

## 15. Glossary

| Term | Meaning |
|------|---------|
| **AMFI** | Association of Mutual Funds in India |
| **CAS** | Consolidated Account Statement (NSDL/CDSL) |
| **Demat** | Dematerialized securities account (direct equity) |
| **Fisher equation** | `real = (1 + nominal) / (1 + inflation) - 1` |
| **Hinglish** | Hindi written in Roman script or mixed Hindi-English |
| **HNSW index** | Approximate nearest-neighbor vector index in pgvector |
| **ISIN** | International Securities Identification Number |
| **NAV** | Net Asset Value of a mutual fund unit |
| **RLS** | Row-Level Security (Postgres / Supabase) |
| **RAG** | Retrieval-Augmented Generation |
| **SSE** | Server-Sent Events |
| **XIRR** | Extended Internal Rate of Return |

---

*For production runbooks, deployment checklists, and incident response, see `docs/PRODUCTION_HANDOFF.md`. For a summary of the latest handoff work, see `docs/FINAL_REPORT.md`.*

- `COOKIE_SECRET`
- `AMFI_NAV_URL`
- `LOG_LEVEL`

### 12.3 Build command

Vercel runs `npm run vercel-build`, which executes:

```bash
npm run db:migrate   # apply migrations + HNSW indexes
next build           # static + dynamic route build
```

### 12.4 Post-deploy checks

```bash
curl https://your-deployment.vercel.app/api/health
curl https://your-deployment.vercel.app/api/health/deep
```

### 12.5 Monitoring

PF Copilot emits structured pino logs. Key signals to alert on:

| Signal | Threshold | Severity |
|--------|-----------|----------|
| Error rate > 1% | 5-minute window | page |
| `/api/chat` p95 > 12 s | 10-minute window | warning |
| Rate-limit blocks > 10/min | 5-minute window | warning |
| `monthly_cost` > $5 / user | daily | warning |
| `monthly_cost` > $20 / user | daily | critical |
| Safety refusals > 5% of turns | daily | warning |

See `docs/PRODUCTION_HANDOFF.md` for full runbooks.


---

## 10. Safety and guardrails

### 10.1 No-advice policy

The assistant must never recommend buying, selling, holding, switching, or timing securities. This is enforced at multiple layers:

1. **System prompt** — every LLM call includes `NO_ADVICE_CLAUSE` from `lib/contracts/no-advice.ts`.
2. **Tool prompts** — RAG tools are instructed to stay factual and cite sources.
3. **Safety classifier** — `lib/safety/classifier.ts` classifies final output as `safe`, `borderline`, or `advice`. Advice triggers a refusal.
4. **UI copy** — buttons, labels, and insights are descriptive, not prescriptive.

### 10.2 Row-level security (RLS)

Supabase RLS policies in `db/migrations/0001_rls_policies.sql` ensure that authenticated users can only read/write their own rows. The `withAuthContext` helper in `lib/db.ts` lets tests impersonate the `authenticated` role.

### 10.3 Rate limiting

Production uses Upstash Redis. Local development falls back to an in-memory limiter. Rate-limited requests receive a standardized `429` error envelope.

### 10.4 Input validation

All API route inputs are validated with Zod where applicable. LLM tool arguments are validated against `ToolArgSchemas` before dispatch.

- `summary`: human-readable summary of what happened
- `copilotStatus`: overall status pill

This state is consumed by `components/agent-activity-panel.tsx` and `components/agent-card.tsx`.

| `GET /api/me` | GET | Resolve or create the dev user and return profile. |
| `GET /api/me/usage` | GET | Return monthly token/cost usage. |
| `POST /api/onboarding` | POST | Upsert onboarding profile and compute personal inflation rate. |

### Portfolio

| Route | Method | Description |
|-------|--------|-------------|
| `GET /api/portfolio/holdings` | GET | Current holdings for the session user. |
| `GET /api/portfolio/insights` | GET | Latest generated insight; backfills on demand. |
| `GET /api/portfolio/allocation` | GET | AMFI-category-based allocation buckets. |
| `GET /api/portfolio/timeline` | GET | Historical portfolio snapshots + XIRR. |
| `GET /api/portfolio/equity` | GET | Equity-focused allocation data. |

### CAS / demat

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/cas/ingest` | POST | Legacy CAS upload endpoint (auto-confirm on high confidence). |
| `POST /api/cas/review-session` | POST | Create a review session for a CAS PDF. |
| `POST /api/cas/confirm` | POST | Persist a reviewed extraction. |
| `POST /api/demat/ingest` | POST | Upload a demat statement PDF. |

### Chat

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/chat` | POST | Single synchronous chat turn. |
| `POST /api/chat/stream` | POST | Streaming chat turn via SSE. |
| `GET /api/chat/audit` | GET | Recent chat messages for audit page. |
| `GET /api/chat/audit/chunk` | GET | Paginated chat audit feed. |
| `GET /api/chat/audit/safety` | GET | Safety audit entries. |

### Jobs and alerts

| Route | Method | Description |
|-------|--------|-------------|
| `GET /api/scheduler` | GET | List available background job types. |
| `POST /api/scheduler` | POST | Enqueue background jobs. |
| `POST /api/inngest` | POST | Inngest serve endpoint. |
| `POST /api/alert/webhook` | POST | External alert webhook. |
| `GET /api/macro-bulletin` | GET | Macro bulletin data. |

- Thumbnail preview of the PDF page
- Editable fields before confirmation

Confirmed extractions are sent to `/api/cas/confirm`, which runs `validateCAS` and persists holdings in a single transaction (all-or-nothing).

### 5.5 `/portfolio/equity`

Dedicated equity allocation view showing:

- Equity percentage vs. age-based recommended band
- Sector / market-cap breakdown where available
- Large-cap, mid-cap, small-cap concentration

### 5.6 `/chat`

Conversational assistant backed by the orchestrator. The page:

1. Accepts a user message.
2. POSTs to `/api/chat/stream` with `text/event-stream` response type.
3. Receives SSE events: `status`, `agent`, `tool`, `citation`, `workspace_state`, `complete`.
4. Renders the live workspace panel (`components/agent-card.tsx`, `components/agent-activity-panel.tsx`).

The chat supports English and Hinglish (Devanagari script detection in `lib/orchestrator.ts`).

### 5.7 `/chat/audit` and `/chat/audit/safety`

Read-only audit views for recent conversations. Useful for debugging safety incidents and reviewing what the assistant actually said.

# Local development helpers
MOCK_LLM=true
ALLOW_LEGACY_DEV_USER=true
LOG_LEVEL=info
COOKIE_SECRET=change-me-to-a-random-string
```

See `.env.example` for the full variable list and descriptions.

### 4.4 Install and run

```bash
npm install
npm run db:migrate   # applies migrations + creates HNSW indexes
npm run dev          # http://localhost:3000
```

### 4.5 Verify your local setup

```bash
# Health checks
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/deep

# Run the test matrix
npx tsc --noEmit
npm run lint
npm run test:coverage -- --run
npm run build
```

> **Note:** `DATABASE_URL` and Azure OpenAI credentials are **not required at build time**. `lib/db.ts` and the Azure OpenAI client factories initialize lazily on first use, so `next build` succeeds even when these environment variables are missing.

├── tests/
│   ├── e2e/                # Playwright E2E tests
│   ├── eval/               # LLM eval suite
│   ├── integration/        # API route integration tests
│   └── unit/               # Unit tests
├── docs/                   # Documentation
│   ├── PRODUCTION_HANDOFF.md
│   ├── FINAL_REPORT.md
│   └── ...
├── .env.example            # Environment template
├── README.md               # This file
├── CLAUDE.md               # Contributor rules and conventions
└── package.json
```

| **Lazy DB / Azure client initialization** | `lib/db.ts` and the Azure OpenAI factories initialize on first use, so `next build` does not need `DATABASE_URL` or Azure credentials during static page generation. |
| **Standardized error envelope** | Every API route returns `{ ok, data }` or `{ ok, error }`. This unifies frontend error handling and observability. |
| **Proxy-based `db` export** | The Drizzle client is wrapped in a Proxy so tests can `vi.spyOn(db, 'update')` while still deferring pool creation. |
| **Server-side safety classifier** | A second LLM call classifies final output for advice-like language before it reaches the user. |
| **Strict-RAG with citations** | Fund explanations must be grounded in retrieved factsheet chunks; hallucinated numbers are refused. |
| **All-or-nothing CAS writes** | Partial extractions are never persisted, preventing a corrupt portfolio state. |

