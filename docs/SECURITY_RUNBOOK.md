# PF Copilot — Security Runbook

This document describes how to manage secrets, rotate credentials, and prevent accidental mock-LLM or PII leaks in production.

---

## 1. Secrets Hygiene

### 1.1 Files that must never be committed

- `.env.local`
- `.env.development.local`
- `.env.test.local`
- `.env.production.local`
- Any `.pem`, `.key`, or service-account JSON files.

These patterns are already in `.gitignore`.

### 1.2 Setting up local environment

```bash
cp .env.example .env.local
# Edit .env.local with real credentials
```

### 1.3 Pre-commit secret scan

We use **gitleaks** via **lefthook**.

Install gitleaks:

```bash
# macOS
brew install gitleaks

# Or download a release from https://github.com/gitleaks/gitleaks/releases
```

Install lefthook:

```bash
npm install -g lefthook
# or
brew install lefthook
```

Install the git hooks:

```bash
lefthook install
```

From now on every commit is scanned with:

```bash
gitleaks protect --staged
```

If a secret is detected, the commit is blocked. Remove the secret, rotate it, and commit again.

### 1.4 Why gitleaks instead of trufflehog

| Tool | Pros | Cons |
|------|------|------|
| **gitleaks** | Very fast on staged files; simple `protect --staged` mode designed exactly for pre-commit; low false positives for generic API keys. | Smaller built-in ruleset than TruffleHog; no entropy verification by default. |
| **trufflehog** | Larger ruleset; verifies many secrets against live APIs; can scan git history deeply. | Slower; verification can leak attempted probes; heavier dependency in CI. |

We chose **gitleaks** for the pre-commit hook because it is fast, deterministic, and purpose-built for the `protect --staged` use case. TruffleHog is recommended for periodic historical scans in CI.

---

## 2. Credential Rotation

### 2.1 Azure OpenAI

1. In Azure OpenAI Studio, open the target resource.
2. Go to **Keys and Endpoint** → regenerate **Key 1** or **Key 2**.
3. Copy the new key.
4. Update the production secret store (e.g. Vercel Dashboard → Project → Environment Variables).
5. Redeploy.
6. After deployment is healthy, regenerate the unused key to fully revoke the old key.

### 2.2 Database (DATABASE_URL)

1. In your Postgres provider (e.g. Supabase, Neon, AWS RDS), rotate the connection password.
2. Update `DATABASE_URL` in the production secret store.
3. Redeploy.

### 2.3 Cookie secret

1. Generate a new random string.
2. Update `COOKIE_SECRET` in the production secret store.
3. Redeploy. Active sessions will be invalidated, which is expected.

### 2.4 After suspected exposure

1. Immediately rotate the exposed credential at the provider.
2. Run `gitleaks detect --source . --verbose` and `trufflehog git file://.` to check for other leaks.
3. If the secret reached Git history, follow the provider's emergency revoke process and consider rewriting history with `git filter-repo`.
4. Document the incident and the rotated credential in the incident log.

---

## 3. Mock-LLM Guardrails

Production code must never use mock LLM implementations.

- `lib/azure-openai.ts` checks `process.env.NODE_ENV === 'production'` before honoring `MOCK_LLM=true` or missing keys.
- `lib/memory/memory-store.ts` checks the same condition before instantiating the mock Qdrant client.
- If production detects a mock selection attempt, it throws a clear error at startup or first use.

### 3.1 Local testing

In local/test environments, `MOCK_LLM=true` still works so that unit tests and demos do not require live Azure keys. Tests prove that production mode blocks mocks.

---

## 4. PII Redaction in Logs

`lib/logger.ts` redacts the following fields wherever they appear in logged objects:

- `password`
- `token`
- `apiKey`
- `authorization`
- `pan`
- `aadhaar`
- `accountNumber`
- `ifsc`
- `marketValue`
- `units`
- `chatMessages.content`

Redaction replaces the value with `[REDACTED]`. Add new fields to the redaction list if the product starts logging additional PII or sensitive data.

---

## 5. Health Checks

- `/api/health` performs a cheap DB ping and, if configured, a lightweight vector check. It does not call any LLM and is safe for load balancers.
- `/api/health/deep` calls Azure OpenAI chat and embedding. It is protected by an `Authorization` header matching `HEALTH_DEEP_TOKEN`. Keep the token in the secret store and rotate it like any API key.

