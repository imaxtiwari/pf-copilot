import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('mock LLM guards in production', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
        vi.resetModules()
        process.env = { ...originalEnv }
    })

    afterEach(() => {
        process.env = originalEnv
    })

    it('getGpt4oMini throws in production when MOCK_LLM=true', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
        process.env.MOCK_LLM = 'true'
        process.env.AZURE_OPENAI_API_KEY = 'real-key'

        const { getGpt4oMini } = await import('@/lib/azure-openai')
        expect(() => getGpt4oMini()).toThrow(/Mock LLM selection attempted in production/)
    })

    it('getGpt4oMini throws in production when AZURE_OPENAI_API_KEY is missing', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
        delete process.env.MOCK_LLM
        delete process.env.AZURE_OPENAI_API_KEY

        const { getGpt4oMini } = await import('@/lib/azure-openai')
        expect(() => getGpt4oMini()).toThrow(/Mock LLM selection attempted in production/)
    })

    it('getEmbedding throws in production when MOCK_LLM=true', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
        process.env.MOCK_LLM = 'true'
        process.env.AZURE_OPENAI_API_KEY = 'real-key'

        const { getEmbedding } = await import('@/lib/azure-openai')
        await expect(getEmbedding('test')).rejects.toThrow(/Mock LLM selection attempted in production/)
    })

    it('mock client is usable in non-production when MOCK_LLM=true and key is missing', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'test'
        process.env.MOCK_LLM = 'true'
        delete process.env.AZURE_OPENAI_API_KEY

        const { getGpt4oMini } = await import('@/lib/azure-openai')
        const client = getGpt4oMini()
        const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'hello' }],
        })
        expect(response.choices[0].message.content).toBeDefined()
    })

    it('qdrant throws in production when MOCK_LLM=true on first use', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
        process.env.MOCK_LLM = 'true'
        process.env.QDRANT_URL = 'http://real-qdrant.example.com'

        const { qdrant } = await import('@/lib/memory/memory-store')
        expect(() => qdrant.getCollections()).toThrow(/Mock Qdrant client selection attempted in production/)
    })

    it('qdrant throws in production when QDRANT_URL defaults to localhost', async () => {
        ; (process.env as Record<string, string | undefined>).NODE_ENV = 'production'
        delete process.env.MOCK_LLM
        delete process.env.QDRANT_URL

        const { qdrant } = await import('@/lib/memory/memory-store')
        expect(() => qdrant.getCollections()).toThrow(/QDRANT_URL is not configured in production/)
    })
})
