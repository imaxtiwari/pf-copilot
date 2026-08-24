import { describe, it, expect } from 'vitest'
import { authorizeResourceOwner, isResourceOwner } from '@/lib/auth/authorization'

describe('authorizeResourceOwner', () => {
  it('does not throw when the current user owns the resource', () => {
    expect(() => authorizeResourceOwner('user-1', 'user-1')).not.toThrow()
  })

  it('throws ForbiddenError when the user does not own the resource', () => {
    expect(() => authorizeResourceOwner('user-1', 'user-2')).toThrow('You do not have permission')
    try {
      authorizeResourceOwner('user-1', 'user-2')
    } catch (e) {
      expect((e as Error).name).toBe('ForbiddenError')
    }
  })
})

describe('isResourceOwner', () => {
  it('returns true for matching ids', () => {
    expect(isResourceOwner('user-1', 'user-1')).toBe(true)
  })

  it('returns false for different ids', () => {
    expect(isResourceOwner('user-1', 'user-2')).toBe(false)
  })
})