---

## 6. Scheduler Self-Trigger Removal

The application no longer triggers `/api/scheduler` from `app/layout.tsx`. On Vercel, the scheduler is invoked by a Cron declaration in `vercel.json`.

If the scheduler route is removed in the future, delete the corresponding `crons` entry from `vercel.json`.

---

## 8. Authentication & Authorization

### 8.1 Identity Provider

PF Copilot uses **Supabase Auth** (GoTrue) for identity. Session cookies are managed by `@supabase/ssr` and are bound to the request lifecycle.

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, for admin operations if needed)

See `docs/AUTH_DECISION.md` for the provider comparison and rationale.

### 8.2 Row Level Security (RLS)

All user-scoped tables have RLS enabled with policies that allow only `auth.uid() = user_id`:

- `cas_uploads`
- `portfolio_holdings`
- `portfolio_snapshots`
- `chat_messages`
- `demat_holdings`
- `portfolio_insights`
- `user_profile`

Production code should rely on `lib/db.ts` → `withAuthContext(userId, callback)` or on the Supabase Data API (PostgREST) so that RLS policies are evaluated. Application-level ownership checks (`lib/auth/authorization.ts`) are used for early failure and clearer error messages.

### 8.3 Legacy user migration

The `users.legacy_user_id` column stores the old dev UUID. After a user signs in via Supabase for the first time, call `linkLegacyUserId(supabaseUserId, legacyUserId)` to associate prior anonymous data with the verified identity.

The legacy dev-user fallback is gated by `ALLOW_LEGACY_DEV_USER=true` and is disabled in production.

### 8.4 Credential rotation

#### Supabase anon / service role keys

1. In the Supabase Dashboard → Project Settings → API, regenerate the affected key.
2. Update the corresponding environment variable in Vercel.
3. Redeploy.
4. If the service role key was exposed, audit any admin operations executed with it.

#### Supabase Auth signing secret / JWT secret

1. In the Supabase Dashboard → Project Settings → Auth, regenerate the JWT secret.
2. All active sessions will be invalidated; users must sign in again.
3. Update any server-side JWT verification code if it pins the secret.

### 8.5 Incident response

If unauthorized access is suspected:

1. Rotate the Supabase service role key and JWT secret immediately.
2. Review Supabase Auth logs for anomalous sign-ins or token usage.
3. Query affected tables by `user_id` to scope potential data exposure.
4. If a specific user's session is compromised, revoke refresh tokens for that user in the Supabase Dashboard.
5. Document findings and rotate any secondary credentials (Azure OpenAI, database) if exposure is confirmed.

## 7. Trade-off Analysis

### 7.1 Polling health check vs push-based health metrics

| Approach | Pros | Cons |
|---|---|---|
| **Polling (`/api/health`)** | Simple to configure on any load balancer or uptime monitor; works out of the box on Vercel/Kubernetes; cheap to implement. | Adds request load; only tells you the probe interval saw health. |
| **Push-based metrics** | Rich telemetry, trends, and alerts; no probe traffic; ideal for observability platforms. | Requires an agent/collector and separate alerting setup; more infrastructure. |

`/api/health` uses a cheap DB ping (and an optional lightweight vector check) because liveness/readiness probes do not need business-level telemetry. A failed DB ping means the app cannot serve requests, which is exactly what a load balancer needs to know. Push-based metrics are recommended as a complement, not a replacement, for probe endpoints.

### 7.2 Compile-time mock removal vs runtime guard

| Approach | Pros | Cons |
|---|---|---|
| **Compile-time removal** (e.g. `if (process.env.NODE_ENV === 'production')` tree-shaken by bundler) | Guarantees mock code is absent from production bundles; smallest attack surface. | Harder to test; must build separately for each environment; less explicit failure mode if misconfigured. |
| **Runtime guard** | Fails loudly in production with a clear error; keeps local/test mock behavior intact; easier to verify with unit tests. | Mock code is still present in the bundle (though unreachable). |

We use runtime guards because they give a deterministic, testable failure when production is misconfigured, while preserving the local developer experience. The guards throw immediately on mock selection so the failure cannot be silently ignored.

