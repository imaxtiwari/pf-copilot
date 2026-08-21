import { describe, it, expect } from 'vitest'
import { buildContextWindow } from '@/lib/orchestrator'

describe('Token Budget Context Unit Tests', () => {
  it('30 short messages -> most included, total tokens <= 3000', () => {
    // 30 messages, 100 chars each (approx 25 tokens) -> total 750 tokens
    const messages = Array(30).fill(null).map((_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'A'.repeat(100)
    }))

    const result = buildContextWindow(messages)
    
    // Should include all 30
    expect(result.length).toBe(30)
    
    const tokens = result.reduce((acc, msg) => acc + Math.ceil(msg.content.length / 4), 0)
    expect(tokens).toBeLessThanOrEqual(3000)
  })

  it('3 very long messages -> oldest trimmed, last always included', () => {
    // DB returns newest first.
    const messages = [
      { role: 'user', content: 'A'.repeat(8000) }, // newest (2000 tokens)
      { role: 'assistant', content: 'A'.repeat(8000) }, // 2000 tokens
      { role: 'user', content: 'A'.repeat(8000) }, // oldest (2000 tokens)
    ]

    const result = buildContextWindow(messages)
    
    // First message (newest) takes 2000. Second message would put it at 4000 (> 3000). 
    // Since result.length is already > 0 (it has newest), it breaks.
    // So ONLY the newest message is included!
    expect(result.length).toBe(1)
    
    // Unshift means the first element is the oldest of the subset.
    // Since there's only 1, it's the newest.
    expect(result[0]).toEqual(messages[0])
  })

  it('Single message over budget alone -> still included (last always kept)', () => {
    const messages = [
      { role: 'user', content: 'A'.repeat(16000) } // newest (4000 tokens)
    ]

    const result = buildContextWindow(messages)
    
    // Tokens = 4000 > 3000, but result.length == 0 at the start of loop, so it does not break
    expect(result.length).toBe(1)
    expect(result[0]).toEqual(messages[0])
  })
})
