import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

// PII and sensitive fields that must never be written to logs.
const REDACTED_FIELDS = new Set([
  'password',
  'token',
  'apiKey',
  'authorization',
  'pan',
  'aadhaar',
  'accountNumber',
  'ifsc',
  'marketValue',
  'units',
])

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  return REDACTED_FIELDS.has(key) || REDACTED_FIELDS.has(lower)
}

/**
 * Recursively redact sensitive values from an object.
 * Handles nested objects, arrays, and the special `chatMessages.content` path.
 */
export function redactSensitive(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item))
  }

  if (obj !== null && typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'content' && record['role'] !== undefined) {
        // chatMessages object: redact content but keep role for context.
        result[key] = '[REDACTED]'
      } else if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]'
      } else if (key === 'chatMessages' && Array.isArray(value)) {
        // Also handle the explicit chatMessages array shape.
        result[key] = value.map((msg) => redactSensitive(msg))
      } else {
        result[key] = redactSensitive(value)
      }
    }
    return result
  }

  return obj
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
  hooks: {
    logMethod(inputArgs, method) {
      // inputArgs = [mergeObject, message, ...interpolationValues]
      // We redact the merge object (first arg) if it is an object.
      const first = inputArgs[0]
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        inputArgs[0] = redactSensitive(first)
      }
      method.apply(this, inputArgs as Parameters<typeof method>)
    },
  },
})

export default logger
