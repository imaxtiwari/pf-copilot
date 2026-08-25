import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { parseDematText } from '@/lib/demat/parse-text'

const FIXTURE_PATH = path.join(__dirname, '../fixtures/cas-sample.pdf')

describe('parseDematText', () => {
  it('extracts holdings from the synthetic demat fixture', async () => {
    const buffer = fs.readFileSync(FIXTURE_PATH)
    const result = await parseDematText(buffer)
    expect(result).toBeDefined()
  })

  it('returns null for non-PDF buffers', async () => {
    const result = await parseDematText(Buffer.from('not a pdf'))
    expect(result).toBeNull()
  })
})