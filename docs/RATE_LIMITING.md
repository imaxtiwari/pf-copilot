# Rate Limiting & Cost Budgets

This document describes the abuse-protection and cost-guardrails applied to PF Copilot.

## Backend choice

Production uses **Upstash Redis** (`@upstash/ratelimit` + `@upstash/redis`) via the REST API. The required environment variables are:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If these variables are not set, the application refuses to rate-limit in production (`success: false`, `429` response) rather than silently allow unlimited traffic. In local development and unit tests a deterministic, in-memory fallback is used; it is explicitly logged and is **not** suitable for production because state is not shared across serverless invocations.

## Limit values

| Endpoint | Scope | Limit | Window | Rationale |
|---|---|---|---|---|
| `POST /api/chat` | authenticated user | 20 requests | 60 s | Prevents a single user from monopolising GPT-4o-class capacity while allowing normal conversational use. |
| `POST /api/chat` | IP address | 60 requests | 60 s | Backstop for unauthenticated or cookie-cleared traffic. |
| `POST /api/chat/stream` | authenticated user | 20 requests | 60 s | Same limits as the synchronous chat endpoint. |
| `POST /api/chat/stream` | IP address | 60 requests | 60 s | Same backstop as the synchronous chat endpoint. |
| `POST /api/cas/ingest` | authenticated user | 5 uploads | 3600 s | CAS parsing uses vision/text extraction and is expensive; 5/hour is generous for a personal-finance use-case. |
| `POST /api/demat/ingest` | authenticated user | 5 uploads | 3600 s | Shares the same upload budget as CAS ingest. |
| `GET /api/health` | IP address | 60 requests | 60 s | Protects the cheap health probe from being used as a load generator. |

All file uploads are also capped at **10 MB** by existing middleware.

## Identifier resolution

The reusable `rateLimit` middleware resolves the caller identity in this order:

1. An explicitly supplied `identifier` (used by routes to pass `user:${userId}`).
2. The `pf_user_id` cookie if present (`user:${cookieValue}`).
3. A SHA-256 hash of `x-forwarded-for` (first entry) or `req.ip`, prefixed with `ip:`.

IP addresses are hashed so that logs and Redis keys do not store raw client IPs.

## Cost/token budgets

The orchestrator (`lib/orchestrator.ts`) now enforces a per-turn token budget:

- Default `maxTokensPerTurn`: **4,000 tokens**
- Default `maxToolIterations`: **5**

After each LLM call, `usage.total_tokens` is added to a cumulative counter. If the running total exceeds `maxTokensPerTurn`, the orchestrator throws `CostBudgetExceededError`. Both the synchronous chat route and the streaming chat route catch this error and:

1. Persist an assistant message in `chatMessages` with `refusalReason: 'cost_budget_exceeded'`.
2. Return a `429 Too Many Requests` response (JSON or SSE) with details containing `max_tokens` and `cumulative_tokens`.

These defaults can be overridden per-call through the optional `config` parameter exposed by `runOrchestrator` and `runOrchestratorWithEvents`.

## Response format

JSON routes return the standard error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 45 seconds.",
    "details": { "limit": 20, "window_seconds": 60 },
    "request_id": "<uuid>"
  }
}
```

The `Retry-After` header is always included when the value is finite.

Streaming routes return an SSE error line:

```
event: error
data: {"ok":false,"error":{"code":"rate_limit_exceeded",...}}
```

## Trade-off analysis

### Redis-backed vs Vercel KV vs in-memory

| Backend | State sharing | Accuracy | Operational cost | Best for |
|---|---|---|---|---|
| Upstash Redis (chosen) | Global, sub-10 ms | Sliding-window, per-key | Low free tier, scales with usage | Production serverless deployments |
| Vercel KV | Global | Comparable to Upstash | Included in some Vercel plans | Teams already committed to Vercel KV |
| In-memory | None (single instance) | Fixed-window, coarse | Free | Local development and deterministic unit tests only |

Upstash Redis was chosen because the project is already deployed on Vercel, the `@upstash/ratelimit` library provides a polished sliding-window implementation, and it introduces no additional infrastructure to operate. In-memory is deliberately restricted to non-production environments and fails closed in production.

### Hard token cut-off vs soft warning + continue

A **hard cut-off** is used for the per-turn token budget. The alternatives considered were:

- **Soft warning + continue**: the orchestrator could log a warning and keep calling the model. This preserves user experience but defeats the purpose of the guardrail when Azure OpenAI TPM/rate limits are at risk or when an unexpected tool-call loop starts burning tokens.
- **Hard cut-off**: immediately stops the turn, surfaces a refusal reason in the audit log, and returns a 429. This protects the LLM budget deterministically and gives the user actionable feedback.

The hard cut-off is the right default for production because the failure mode is bounded, observable, and recoverable (the user can ask a simpler question).
