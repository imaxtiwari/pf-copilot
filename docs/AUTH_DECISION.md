# Authentication Provider Decision

## Status

Accepted — implemented with Supabase Auth.

## Context

PF Copilot started with a placeholder dev-user scheme (`lib/auth/dev-user.ts`) that minted a year-long UUID cookie on first visit. There was no login, no session expiry, and no way to revoke access. Any request bearing a valid `pf_user_id` cookie could read any user's data because the application only checked cookie presence, not ownership.

The production target is Vercel + Supabase Postgres. We needed:

1. Real identity with password, OAuth, and OTP options.
2. Signed, short-lived sessions with server-side revocation.
3. Database-level authorization (RLS) as defense-in-depth.
4. A migration path for existing anonymous cookie users.

## Options Considered

| Provider | Ownership | Self-hosting | Cost | Lock-in | Integration effort |
|---|---|---|---|---|---|
| **Supabase Auth** | Open-source (GoTrue) | Can self-host GoTrue | Free tier generous; usage-based beyond | Medium — tied to Supabase Postgres/RLS | Low — same Postgres provider |
| **Clerk** | Proprietary | No | Generous free tier; seat-based pricing | High — SDKs and user data in Clerk | Very low — drop-in components |
| **Auth.js (NextAuth)** | Open-source | Self-hosted | Free (bring-your-own database) | Low — open protocols (OAuth/OIDC) | Medium — requires custom session store and RLS wiring |

## Decision

Use **Supabase Auth**.

### Rationale

- The application already runs on Supabase Postgres, so using the same provider for auth removes a second vendor, simplifies operations, and makes RLS policies that reference `auth.uid()` work out of the box.
- GoTrue is open-source, reducing vendor lock-in compared to Clerk. If we ever need to migrate, we can self-host GoTrue or export user identities.
- The `@supabase/ssr` package is purpose-built for Next.js App Router cookie-based sessions.
- RLS integration is native: Supabase sets the `authenticated` role and injects JWT claims automatically when using the Supabase client or PostgREST.

### Trade-offs

- Supabase Auth is not quite as polished as Clerk for pre-built UI components. We build our own login pages or use `@supabase/auth-ui-react`.
- Email deliverability for magic links/password reset requires configuring an SMTP provider or using Supabase's default limits.
- Moving away from Supabase later means migrating the `auth.users` table and replicating password hashes (which are not exportable). This is acceptable because user count is small and financial apps benefit from keeping identity close to the data.

## Implementation Notes

- `lib/auth/supabase.ts` creates server-side and middleware Supabase clients using `@supabase/ssr`.
- `lib/auth/user.ts` exposes `getCurrentUser()` and `requireAuth()`. Routes verify identity before processing and return `401` when unauthenticated.
- `users.legacy_user_id` stores the old dev UUID so existing holdings can be linked to a new Supabase identity during first login.
- `lib/db.ts` exposes `withAuthContext(userId, callback)`, which runs Drizzle queries inside a transaction that impersonates the Supabase `authenticated` role so RLS policies are enforced.
- RLS policies for `cas_uploads`, `portfolio_holdings`, `portfolio_snapshots`, `chat_messages`, `demat_holdings`, `portfolio_insights`, and `user_profile` restrict CRUD operations to `auth.uid() = user_id`.
