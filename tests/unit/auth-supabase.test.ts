// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockCreateServerClient = vi.hoisted(() => vi.fn())

vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [{ name: 'sb-access-token', value: 'token' }],
    set: vi.fn(),
    get: vi.fn(),
  }),
}))

import { createClient, createMiddlewareClient } from '@/lib/auth/supabase'

describe('createClient', () => {
  beforeEach(() => {
    mockCreateServerClient.mockReset()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })

  it('creates a server client with cookie helpers', async () => {
    mockCreateServerClient.mockReturnValue({ auth: { getUser: vi.fn() } })
    const client = await createClient()
    expect(client).toBeDefined()
    expect(mockCreateServerClient).toHaveBeenCalled()
  })

  it('throws when Supabase env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    await expect(createClient()).rejects.toThrow('Missing NEXT_PUBLIC_SUPABASE_URL')
  })
})

describe('createMiddlewareClient', () => {
  it('creates a middleware client bound to request/response cookies', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mockCreateServerClient.mockReturnValue({ auth: { getUser: vi.fn() } })

    const request = new NextRequest('http://localhost/')
    const response = NextResponse.next()
    const client = createMiddlewareClient(request, response)
    expect(client).toBeDefined()
    expect(mockCreateServerClient).toHaveBeenCalled()
  })
})