import { apiBase } from "./constants"

export interface RequestError<TData = unknown> extends Error {
  status: number
  data?: TData
}

export const request = async <T,>(path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  if (init?.body != null && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    let payload: { message?: string; error?: string; data?: unknown } | undefined
    try {
      payload = (await response.json()) as { message?: string; error?: string; data?: unknown }
      message = payload.message ?? payload.error ?? message
    } catch {
      // Ignore JSON parse failures and keep the generic message.
    }
    const error = new Error(message) as RequestError
    error.status = response.status
    error.data = payload?.data
    throw error
  }

  return (await response.json()) as { data: T }
}
