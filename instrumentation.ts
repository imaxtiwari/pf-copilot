import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

export async function register() {
  // Boot-time hooks removed with Option A (pipeline cleanup).
  // Migrations are run via `npm run db:migrate` before deploy.

  // Manual OpenTelemetry provider registration. Auto-instrumentation (e.g.
  // @vercel/otel) would cover more surface but adds per-request overhead and
  // vendor coupling. We register a minimal Node provider so explicit spans in
  // lib/tracing.ts have a live tracer; callers can attach an OTLP exporter by
  // setting OTEL_EXPORTER_OTLP_ENDPOINT and installing the relevant package.
  const provider = new NodeTracerProvider({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: 'pf-copilot',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
    }),
  })
  provider.register()
}

