import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as healthGet } from '@/app/api/health/route'
import { GET as deepHealthGet } from '@/app/api/health/deep/route'
import { db } from '@/lib/db'

vi.mock('@/lib/db', () => ({
    db: {
        execute: vi.fn(),
    },
}))

vi.mock('@/lib/azure-openai', () => ({
    getGpt4oMini: vi.fn(),
    getEmbedding: vi.fn(),
}))

const createRequest = (authHeader?: string) => {
    const headers = new Headers()
    if (authHeader) headers.set('authorization', authHeader)
    return new NextRequest('http://localhost', { headers })
}

describe('/api/health', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        delete process.env.QDRANT_URL
    })

    afterEach(() => {
        delete process.env.QDRANT_URL
    })

    it('returns healthy when DB ping succeeds and no QDRANT_URL is set', async () => {
        vi.mocked(db.execute).mockResolvedValueOnce([{ '?column?': 1 }] as any)

        const res = await healthGet(createRequest())
        const json = await res.json()

        expect(res.status).toBe(200)
        expect(json.ok).toBe(true)
        expect(json.data.checks.db).toBe(true)
        expect(json.data.checks.vector).toBeNull()
        expect(json.data.checks.vector_dimension).toBeNull()
    })

    it('returns 503 when DB ping fails', async () => {
        vi.mocked(db.execute).mockRejectedValueOnce(new Error('connection refused'))

        const res = await healthGet(createRequest())
        const json = await res.json()

        expect(res.status).toBe(503)
        expect(json.ok).toBe(false)
        expect(json.error.code).toBe('health_check_failed')
    })

    it('includes vector check when QDRANT_URL is configured', async () => {
        process.env.QDRANT_URL = 'http://localhost:6333'
        vi.mocked(db.execute).mockResolvedValueOnce([{ '?column?': 1 }] as any)
        global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)

        const res = await healthGet(createRequest())
        const json = await res.json()

        expect(res.status).toBe(200)
        expect(json.data.checks.vector).toBe(true)
        expect(json.data.checks.vector_dimension).toBe(true)
    })

    it('still returns healthy if vector connectivity fails but DB is up', async () => {
        process.env.QDRANT_URL = 'http://localhost:6333'
        vi.mocked(db.execute).mockResolvedValueOnce([{ '?column?': 1 }] as any)
        global.fetch = vi.fn().mockRejectedValue(new Error('qdrant down'))

        const res = await healthGet(createRequest())
        const json = await res.json()

        expect(res.status).toBe(200)
        expect(json.data.checks.db).toBe(true)
        expect(json.data.checks.vector).toBe(false)
        expect(json.data.checks.vector_dimension).toBe(true)
    })

    it('returns 503 when Qdrant embedding dimension is mismatched', async () => {
        process.env.QDRANT_URL = 'http://localhost:6333'
        process.env.QDRANT_COLLECTIONS = 'factsheet_chunks'
        process.env.EMBEDDING_DIMENSION = '1536'
        vi.mocked(db.execute).mockResolvedValueOnce([{ '?column?': 1 }] as any)
        global.fetch = vi.fn().mockImplementation((url: string) => {
            if (url.endsWith('/collections')) {
                return Promise.resolve({ ok: true, status: 200 } as Response)
            }
            // /collections/factsheet_chunks
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    result: { config: { params: { vectors: { size: 3072 } } } },
                }),
            } as Response)
        })

        const res = await healthGet(createRequest())
        const json = await res.json()

        expect(res.status).toBe(503)
        expect(json.error.details.checks.vector).toBe(true)
        expect(json.error.details.checks.vector_dimension).toBe(false)
        expect(json.error.details.errors.some((e: string) => e.includes('3072'))).toBe(true)

        delete process.env.QDRANT_COLLECTIONS
        delete process.env.EMBEDDING_DIMENSION
    })
})

describe('/api/health/deep', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        delete process.env.HEALTH_DEEP_TOKEN
            ; (process.env as Record<string, string | undefined>).NODE_ENV = 'test'
    })

    afterEach(() => {
        delete process.env.HEALTH_DEEP_TOKEN
    })

    it('returns 401 without authorization', async () => {
        process.env.HEALTH_DEEP_TOKEN = 'secret-token'
        const req = createRequest()
        const res = await deepHealthGet(req)
        expect(res.status).toBe(401)
    })

    it('returns 401 with wrong token', async () => {
        process.env.HEALTH_DEEP_TOKEN = 'secret-token'
        const req = createRequest('wrong-token')
        const res = await deepHealthGet(req)
        expect(res.status).toBe(401)
    })

    it('returns healthy when LLM checks pass', async () => {
        process.env.HEALTH_DEEP_TOKEN = 'secret-token'
        const { getGpt4oMini, getEmbedding } = await import('@/lib/azure-openai')
        vi.mocked(getGpt4oMini).mockReturnValueOnce({
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValueOnce({
                        choices: [{ message: { content: 'OK' } }],
                    }),
                },
            },
        } as any)
        vi.mocked(getEmbedding).mockResolvedValueOnce(Array(3072).fill(0.1))

        const req = createRequest('Bearer secret-token')
        const res = await deepHealthGet(req)
        const json = await res.json()

        expect(res.status).toBe(200)
        expect(json.ok).toBe(true)
        expect(json.data.checks.azure_chat).toBe(true)
        expect(json.data.checks.azure_embedding).toBe(true)
    })
})
