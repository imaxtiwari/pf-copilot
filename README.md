# PF Copilot

Personal Finance Copilot for Indian retail investors.
**Educational tool — NOT investment advice.**

This platform calculates real returns adjusted for personal inflation, parses CDSL/NSDL Consolidated Account Statements (CAS), and runs a RAG-driven mutual fund factsheet explainer strictly grounded in official AMFI data. Additionally, it implements a sequential multi-agent advisory pipeline (consisting of DHRUV, KIRAN, VIKRAM, SOMA, PRIYA, and ARIA) that automates goal-based risk profiling, portfolio asset allocation, backtested fund selection, independent auditing, and committee deliberation.

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
| `/portfolio` | Holdings breakdown with nominal vs real 1-year returns after personal inflation. |
| `/portfolio/upload` | Upload a NSDL or CDSL CAS PDF. Text extraction first; GPT-4o vision fallback. All-or-nothing validation. |
| `/chat` | Conversational assistant backed by GPT-4o-mini. Tools: portfolio, inflation, real returns, fund explainer, chat history. |

## API routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Liveness check — DB + Azure OpenAI connectivity + Memory Usage |
| `/api/me` | GET | Resolve or create dev user, return profile |
| `/api/onboarding` | POST | Upsert onboarding profile, compute inflation rate |
| `/api/portfolio/holdings` | GET | Return current holdings for the session user |
| `/api/portfolio/upload` | POST | Parse and validate a CAS PDF |
| `/api/chat` | POST | Single chat turn via the orchestrator |
| `/api/pipeline/start` | POST | Start multi-agent advisory pipeline for a user |
| `/api/pipeline/[runId]/status` | GET | Check status, stage, and revision cycle of a pipeline run |
| `/api/pipeline/[runId]/interview` | POST | Submit Vikram's interview answers and trigger Phase 2 in background |
| `/api/pipeline/[runId]/deliberation` | GET | Retrieve deliberation room chat transcript/history for a run (persisted in `deliberation_messages` table with an in-memory cache) |
| `/api/pipeline/[runId]/result` | GET | Get the final portfolio package or deadlock report for a completed/deadlocked run (retrieved from `pipeline_results` table) |
| `/api/scheduler` | GET | Initialize or query the state and upcoming jobs of the agent scheduler |

---

## Architecture

### System Flow
```
Browser
  ├── /onboarding      → POST /api/onboarding → userProfile (DB)
  ├── /portfolio       → GET /api/portfolio/holdings
  │                       + DISTINCT ON factsheet_chunks (DB) → real-returns engine
  ├── /portfolio/upload → POST /api/portfolio/upload
  │                       → parseCAS (text path → vision fallback)
  │                       → validateCAS (all-or-nothing gate)
  │                       → crossCheckSchemes (single AMFI batch query)
  └── /chat            → POST /api/chat
                          → runOrchestrator (GPT-4o-mini, ≤5 tool iterations)
                               ├── get_portfolio
                               ├── compute_personal_inflation
                               ├── compute_real_returns
                               ├── lookup_chat_history
                               └── explain_fund → RAG (GPT-4o, strict grounding, 1-retry)
```

### Multi-Agent Advisory Pipeline
A sequential multi-agent advisory system orchestrating goal-based asset allocation and risk mitigation:

1. **DHRUV** (Agent Model Orchestrator & Committee Chair) - Manages the state machine (stages: `ONBOARDING` -> `KIRAN_RISK_PROFILE` -> `VIKRAM_INTERVIEW` -> `VIKRAM_GOAL_ASSESSMENT` -> `SOMA_FUND_UNIVERSE` -> `VIKRAM_STRATEGY` -> `KIRAN_HEDGE_MAP` -> `PRIYA_BUILD` -> `DELIBERATION` -> `COMMITTEE_VOTE` -> `APPROVED`/`DEADLOCKED`).
2. **KIRAN** (Macro & Risk Profile) - Checks portfolio risk/macro scan and builds the asset allocation hedge map.
3. **VIKRAM** (Client Goal Evaluator) - Conducts a structured goal interview and evaluates achievability of the target corpus.
4. **SOMA** (Fund Universe Filter) - Screens Indian mutual fund schemas against direct/index criteria and AMFI master lists.
5. **PRIYA** (Portfolio Constructor) - Performs backtests and final portfolio optimization.
6. **ARIA** (Independent Audit Officer) - Audits selected portfolios for critical compliance and risk faults.

```
                  [Start Pipeline]
                         │
                  (Onboarding Info)
                         ▼
             [KIRAN: Risk Profiling]
                         │
             [VIKRAM: Goal Interview] ◄─── (Wait for User Answers)
                         │
           [VIKRAM: Goal Achievability]
                         │
             [SOMA: Fund Filtering]
                         │
            [VIKRAM: Target Strategy]
                         │
              [KIRAN: Hedge Mapping]
                         │
            [PRIYA: Portfolio Build & BT]
                         │
               [Deliberation Room]
             (Joint Multi-Agent Chat)
                         │
              [Committee Vote / Audit]
              ARIA / KIRAN / VIKRAM Vote
             (DHRUV resolved deadlock)
               /                  \
   (Fail/Crit Fault / Reject)    (Passes Audit & Vote)
             ▼                      ▼
      [Revision Cycle]       [APPROVED Portfolio]
       (Max 5 Cycles)
```

