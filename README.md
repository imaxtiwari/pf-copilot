# PF Copilot

Personal Finance Copilot for Indian retail investors.
**Educational tool — NOT investment advice.**

Shows real returns after personal inflation, explains mutual fund factsheets with strict citations from official AMFI factsheets, and parses Consolidated Account Statements (CAS) from NSDL/CDSL.

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
| `/api/health` | GET | Liveness check — DB + Azure OpenAI connectivity |
| `/api/me` | GET | Resolve or create dev user, return profile |
| `/api/onboarding` | POST | Upsert onboarding profile, compute inflation rate |
| `/api/portfolio/holdings` | GET | Return current holdings for the session user |
| `/api/portfolio/upload` | POST | Parse and validate a CAS PDF |
| `/api/chat` | POST | Single chat turn via the orchestrator |

---

## Architecture

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
- **`lib/cas/parse-vision.ts`** — GPT-4o vision fallback. Pages batched 10 at a time. Aborts if >50% of batches fail to prevent partial-portfolio writes.
- **`lib/cas/amfi-master.ts`** — single `LIKE ANY(ARRAY[...])` batch query to cross-check scheme names against the AMFI master table.

---

## Testing

```bash
npm test                     # vitest unit tests
npm run eval:setup           # generate golden CAS PDFs (run once)
npm run eval                 # LLM eval suite (requires .env.local + running DB)
npx playwright test          # e2e (requires running dev server)
```

Unit coverage: `lib/inflation/` (Fisher equation edge cases, weights, parse-return), `lib/rag/` (RAG contract validator).

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
