# CLAUDE.md — Personal Finance Copilot
## What this is
An educational tool for Indian retail investors. Shows real returns (nominal minus personal inflation), explains mutual fund factsheets with strict citations from official AMFI factsheets. It does NOT give investment advice.
## Hard constraints (NEVER violate)
1. LLM provider: Azure OpenAI ONLY. Do not add Google Gemini, Anthropic, OpenAI direct, or any other provider.
2. No advice language EVER. The assistant never says "buy", "sell", "should", "recommend", "best fund", "good fund" in any output. See /lib/contracts/no-advice.ts.
3. Strict-RAG for fund explainer. The explain_fund agent must refuse-on-no-grounding. Every numeric claim must cite a chunk. See /lib/prompts/explain-fund.ts.
4. CAS validation gate is non-negotiable. Partial-write of holdings is forbidden. All-or-nothing per upload. See /lib/contracts/cas-validation.ts.
5. Deployment mode v1: localhost-only. No public URL, no auth, no rate limiting. Single user (you). Cloud + auth deferred to v2.
6. CAS PDF buffers are memory-only. Never persist the raw PDF to disk or blob. Free buffer after extraction completes.
## Stack lockdown
- Next.js 15 (app router) + TypeScript + Tailwind
- PostgreSQL 16 + pgvector (local Docker for v1)
- Drizzle ORM
- Azure OpenAI SDK (openai package, AzureOpenAI class) — GPT-4o, GPT-4o-mini, text-embedding-3-small
- pdf-parse (text extraction primary), pdf2pic (vision fallback)
- vitest (unit + eval tests), playwright (e2e)
- pino (structured logging)
- zod (runtime validation)
## File structure conventions
- /lib/contracts/ — invariants enforced across the codebase
- /lib/prompts/ — system prompts, versioned (every prompt exports { version, text, changelog })
- /lib/inflation/ — pure deterministic inflation engine
- /lib/cas/ — CAS PDF parsing
- /lib/rag/ — factsheet retrieval + strict-RAG agent
- /lib/tools/ — orchestrator tool definitions and handlers
- /lib/logger.ts — structured logger (pino)
- /db/schema.ts — Drizzle schema (read-only — don't add columns without explicit user direction)
- /app/api/ — all return ApiResponse<T> from /lib/contracts/error-envelope.ts
- /tests/unit/ — unit tests for pure functions
- /tests/eval/ — LLM eval cases
## Before making changes
1. Read this file.
2. Read the relevant contract in /lib/contracts/.
3. If touching a prompt: bump version, update changelog, expect eval suite to flag baselines.
4. If touching the schema: stop and ask user.
5. If touching the strict-RAG prompt: run npm run eval after.
## Testing convention
- Every pure function in /lib/inflation/ and /lib/cas/ gets unit tests.
- Every LLM surface gets eval cases.
- After any change touching /lib/prompts/ or /lib/contracts/, run npm run eval.
- Eval suite tracks model deployment name in results.
## What this product is NOT
- Not an advisor (education only)
- Not a brokerage, transaction platform, or portfolio manager
- Not multi-user (v1)
- Not deployed to a public URL (v1)
