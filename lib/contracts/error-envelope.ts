export type ApiSuccess<T> = { ok: true; data: T }

export type ApiError = {
  ok: false
  error: {
    code: string
    message: string
    details?: unknown
    request_id: string
  }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data }
}

export function err(code: string, message: string, details?: unknown): ApiError {
  return {
    ok: false,
    error: { code, message, details, request_id: crypto.randomUUID() },
  }
}
