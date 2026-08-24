/**
 * Verify that the current user is allowed to access a resource owned by
 * `resourceUserId`. This is the application-level ownership check used before
 * returning a resource fetched by ID (e.g., a CAS review session).
 *
 * RLS policies provide defense-in-depth at the database layer; this helper
 * provides a clear, early failure with an actionable HTTP status.
 *
 * @throws {Error} with `name === 'ForbiddenError'` if the user does not own the resource.
 */
export function authorizeResourceOwner(currentUserId: string, resourceUserId: string): void {
  if (currentUserId !== resourceUserId) {
    const error = new Error('You do not have permission to access this resource.')
    error.name = 'ForbiddenError'
    throw error
  }
}

export function isResourceOwner(currentUserId: string, resourceUserId: string): boolean {
  return currentUserId === resourceUserId
}
