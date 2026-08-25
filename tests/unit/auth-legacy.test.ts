import { describe, it, expect, vi } from 'vitest'
import { COOKIE_NAME, cookieOptions } from '@/lib/auth/legacy'

describe('legacy cookie constants', () => {
  it('exports the legacy cookie name', () => {
    expect(COOKIE_NAME).toBe('pf_user_id')
  })

  it('returns secure options in production and lax in development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const prodOptions = cookieOptions()
    expect(prodOptions.httpOnly).toBe(true)
    expect(prodOptions.sameSite).toBe('lax')
    expect(prodOptions.secure).toBe(true)

    vi.stubEnv('NODE_ENV', 'development')
    const devOptions = cookieOptions()
    expect(devOptions.secure).toBe(false)

    vi.unstubAllEnvs()
  })
})