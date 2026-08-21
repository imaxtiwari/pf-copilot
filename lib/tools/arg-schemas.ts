import { z } from 'zod'

// Coerces numbers to strings so "scheme_code: 119551" still works
const schemeCode = z.coerce.string().min(1)

export const ToolArgSchemas = {
  get_portfolio: z.object({}),
  compute_personal_inflation: z.object({}),
  compute_real_returns: z.object({ scheme_code: schemeCode }),
  lookup_chat_history: z.object({}),
  explain_fund: z.object({
    scheme_code: schemeCode,
    question: z.string().min(1),
    language: z.enum(['en', 'hi-en']).default('en'),
  }),
  explain_stock: z.object({
    isin: z.string().regex(/^IN[A-Z0-9]{10}$/i, 'ISIN must be 12 characters starting with IN'),
    question: z.string().min(1),
    language: z.enum(['en', 'hi-en']).default('en'),
  }),
  compare_funds: z.object({
    scheme_codes: z.array(schemeCode).min(2),
    question: z.string().min(1),
  }),
} as const satisfies Record<string, z.ZodObject<z.ZodRawShape>>
