import { FORBIDDEN_IN_ASSISTANT_OUTPUT } from '@/lib/contracts/no-advice'
import { z } from 'zod'

type ValidationResult = { ok: true } | { ok: false; errors: string[] }

export type ValidateRagResponseOptions = {
  /** If provided, ensures every requested scheme has at least one citation chunk. */
  requiredSchemeCodes?: string[]
  /** Map of scheme code → retrieved chunk ids. Required when requiredSchemeCodes is set. */
  chunksByScheme?: Record<string, string[]>
}

export function validateRagResponse(
  response: unknown,
  retrievedChunkIds: string[],
  options: ValidateRagResponseOptions = {},
): ValidationResult {
  const errors: string[] = []

  // CHECK 1: Shape
  const shape = z
    .object({
      answer: z.string(),
      citations: z.array(
        z.object({
          chunk_id: z.string(),
          factsheet_date: z.string(),
          section: z.string(),
        }),
      ),
      refused: z.boolean(),
      refusal_reason: z.string().nullable(),
    })
    .safeParse(response)

  if (!shape.success) {
    errors.push(`Shape violation: ${shape.error.message}`)
    return { ok: false, errors }
  }
  const r = shape.data

  // CHECK 2: If not refused, every citation chunk_id must exist in retrieved chunks
  if (!r.refused) {
    for (const cit of r.citations) {
      if (!retrievedChunkIds.includes(cit.chunk_id)) {
        errors.push(
          `Citation references chunk_id "${cit.chunk_id}" which was not in retrieved chunks`,
        )
      }
    }
  }

  // CHECK 3: Every [chunk_id] reference in answer body must exist in retrieved chunks
  // Strip <user_question>...</user_question> blocks BEFORE this check
  const answerWithoutUserQuotes = r.answer.replace(
    /<user_question>[\s\S]*?<\/user_question>/g,
    '',
  )
  const inlineRefs = [...answerWithoutUserQuotes.matchAll(/\[([\w-]+)\]/g)].map((m) => m[1])
  for (const ref of inlineRefs) {
    if (!retrievedChunkIds.includes(ref)) {
      errors.push(`Inline citation "[${ref}]" in answer references unknown chunk`)
    }
  }

  // CHECK 4: Forbidden words in assistant's answer body (NOT in user-quoted segments)
  const answerForWordCheck = r.answer
    .replace(/<user_question>[\s\S]*?<\/user_question>/g, '')
    .toLowerCase()
  for (const word of FORBIDDEN_IN_ASSISTANT_OUTPUT) {
    const re = new RegExp(`\\b${word}\\b`, 'i')
    if (re.test(answerForWordCheck)) {
      errors.push(
        `Forbidden word "${word}" appears in assistant answer (outside <user_question> wrapper)`,
      )
    }
  }

  // CHECK 5: Multi-fund citation coverage (only when requested)
  if (!r.refused && options.requiredSchemeCodes && options.requiredSchemeCodes.length > 0) {
    const citationChunkIds = new Set(r.citations.map((c) => c.chunk_id))
    for (const schemeCode of options.requiredSchemeCodes) {
      const schemeChunkIds = options.chunksByScheme?.[schemeCode] ?? []
      const hasSchemeCitation = schemeChunkIds.some((id) => citationChunkIds.has(id))
      if (!hasSchemeCitation) {
        errors.push(
          `No citation covers scheme "${schemeCode}" — every requested scheme must be cited`,
        )
      }
    }
  }

  // CHECK 6: Numeric and peer-comparison claims must carry an inline chunk citation
  // in the same sentence or the immediately preceding sentence (multi-sentence claims).
  if (!r.refused) {
    const sentences = splitSentences(answerWithoutUserQuotes)
    const numericClaimRe = /\d+(?:\.\d+)?\s*(?:%|percent|pct|Cr|crore|lakh|lacs|INR|₹|bps|bp|years?|Y)/gi
    const peerComparisonRe = /\b(outperform(?:ed|s)?|underperform(?:ed|s)?|better than|worse than|higher than|lower than|best|worst|top|bottom)\b/gi

    let previousSentenceHadCitation = false

    for (const sentence of sentences) {
      const hasNumericClaim = numericClaimRe.test(sentence)
      numericClaimRe.lastIndex = 0
      const hasPeerComparison = peerComparisonRe.test(sentence)
      peerComparisonRe.lastIndex = 0
      const hasCitation = /\[chunk_[\w-]+\]/.test(sentence)

      if (hasCitation) {
        previousSentenceHadCitation = true
      }

      if ((hasNumericClaim || hasPeerComparison) && !hasCitation && !previousSentenceHadCitation) {
        errors.push(
          `Claim "${sentence.slice(0, 80)}${sentence.length > 80 ? '...' : ''}" is not cited with a [chunk_id]`,
        )
      }

      if (!hasCitation) {
        previousSentenceHadCitation = false
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * Split text into sentences while avoiding common abbreviations and decimal points.
 * Keeps parenthetical citations attached to their containing sentence.
 */
function splitSentences(text: string): string[] {
  // Match sentence-ending punctuation followed by whitespace/end, but only when
  // the preceding token is not a known abbreviation.
  const sentenceEndRe =
    /(?<![A-Za-z](?:\.|[A-Za-z]{1,3})\.?)(?<![A-Za-z]{1,4})(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\s*$/g

  const raw = text
    .replace(sentenceEndRe, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const sentences: string[] = []
  for (const segment of raw) {
    const trimmed = segment.trim()
    if (!trimmed) continue
    // Merge trailing abbreviation fragments back into the prior sentence.
    const lastChar = trimmed.charAt(trimmed.length - 1)
    if (sentences.length > 0 && !['.', '!', '?'].includes(lastChar)) {
      sentences[sentences.length - 1] += ' ' + trimmed
    } else {
      sentences.push(trimmed)
    }
  }

  return sentences
}
