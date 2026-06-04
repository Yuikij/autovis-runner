import { apiBase } from "./constants"
import { recordFrontendDiagnostic } from "./frontendDiagnostics"

export interface RequestError<TData = unknown> extends Error {
  status: number
  data?: TData
}

export const request = async <T,>(path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const method = init?.method ?? "GET"
  if (init?.body != null && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
    })
  } catch (error) {
    recordFrontendDiagnostic({
      source: "api-request",
      level: "error",
      title: "API 请求网络失败",
      message: error instanceof Error ? error.message : "请求未能发送到服务端",
      stack: error instanceof Error ? error.stack : undefined,
      meta: {
        method,
        path,
        phase: "network",
      },
    })
    throw error
  }

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

    recordFrontendDiagnostic({
      source: "api-request",
      level: response.status >= 500 ? "error" : "warning",
      title: "API 返回非成功状态",
      message,
      stack: error.stack,
      meta: {
        method,
        path,
        status: response.status,
      },
    })

    throw error
  }

  return (await response.json()) as { data: T }
}
