import { PDFParse } from 'pdf-parse'
import type { CASExtraction } from '../contracts/cas-validation'
import logger from '../logger'
import { detectSource, extractDate, extractTotal, parseHoldings } from './parse-text-helpers'

export async function parseCASText(buffer: Buffer): Promise<CASExtraction | null> {
  let text: string
  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    text = result.text
  } catch (e) {
    logger.warn({ err: e }, 'pdf-parse failed — will fall back to vision')
    return null
  }

  const source = detectSource(text)
  if (!source) {
    logger.info('pdf-parse: no NSDL/CDSL marker found — falling back to vision')
    return null
  }

  const extractedDate = extractDate(text)
  if (!extractedDate) {
    logger.warn({ preview: text.slice(0, 200) }, 'cas: extractDate returned null — using today as fallback')
  }
  const as_of_date = extractedDate ?? new Date().toISOString().slice(0, 10)
  const total_value_reported = extractTotal(text)
  const holdings = parseHoldings(text)

  if (holdings.length === 0) {
    logger.info('pdf-parse: no holdings parsed — falling back to vision')
    return null
  }

  return {
    source,
    as_of_date,
    total_value_reported,
    holdings,
    _extraction_notes: [],
  }
}
