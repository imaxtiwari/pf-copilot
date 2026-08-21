import { z } from 'zod'

export const GOAL_TYPE = {
  CHILD_EDUCATION:   'CHILD_EDUCATION',
  HOME_PURCHASE:     'HOME_PURCHASE',
  RETIREMENT:        'RETIREMENT',
  EMERGENCY_CORPUS:  'EMERGENCY_CORPUS',
  WEALTH_CREATION:   'WEALTH_CREATION',
  VACATION:          'VACATION',
  CUSTOM:            'CUSTOM',
} as const;

export type GoalType = typeof GOAL_TYPE[keyof typeof GOAL_TYPE];

export const GoalTypeSchema = z.enum([
  'CHILD_EDUCATION',
  'HOME_PURCHASE',
  'RETIREMENT',
  'EMERGENCY_CORPUS',
  'WEALTH_CREATION',
  'VACATION',
  'CUSTOM',
]);

// Human-readable labels for UI display
export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  CHILD_EDUCATION:  "Child's Education",
  HOME_PURCHASE:    'Home Purchase',
  RETIREMENT:       'Retirement',
  EMERGENCY_CORPUS: 'Emergency Fund',
  WEALTH_CREATION:  'Wealth Creation',
  VACATION:         'Vacation / Travel',
  CUSTOM:           'Custom Goal',
};

// Default timeline ranges (years) — used by VIKRAM's hypothesis
export const GOAL_TYPE_TIMELINE_HINTS: Record<GoalType, { min: number, max: number }> = {
  CHILD_EDUCATION:  { min: 5, max: 20 },
  HOME_PURCHASE:    { min: 3, max: 10 },
  RETIREMENT:       { min: 15, max: 35 },
  EMERGENCY_CORPUS: { min: 1, max: 2 },
  WEALTH_CREATION:  { min: 7, max: 30 },
  VACATION:         { min: 1, max: 5 },
  CUSTOM:           { min: 1, max: 30 },
};

export function isValidGoalType(value: string): value is GoalType {
  return Object.values(GOAL_TYPE).includes(value as GoalType);
}
