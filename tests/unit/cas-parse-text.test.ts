import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseCASText } from '@/lib/cas/parse-text'

const FIXTURE_PATH = path.join(__dirname, '../fixtures/cas-sample.pdf')

describe('parseCASText', () => {
  it('extracts holdings from the synthetic CAS fixture', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseCASText(buffer)
    expect(result).not.toBeNull()
    expect(result?.source).toBeDefined()
    expect(result?.holdings.length).toBeGreaterThan(0)
  })

  it('returns null for non-PDF buffers', async () => {
    const result = await parseCASText(Buffer.from('not a pdf'))
    expect(result).toBeNull()
  })
})