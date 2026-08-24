/**
 * @deprecated The dev-user cookie pattern is replaced by Supabase Auth.
 * Use `getCurrentUser` or `requireAuth` from `lib/auth/user` instead.
 *
 * This file is kept as a thin compatibility shim during migration.
 */

export { getCurrentUser, requireAuth } from './user'
export { COOKIE_NAME, cookieOptions } from './legacy'