#### Committee Voting Rules
* **Voters**: ARIA, KIRAN, and VIKRAM vote. PRIYA abstains. DHRUV votes only as a tiebreaker.
* **Approval Condition**: Requires a 2/3 majority (at least 2 votes) **AND** 0 CRITICAL compliance faults from ARIA **AND** `overall_hedge_coverage_pct >= 80%` on Kiran's HedgeMap.
* **Automatic Rejection**: A single `CRITICAL` fault from ARIA triggers an automatic reject/revision, bypassing vote counts.
* **Deadlock**: Triggers on revision cycle 5 if approval conditions aren't met.

### Agent Scheduler
Background macro scanning and data checking are automated using `node-cron` routines managed by `lib/scheduler/agent-scheduler.ts` and triggered on startup or via `/api/scheduler`:
- `0 7 * * *`   → `kiran.runDailyMacroScan()` (Daily macro scan — every morning at 7:00 AM)
- `0 6 * * 0`   → `soma.runWeeklySweep()` (Weekly sweep — every Sunday 6:00 AM)
- `0 8 * * 1`   → `aria.runWeeklyResearch()` (Weekly audit research — every Monday 8:00 AM)
- `0 8 * * 2`   → `vikram.runWeeklyResearch()` (Weekly client research — every Tuesday 8:00 AM)
- `0 8 * * 3`   → `priya.runWeeklyResearch()` (Weekly backtest research — every Wednesday 8:00 AM)
- `0 8 * * 4`   → `dhruv.runWeeklyResearch()` (Weekly governance research — every Thursday 8:00 AM)
- `0 10 * * 5`  → `dhruv.runWeeklyConsolidation()` (Weekly knowledge consolidation — every Friday 10:00 AM)

### Key invariants

- **No advice language** — `FORBIDDEN_IN_ASSISTANT_OUTPUT` in `lib/contracts/no-advice.ts` blocks "buy", "sell", "invest in", "should", "recommend", and related phrases.
- **Strict-RAG** — every numeric claim in an `explain_fund` response must cite a retrieved chunk ID. Responses failing the contract are retried once, then refused.
- **CAS all-or-nothing** — `validateCAS` gates every upload. Partial writes are forbidden.
- **Azure OpenAI only** — no other LLM providers.

---

## Inflation engine

`lib/inflation/` is a pure deterministic module with no I/O:

- **`compute.ts`** — weighted sleeve model (general / medical / education / lifestyle). Confidence: low (default) → medium (partial profile) → high (full profile).
- **`real-returns.ts`** — Fisher equation: `real = (1+nominal)/(1+inflation) − 1`. Guards for `inflation ≤ −1` (returns `Infinity` or `NaN`).
- **`parse-return.ts`** — extracts 1-year return from factsheet chunk text. Handles `%` suffix and bare-number table cell formats.

---

## CAS parsing

- **`lib/cas/parse-text.ts`** — primary path. Regex-based extraction from NSDL/CDSL text PDFs.
- **`lib/cas/parse-vision.ts`** — GPT-4o vision fallback. Pages processed sequentially to avoid memory leaks. Aborts if >50% of batches fail to prevent partial-portfolio writes.
- **`lib/cas/amfi-master.ts`** — single `LIKE ANY(ARRAY[...])` batch query to cross-check scheme names against the AMFI master table.

---

## Testing

```bash
npm test                     # vitest unit tests
npm run eval:setup           # generate golden CAS PDFs (run once)
npm run eval                 # LLM eval suite (requires .env.local + running DB)
npx playwright test          # e2e tests
```

### Running E2E Tests
1. Ensure server is running: `npm run dev`
2. Ensure `/api/health` returns 200 (all systems ready)
3. Run the Niti Gupta Persona E2E: `npx tsx scripts/run-niti-gupta-e2e.ts`
4. To test drift detection: run the script with `DRIFT_TEST=true npx tsx scripts/run-niti-gupta-e2e.ts`
5. To force vision fallback: `FORCE_VISION=true npx tsx scripts/run-niti-gupta-e2e.ts`

### Mocking and Local Testing
* **Mock Azure OpenAI**: `tests/mocks/azure-openai.mock.ts` provides mock implementations for all Azure OpenAI ChatCompletion and Embedding calls.
* **Qdrant Mocking**: When running with `MOCK_LLM=true` (set in `.env.local`), a `MockQdrantClient` in `lib/memory/memory-store.ts` handles all vector operations locally without requiring a running Qdrant instance.
* **Unit Coverage**: Pure function tests for inflation computation, CAS parsing, agent voting logic, state-machine transitions, and RAG validators.

---

## Environment variables

See `.env.example` for the full list. Required at startup (missing `DATABASE_URL` throws immediately):

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pf_copilot
AZURE_OPENAI_ENDPOINT=https://<your-resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<your-key>
AZURE_OPENAI_DEPLOYMENT_GPT4O=gpt-4o
AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI=gpt-4o-mini
AZURE_OPENAI_DEPLOYMENT_EMBEDDING=text-embedding-3-small
AMFI_NAV_URL=https://www.amfiindia.com/spages/NAVAll.txt
```

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · PostgreSQL 16 + pgvector · Drizzle ORM · Azure OpenAI SDK · pino · zod · vitest · playwright

See `CLAUDE.md` for full constraints, conventions, and hard rules for contributors.
