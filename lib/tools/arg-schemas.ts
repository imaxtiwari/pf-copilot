import { z } from 'zod'

// Per-tool Zod schemas for LLM-supplied arguments.
// Tools with no parameters (get_portfolio, compute_personal_inflation, lookup_chat_history)
// accept an empty object — no schema needed.

export const ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  compute_real_returns: z.object({
    scheme_code: z.string().min(1),
  }),
  explain_fund: z.object({
    scheme_code: z.string().min(1),
    question: z.string().min(1),
  }),
}
