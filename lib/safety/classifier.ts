import { z } from 'zod'
import { NO_ADVICE_CLAUSE } from '@/lib/contracts/no-advice'
import { getGpt4oMini } from '@/lib/azure-openai'
import logger from '@/lib/logger'

export const SafetyLabelSchema = z.enum(['safe', 'borderline', 'advice'])
export type SafetyLabel = z.infer<typeof SafetyLabelSchema>

export const SafetyClassificationSchema = z.object({
  label: SafetyLabelSchema,
  score: z.number().min(0).max(1),
  reasoning: z.string(),
})

export type SafetyClassification = z.infer<typeof SafetyClassificationSchema>

const SAFETY_CLASSIFIER_SYSTEM_PROMPT = `
You are a safety classifier reviewing the final output of an educational financial assistant.

${NO_ADVICE_CLAUSE}

Classify the assistant message below into exactly one of these categories:
- "safe": purely educational, factual, or observational. It does not recommend buying, selling, holding, switching, or timing any security, and does not tell the user what they should do.
- "borderline": close to advice, uses soft prescriptive language, frames one option as obviously better, or could be interpreted as guidance, but does not explicitly instruct the user to act.
- "advice": explicitly recommends buying, selling, holding, switching, or timing a specific security, or explicitly tells the user what they should do with their money.

Respond with a single JSON object containing:
- "label": "safe" | "borderline" | "advice"
- "score": a number between 0 and 1 representing your confidence
- "reasoning": one concise sentence explaining why
`.trim()

export const ADVICE_DETECTED_REFUSAL =
  "That's an investment recommendation, which I can't make. Here's what I can do: explain what you're asking about, share factual information from official sources, and help you understand your own portfolio. You can take that to your advisor or use it to think through your own decision."

/**
 * Classify an assistant message for no-advice policy compliance.
 *
 * Defaults to "safe" on any parsing or LLM failure so the chat route stays
 * available; failures are logged for observability.
 */
export async function classifyAssistantOutput(message: string): Promise<SafetyClassification> {
  if (process.env.SAFETY_CLASSIFIER_ENABLED === 'false') {
    return {
      label: 'safe',
      score: 1,
      reasoning: 'Safety classifier disabled by environment; defaulting to safe.',
    }
  }

  const client = getGpt4oMini()
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI

  if (!deployment) {
    logger.warn('AZURE_OPENAI_DEPLOYMENT_GPT4O_MINI is not set; defaulting safety classification to safe')
    return {
      label: 'safe',
      score: 1,
      reasoning: 'Deployment not configured; defaulting to safe.',
    }
  }

  try {
    const response = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: 'system', content: SAFETY_CLASSIFIER_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 256,
    })

    const raw = response.choices[0]?.message?.content?.trim() ?? '{}'
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      logger.warn({ raw }, 'safety classifier returned non-JSON')
      return {
        label: 'safe',
        score: 1,
        reasoning: 'Classifier returned non-JSON; defaulting to safe.',
      }
    }

    const validated = SafetyClassificationSchema.safeParse(parsed)
    if (!validated.success) {
      logger.warn({ issues: validated.error.issues, parsed }, 'safety classifier returned invalid schema')
      return {
        label: 'safe',
        score: 1,
        reasoning: 'Classifier returned invalid schema; defaulting to safe.',
      }
    }

    return validated.data
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'safety classifier call failed')
    return {
      label: 'safe',
      score: 1,
      reasoning: 'Classifier call failed; defaulting to safe.',
    }
  }
}
