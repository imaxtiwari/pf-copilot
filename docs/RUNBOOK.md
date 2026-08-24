# Production Runbook — Observability & Alerting

This document covers the observability surface added to PF Copilot: tracing,
metrics, cost tracking, data freshness, and alerting hooks.

## 1. Tracing

- **Implementation**: manual OpenTelemetry via `@opentelemetry/api` and a
  minimal `NodeTracerProvider` registered in `instrumentation.ts`.
- **Key file**: `lib/tracing.ts`
- **Spans created**:
  - `orchestrator.turn` — one per chat turn, trace id derived from `request_id`
  - `orchestrator.tool_dispatch` — each tool invocation
  - `rag.retrieve_chunks` / `rag.retrieve_stock_chunks` — RAG retrieval
  - `azure_openai.chat_completion` / `azure_openai.embedding` — external API calls

### Alerting thresholds

| Signal | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| `chat_latency_ms` p95 > 10 s | warning | Investigate slow tool/RAG paths |
| `chat_latency_ms` p95 > 25 s | critical | Page on-call; check Azure OpenAI latency |
| `azure_openai.embedding` error rate > 5 % | critical | Check Azure OpenAI health / quota |
| Any span `status=ERROR` from `orchestrator.turn` | warning | Correlate with `request_id` in logs |

## 2. Metrics

- **Backend**: structured Pino logs (`metric` field) by default. No vendor
  lock-in. Swap `MetricsClient.setBackend(...)` in `lib/metrics.ts` to plug in
  Vercel Analytics, Datadog, or a Prometheus pushgateway.
- **Emitted metrics**:
  - `chat_latency_ms` histogram
  - `chat_tokens_per_turn` histogram (labelled by `user_id`)
  - `chat_refusal_total` counter
  - `rag_citation_violation_total` counter
  - `cas_parse_success_total` / `cas_parse_failure_total` counters
  - `pipeline_stage_duration_ms` histogram (stub for future pipeline stages)

### Alerting thresholds

| Metric | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| `chat_refusal_total` rate > 10 % of turns | warning | Review safety classifier calibration |
| `rag_citation_violation_total` > 5 / hour | warning | Check RAG prompt/chunk quality |
| `cas_parse_failure_total` > 20 % | critical | Inspect CAS parser and vision fallback |
| `chat_tokens_per_turn` > 3 500 | warning | User nearing per-turn budget |

## 3. Cost tracking

- **Columns**: `users.monthly_tokens`, `users.monthly_cost`
- **Updated**: after every successful chat turn in `lib/orchestrator.ts`
- **Rate**: blended USD per 1k tokens, configurable via `TOKEN_COST_PER_1K_USD`
- **Reset**: not automatic; schedule a monthly job or SQL update to reset the
  counters.
- **Endpoint**: `GET /api/me/usage` returns current month usage.

### Alerting thresholds

| Signal | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| `monthly_cost` > $5 / user | warning | Notify user, consider rate-limit reduction |
| `monthly_cost` > $20 / user | critical | Hard block further turns until reset |

## 4. Data freshness

- **Columns**: `last_synced_at`, `freshness_days`, `is_stale` on
  `factsheet_chunks`, `stock_documents`, `portfolio_snapshots`
- **Logic**: `lib/freshness.ts` — `isStale()` returns true when age exceeds
  `freshness_days` or `is_stale` is true.
- **Defaults**: factsheets/stock docs 7 days, portfolio snapshots 1 day.
- **UI surface**:
  - `/portfolio` shows an amber banner listing stale scheme factsheets.
  - `/chat` highlights stale citation chips with ⚠ and a footer note.

### Alerting thresholds

| Signal | Threshold | Severity | Action |
|--------|-----------|----------|--------|
| `factsheet_chunks.is_stale` count > 100 | warning | Trigger AMFI/factsheet re-sync |
| `portfolio_snapshots.is_stale` for active user | warning | Re-run snapshot computation |
| Any citation served from a stale chunk | warning | Surface in UI; do not block response |

## 5. Alert webhook

- **Endpoint**: `POST /api/alert/webhook`
- **Auth**: `x-alert-secret` header, value from `ALERT_WEBHOOK_SECRET`
- **Payload**: `{ source?, severity: 'critical'|'warning'|'info', message, request_id? }`
- **Integration**: point Vercel Log Drains, Datadog monitors, or CloudWatch
  alarms at this URL. The route currently logs the alert; wire it to PagerDuty
  Events API v2 or Opsgenie when operational.

## 6. Correlation

Every log line in the chat path should include `request_id`. In traces, the
`request_id` is mapped to the OpenTelemetry `trace_id` so that logs and spans
share the same correlation key.

When debugging:
1. Find the failing `request_id` in application logs.
2. Search traces by the same hex `trace_id` (UUID with dashes removed).
3. Look for `metric` fields with matching `request_id` to reconstruct latency
   and token usage.
