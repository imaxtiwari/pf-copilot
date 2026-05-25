import type { FactsheetSection } from '../validation/schemas'

export type Chunk = {
  section: FactsheetSection
  text: string
}

const MIN_CHARS = 50
const MAX_CHARS = 1500 // keep well under PostgreSQL B-tree index row limit

const SECTION_PATTERNS: Array<{ pattern: RegExp; section: FactsheetSection }> = [
  {
    pattern: /top\s*10\s*holdings|portfolio\s+holdings|portfolio\s+composition|holding\s*\(%\)/i,
    section: 'holdings',
  },
  {
    pattern: /\breturns\b|performance|cagr|annualised\s+returns|historical\s+returns/i,
    section: 'returns',
  },
  {
    pattern: /expense\s+ratio|total\s+expense\s+ratio|\bter\b/i,
    section: 'expense_ratio',
  },
  {
    pattern: /fund\s+manager|managed\s+by|portfolio\s+manager|fund\s+management/i,
    section: 'fund_manager',
  },
  {
    pattern: /assets\s+under\s+management|\baum\b|fund\s+size|\bcorpus\b/i,
    section: 'aum',
  },
  {
    pattern: /sector\s+allocation|sectoral\s+allocation|sector\s+exposure|sector[-\s]+wise|sector\s+breakdown/i,
    section: 'sector_allocation',
  },
]

function detectSection(line: string): FactsheetSection | null {
  for (const { pattern, section } of SECTION_PATTERNS) {
    if (pattern.test(line)) return section
  }
  return null
}

function subChunk(section: FactsheetSection, raw: string): Chunk[] {
  const text = raw.trim()
  if (text.length <= MAX_CHARS) return [{ section, text }]

  // Split on paragraph breaks and re-assemble within MAX_CHARS
  const paras = text.split(/\n{2,}/)
  const chunks: Chunk[] = []
  let current = ''
  for (const para of paras) {
    if (current.length + para.length + 2 > MAX_CHARS && current.length > 0) {
      if (current.trim().length >= MIN_CHARS) chunks.push({ section, text: current.trim() })
      current = para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current.trim().length >= MIN_CHARS) chunks.push({ section, text: current.trim() })
  return chunks
}

export function chunkFactsheetText(text: string): Chunk[] {
  const lines = text.split('\n')
  const allChunks: Chunk[] = []

  let currentSection: FactsheetSection = 'other'
  let buffer: string[] = []

  function flush() {
    const joined = buffer.join('\n').trim()
    buffer = []
    if (joined.length < MIN_CHARS) return
    allChunks.push(...subChunk(currentSection, joined))
  }

  for (const line of lines) {
    const detected = detectSection(line)
    if (detected !== null) {
      flush()
      currentSection = detected
      buffer.push(line)
    } else {
      buffer.push(line)
    }
  }
  flush()

  return allChunks
}
