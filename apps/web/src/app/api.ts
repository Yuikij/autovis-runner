import { apiBase } from "./constants.js"
import { recordFrontendDiagnostic } from "./frontendDiagnostics.js"
import { t } from "../i18n/index.js"

export interface RequestError<TData = unknown> extends Error {
  status: number
  data?: TData
}

type RequestOptions = RequestInit & {
  timeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const createRequestSignal = (signal: AbortSignal | null | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  let timedOut = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const abortFromSource = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }

  const onAbort = () => abortFromSource(signal?.reason)

  if (signal?.aborted) {
    abortFromSource(signal.reason)
  } else if (signal) {
    signal.addEventListener("abort", onAbort, { once: true })
  }

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      abortFromSource(new Error(`Request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      signal?.removeEventListener("abort", onAbort)
    },
  }
}

export const request = async <T,>(path: string, init?: RequestOptions) => {
  const headers = new Headers(init?.headers)
  const method = init?.method ?? "GET"
  const timeoutMs = init?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (init?.body != null && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const { signal, didTimeout, cleanup } = createRequestSignal(init?.signal, timeoutMs)

  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
      signal,
    })
  } catch (error) {
    cleanup()
    const isAbortError = error instanceof DOMException && error.name === "AbortError"
    if (isAbortError && !didTimeout()) {
      throw error
    }

    const message = didTimeout()
      ? t("api.timeout", { ms: timeoutMs })
      : error instanceof Error
        ? error.message
        : t("api.networkFailed")

    recordFrontendDiagnostic({
      source: "api-request",
      level: "error",
      title: didTimeout() ? t("api.diagTimeoutTitle") : t("api.diagNetworkTitle"),
      message,
      stack: error instanceof Error ? error.stack : undefined,
      meta: {
        method,
        path,
        phase: didTimeout() ? "timeout" : "network",
        timeoutMs,
      },
    })
    throw error
  }

  cleanup()

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
      title: t("api.diagBadStatus"),
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
