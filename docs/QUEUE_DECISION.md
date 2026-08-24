# Job Queue Decision

## Decision

Use **Inngest** as the job queue for PF Copilot.

## Context

The application needs to move long-running work off Vercel serverless functions:

- Data ingestion (`ingest.amfi`, `ingest.factsheets`, `ingest.annualReports`) can
  take many minutes and currently only exists as CLI scripts.
- The DHRUV recommendation pipeline (`pipeline.phase1`, etc.) is referenced in
  documentation but was removed with Option A; it is not active and therefore
  not wired into the queue at this time.

## Options considered

### 1. Inngest

| Criterion | Assessment |
|-----------|------------|
| Vercel fit | Excellent — first-class Next.js app-router support, zero worker process on Vercel. |
| Idempotency | Built-in event idempotency via event IDs; plus we store `payloadHash` in `ingestion_runs`. |
| Retries | Declarative retry policy (exponential backoff, max attempts). |
| Local dev | `npx inngest-cli@latest dev` runs locally with the app; no Docker required. |
| Cost | Generous free tier; pay as you scale. |
| Lock-in | Moderate — functions are pure async code, so migration to another queue is possible. |

### 2. BullMQ on Redis

| Criterion | Assessment |
|-----------|------------|
| Vercel fit | Poor — requires a long-running worker process that Vercel functions cannot host. |
| Idempotency | Must be implemented manually with locks/deduplication. |
| Retries | Built-in but needs careful configuration. |
| Local dev | Requires Redis and a separate worker process. |
| Cost | Redis hosting cost + worker hosting cost. |
| Lock-in | Low, but operational burden is high. |

### 3. AWS SQS + Lambda

| Criterion | Assessment |
|-----------|------------|
| Vercel fit | Mediocre — introduces a second cloud provider and IAM setup. |
| Idempotency | Must implement deduplication manually. |
| Retries | Native DLQ support. |
| Local dev | Harder to emulate locally. |
| Cost | Low at scale but high complexity for a small team. |
| Lock-in | High to AWS. |

## Rationale

Inngest was chosen because:

1. It is designed for Vercel/Next.js and requires no persistent worker process.
2. It gives reliable retries and dead-letter handling out of the box.
3. It preserves a great local development experience.
4. The ingestion handlers remain plain async TypeScript functions, minimizing
   vendor lock-in.

## Implementation

- `lib/jobs/client.ts` — Inngest client singleton.
- `lib/jobs/definitions.ts` — Zod schemas for ingestion payloads.
- `lib/jobs/handlers/ingestion.ts` — idempotent handlers that update
  `ingestion_runs` atomically.
- `app/api/inngest/route.ts` — serves Inngest functions (GET/POST/PUT).
- `app/api/scheduler/route.ts` — HTTP endpoint that enqueues ingestion jobs.

## Retry and dead-letter policy

- Max 3 attempts with exponential backoff (Inngest default).
- After exhaustion the event is dead-lettered by Inngest and the
  `ingestion_runs` row is set to `FAILED` with the error message.

## Future work

- Wire `pipeline.phase1`, `pipeline.deliberation`, `pipeline.finalize` when
  Option B / the DHRUV pipeline is revived.
- Add a Vercel Cron job or external scheduler to `POST /api/scheduler` nightly.
- Add an OTLP metric for job enqueue/handle latency.
