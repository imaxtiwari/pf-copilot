import logger from './logger'

/**
 * Lightweight metrics facade.
 *
 * Backend choice:
 * - Default: structured Pino logs with a `metric` field. These can be scraped
 *   by any log aggregator (Datadog, Grafana Loki, Google Cloud Logging) to
 *   produce dashboards and alerts without vendor lock-in.
 * - Vercel Analytics: swap `emitMetric` for `@vercel/analytics/server` when
 *   dashboarding inside Vercel is required. Structured logs are kept as an
 *   audit trail.
 * - External APM: a Datadog/StatsD or Prometheus pushgateway client can be
 *   injected via `MetricsClient.setBackend(...)` without changing callers.
 *
 * Trade-offs: structured logging has near-zero runtime overhead and is
 * queryable, but lacks built-in percentile aggregation. For p50/p95 we rely on
 * log-backed histograms or export to an APM that computes percentiles.
 */

export type MetricValue = string | number | boolean | undefined
export type MetricLabels = Record<string, MetricValue>

export type MetricEvent = {
  name: string
  type: 'histogram' | 'counter' | 'gauge'
  value: number
  labels: Record<string, string | number | boolean>
}

export type MetricsBackend = (event: MetricEvent) => void

const noOpBackend: MetricsBackend = () => {}

class MetricsClient {
  private backend: MetricsBackend = noOpBackend

  setBackend(backend: MetricsBackend) {
    this.backend = backend
  }

  private emit(type: MetricEvent['type'], name: string, value: number, labels?: MetricLabels) {
    const cleaned: Record<string, string | number | boolean> = {}
    if (labels) {
      for (const [k, v] of Object.entries(labels)) {
        if (v === undefined) continue
        cleaned[k] = v
      }
    }
    logger.info({ metric: { type, name, value, labels: cleaned } }, `metric: ${name}`)
    this.backend({ type, name, value, labels: cleaned })
  }

  histogram(name: string, value: number, labels?: MetricLabels) {
    this.emit('histogram', name, value, labels)
  }

  counter(name: string, value: number, labels?: MetricLabels) {
    this.emit('counter', name, value, labels)
  }

  gauge(name: string, value: number, labels?: MetricLabels) {
    this.emit('gauge', name, value, labels)
  }
}

export const metrics = new MetricsClient()

// ── Domain-specific metric helpers ────────────────────────────────────────────

export function emitChatLatencyMs(ms: number, labels?: MetricLabels) {
  metrics.histogram('chat_latency_ms', ms, labels)
}

export function emitTokensUsed(tokens: number, userId: string, labels?: MetricLabels) {
  metrics.histogram('chat_tokens_per_turn', tokens, { user_id: userId, ...labels })
}

export function emitRefusal(labels?: MetricLabels) {
  metrics.counter('chat_refusal_total', 1, labels)
}

export function emitCitationViolation(labels?: MetricLabels) {
  metrics.counter('rag_citation_violation_total', 1, labels)
}

export function emitCasParseSuccess(source: 'text' | 'vision', labels?: MetricLabels) {
  metrics.counter('cas_parse_success_total', 1, { source, ...labels })
}

export function emitCasParseFailure(source: 'text' | 'vision' | 'none', labels?: MetricLabels) {
  metrics.counter('cas_parse_failure_total', 1, { source, ...labels })
}

export function emitPipelineStageDuration(stage: string, ms: number, labels?: MetricLabels) {
  metrics.histogram('pipeline_stage_duration_ms', ms, { stage, ...labels })
}
