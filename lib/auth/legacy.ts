/**
 * Legacy cookie constants for the old dev-user authentication scheme.
 *
 * @deprecated These are kept only for migration path compatibility. New code
 * should rely on Supabase Auth session cookies managed by `@supabase/ssr`.
 */

export const COOKIE_NAME = 'pf_user_id'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  }
}
