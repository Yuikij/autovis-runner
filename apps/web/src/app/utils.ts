import { apiBase } from "./constants.js"
import { lang, t } from "../i18n/index.js"

export const resolveUrl = (url?: string) => {
  if (!url) {
    return ""
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url
  }

  return `${apiBase}${url}`
}

export const resolveWebSocketUrl = (url?: string) => {
  if (!url || typeof window === "undefined") {
    return url ?? ""
  }

  const source = new URL(url, window.location.href)
  const base = new URL(apiBase || "/", window.location.href)
  const basePath = base.pathname.replace(/\/$/, "")
  const sourcePath = `${source.pathname}${source.search}${source.hash}`
  const path = sourcePath.startsWith(`${basePath}/`) || (!basePath && sourcePath.startsWith("/"))
    ? sourcePath
    : `${basePath}${sourcePath.startsWith("/") ? sourcePath : `/${sourcePath}`}`
  const protocol = base.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${base.host}${path}`
}

export const formatDateTime = (value?: string) => {
  if (!value) {
    return "--"
  }

  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export const formatDuration = (start?: string, finish?: string) => {
  if (!start) {
    return "--"
  }

  const startTime = new Date(start).getTime()
  const endTime = finish ? new Date(finish).getTime() : Date.now()
  const seconds = Math.max(0, Math.round((endTime - startTime) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}m ${rest}s`
}

export const statusToneClass = (status: string) => {
  if (status === "passed" || status === "connected" || status === "completed") {
    return "tone success"
  }
  if (status === "failed" || status === "error" || status === "disconnected") {
    return "tone danger"
  }
  if (status === "running" || status === "queued" || status === "awaiting_human" || status === "authorizing" || status === "starting" || status === "stopping") {
    return "tone warning"
  }
  return "tone"
}

export const splitLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)

export const splitCommaValues = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

const KNOWN_STATUSES = new Set([
  "idle", "queued", "running", "awaiting_human", "passed", "failed", "connected",
  "disconnected", "authorizing", "error", "starting", "stopping", "completed",
])

export const translateStatus = (status: string, isStep?: boolean) => {
  if (isStep && status === "queued") {
    return t("status.queuedStep")
  }
  return KNOWN_STATUSES.has(status) ? t(`status.${status}`) : status
}

export const translateArtifactKind = (kind: string) => {
  return kind === "trace" || kind === "video" || kind === "screenshot" ? t(`artifact.${kind}`) : kind
}

export const translateTestType = (type: string) => {
  return type === "functional" || type === "regression" || type === "smoke" ? t(`testType.${type}`) : type
}
