import { FORBIDDEN_IN_ASSISTANT_OUTPUT } from '@/lib/contracts/no-advice'
import { z } from 'zod'

type ValidationResult = { ok: true; warnings?: string[] } | { ok: false; errors: string[]; warnings?: string[] }

export function validateRagResponse(
  response: unknown,
  retrievedChunks: { id: string; factsheetDate: string }[],
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  const retrievedChunkIds = retrievedChunks.map(c => c.id)

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

  // CHECK 5: Staleness Check
  if (retrievedChunks.length > 0) {
    const dates = retrievedChunks.map(c => new Date(c.factsheetDate).getTime()).filter(t => !isNaN(t))
    if (dates.length > 0) {
      const oldestTime = Math.min(...dates)
      const ageInDays = Math.floor((Date.now() - oldestTime) / 86400000)
      if (ageInDays > 180) {
        warnings.push(`Stale data warning: oldest chunk is ${ageInDays} days old (> 180 days).`)
      }
    }
  }

  return errors.length === 0 ? { ok: true, warnings } : { ok: false, errors, warnings }
}
