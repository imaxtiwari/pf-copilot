import { describe, it, expect } from 'vitest'
import { redactSensitive } from '@/lib/logger'

describe('redactSensitive', () => {
    it('redacts top-level sensitive fields', () => {
        const input = {
            userId: 'user-1',
            password: 'super-secret',
            apiKey: 'ak_live_123',
            pan: 'ABCDE1234F',
            aadhaar: '1234-5678-9012',
            accountNumber: '1234567890',
            ifsc: 'HDFC0001234',
        }
        const output = redactSensitive(input) as Record<string, unknown>

        expect(output.userId).toBe('user-1')
        expect(output.password).toBe('[REDACTED]')
        expect(output.apiKey).toBe('[REDACTED]')
        expect(output.pan).toBe('[REDACTED]')
        expect(output.aadhaar).toBe('[REDACTED]')
        expect(output.accountNumber).toBe('[REDACTED]')
        expect(output.ifsc).toBe('[REDACTED]')
    })

    it('redacts nested sensitive fields', () => {
        const input = {
            meta: {
                token: 'bearer-token',
                authorization: 'Basic abc',
                nested: { marketValue: 12345, units: 99.5 },
            },
        }
        const output = redactSensitive(input) as any

        expect(output.meta.token).toBe('[REDACTED]')
        expect(output.meta.authorization).toBe('[REDACTED]')
        expect(output.meta.nested.marketValue).toBe('[REDACTED]')
        expect(output.meta.nested.units).toBe('[REDACTED]')
    })

    it('redacts chat message content while preserving role', () => {
        const input = {
            chatMessages: [
                { role: 'user', content: 'What is my PAN?' },
                { role: 'assistant', content: 'Here is your balance.' },
            ],
        }
        const output = redactSensitive(input) as any

        expect(output.chatMessages[0].role).toBe('user')
        expect(output.chatMessages[0].content).toBe('[REDACTED]')
        expect(output.chatMessages[1].role).toBe('assistant')
        expect(output.chatMessages[1].content).toBe('[REDACTED]')
    })

    it('redacts content objects with a role field anywhere', () => {
        const input = {
            payload: { role: 'user', content: 'hello' },
        }
        const output = redactSensitive(input) as any
        expect(output.payload.role).toBe('user')
        expect(output.payload.content).toBe('[REDACTED]')
    })

    it('does not redact ordinary strings or numbers', () => {
        const input = {
            status: 'ok',
            count: 42,
            visible: 'this is fine',
        }
        const output = redactSensitive(input) as any
        expect(output.status).toBe('ok')
        expect(output.count).toBe(42)
        expect(output.visible).toBe('this is fine')
    })
})
