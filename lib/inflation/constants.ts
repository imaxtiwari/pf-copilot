export const SLEEVE_RATES = {
  general: 0.055,
  medical: 0.13,
  education: 0.10,
  lifestyle: 0.075,
} as const

export const SLEEVE_NAMES = ['general', 'medical', 'education', 'lifestyle'] as const
export type SleeveName = (typeof SLEEVE_NAMES)[number]

export const FALLBACK_RATE = 0.09
