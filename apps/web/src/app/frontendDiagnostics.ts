import { useSyncExternalStore } from "react"

export type FrontendDiagnosticSource =
  | "window-error"
  | "unhandled-rejection"
  | "react-error-boundary"
  | "api-request"

export type FrontendDiagnosticLevel = "error" | "warning"

export type FrontendDiagnosticEntry = {
  id: string
  source: FrontendDiagnosticSource
  level: FrontendDiagnosticLevel
  title: string
  message: string
  timestamp: string
  path: string
  stack?: string
  componentStack?: string
  meta?: Record<string, string | number | boolean | null | undefined>
}

type FrontendDiagnosticsState = {
  initialized: boolean
  items: FrontendDiagnosticEntry[]
}

type RecordDiagnosticInput = {
  source: FrontendDiagnosticSource
  level: FrontendDiagnosticLevel
  title: string
  message: string
  stack?: string
  componentStack?: string
  meta?: Record<string, string | number | boolean | null | undefined>
}

const MAX_FRONTEND_DIAGNOSTICS = 20

const state: FrontendDiagnosticsState = {
  initialized: false,
  items: [],
}

let snapshot: FrontendDiagnosticsState = state

const listeners = new Set<() => void>()

const syncSnapshot = () => {
  snapshot = {
    initialized: state.initialized,
    items: state.items,
  }
}

const emit = () => {
  for (const listener of listeners) {
    listener()
  }
}

const currentPath = () => {
  if (typeof window === "undefined") {
    return "/"
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

const getMessage = (value: unknown, fallback: string) => {
  if (value instanceof Error) {
    return value.message || fallback
  }
  if (typeof value === "string") {
    return value || fallback
  }
  if (value == null) {
    return fallback
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const getStack = (value: unknown) => {
  if (value instanceof Error) {
    return value.stack
  }

  return undefined
}

export const recordFrontendDiagnostic = (input: RecordDiagnosticInput) => {
  state.items = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      path: currentPath(),
      ...input,
    },
    ...state.items,
  ].slice(0, MAX_FRONTEND_DIAGNOSTICS)

  syncSnapshot()
  emit()
}

export const clearFrontendDiagnostics = () => {
  if (state.items.length === 0) {
    return
  }

  state.items = []
  syncSnapshot()
  emit()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => snapshot

export const useFrontendDiagnostics = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

export const startFrontendDiagnostics = () => {
  if (typeof window === "undefined" || state.initialized) {
    return
  }

  window.addEventListener("error", (event) => {
    const target = event.target as HTMLElement | null
    const resourceUrl = target instanceof HTMLScriptElement
      ? target.src
      : target instanceof HTMLLinkElement
        ? target.href
        : target instanceof HTMLImageElement
          ? target.src
          : undefined

    recordFrontendDiagnostic({
      source: "window-error",
      level: "error",
      title: resourceUrl ? "前端资源加载失败" : "前端未捕获异常",
      message: resourceUrl
        ? `${target?.tagName?.toLowerCase() ?? "resource"} 加载失败`
        : event.message || "发生了未捕获异常",
      stack: getStack(event.error),
      meta: {
        resourceUrl,
        line: event.lineno || null,
        column: event.colno || null,
      },
    })
  })

  window.addEventListener("unhandledrejection", (event) => {
    recordFrontendDiagnostic({
      source: "unhandled-rejection",
      level: "error",
      title: "未处理的 Promise 拒绝",
      message: getMessage(event.reason, "Promise 被拒绝，但没有被捕获"),
      stack: getStack(event.reason),
    })
  })

  state.initialized = true
  syncSnapshot()
}