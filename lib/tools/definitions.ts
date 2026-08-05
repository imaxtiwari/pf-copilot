import type { ChatCompletionTool } from 'openai/resources'

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_portfolio',
      description:
        "Returns the user's current mutual fund holdings and asset-class mix. Call this whenever the user asks about their portfolio, total value, or holdings breakdown. Returns top 30 by market value; if truncated, surface the tail summary.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compute_personal_inflation',
      description:
        "Returns the user's personalized inflation rate computed from their onboarding profile (age, city tier, rent, dependents, medical). Call this when the user asks about their real returns, purchasing power, or inflation.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compute_real_returns',
      description:
        "Returns nominal vs real returns for a specific holding, combining factsheet return data with the user's personal inflation rate. Call this when the user asks about real returns or inflation-adjusted performance on a fund.",
      parameters: {
        type: 'object',
        properties: {
          scheme_code: {
            type: 'string',
            description: "AMFI scheme code of the fund (e.g. '122639').",
          },
        },
        required: ['scheme_code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'lookup_chat_history',
      description:
        "Retrieves the last 10 conversation turns. Call this when the user references something from earlier in the conversation or asks you to recall a previous exchange.",
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explain_fund',
      description:
        "Explains a mutual fund using official AMFI factsheet data. Returns a cited, grounded answer — never general knowledge. May refuse if factsheet data is not available. Call this whenever the user asks about a specific fund: expense ratio, holdings, AUM, returns, fund manager, sector allocation.",
      parameters: {
        type: 'object',
        properties: {
          scheme_code: {
            type: 'string',
            description: "AMFI scheme code of the fund (e.g. '122639').",
          },
          question: {
            type: 'string',
            description: "The user's specific question about the fund, verbatim or closely paraphrased.",
          },
        },
        required: ['scheme_code', 'question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_funds',
      description:
        "Compares two or more mutual funds using official AMFI factsheet data. Returns a cited, grounded side-by-side comparison of expense ratio, returns, AUM, fund manager, benchmark, and risk metrics. May refuse if factsheet data is missing for any scheme. Call this when the user asks to compare funds.",
      parameters: {
        type: 'object',
        properties: {
          scheme_codes: {
            type: 'array',
            items: { type: 'string' },
            description: "AMFI scheme codes of the funds to compare (e.g. ['119551', '145001']).",
          },
          question: {
            type: 'string',
            description: "The user's comparison question, verbatim or closely paraphrased.",
          },
        },
        required: ['scheme_codes', 'question'],
      },
    },
  },
]
