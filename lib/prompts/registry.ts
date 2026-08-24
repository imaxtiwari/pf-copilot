import { ORCHESTRATOR_PROMPT } from './orchestrator'
import { COMPARE_FUNDS_PROMPT } from './compare-funds'
import { EXPLAIN_FUND_PROMPT } from './explain-fund'
import { EXPLAIN_FUND_TRANSLATE_PROMPT } from './explain-fund-translate'
import { EXPLAIN_STOCK_PROMPT } from './explain-stock'

export type PromptEntry = {
  version: string
  text: string
  changelog?: string[]
}

export const PROMPT_REGISTRY = {
  orchestrator: ORCHESTRATOR_PROMPT,
  compare_funds: COMPARE_FUNDS_PROMPT,
  explain_fund: EXPLAIN_FUND_PROMPT,
  explain_fund_translate: EXPLAIN_FUND_TRANSLATE_PROMPT,
  explain_stock: EXPLAIN_STOCK_PROMPT,
} as const satisfies Record<string, PromptEntry>

export type PromptName = keyof typeof PROMPT_REGISTRY

export function getPromptVersion(name: PromptName): string {
  return PROMPT_REGISTRY[name].version
}

export function listPrompts(): { name: PromptName; version: string }[] {
  return (Object.keys(PROMPT_REGISTRY) as PromptName[]).map((name) => ({
    name,
    version: PROMPT_REGISTRY[name].version,
  }))
}
