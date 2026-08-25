import { describe, it, expect } from 'vitest'
import { getCurrentUser, requireAuth, COOKIE_NAME, cookieOptions } from '@/lib/auth/dev-user'

describe('auth/dev-user compatibility shim', () => {
  it('re-exports auth helpers', () => {
    expect(typeof getCurrentUser).toBe('function')
    expect(typeof requireAuth).toBe('function')
  })

  it('re-exports legacy cookie constants', () => {
    expect(COOKIE_NAME).toBe('pf_user_id')
    expect(typeof cookieOptions()).toBe('object')
  })
})