import { apiBase } from "./constants"

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

  return new Intl.DateTimeFormat("zh-CN", {
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

export const translateStatus = (status: string, isStep?: boolean) => {
  if (isStep && status === "queued") {
    return "等待中"
  }
  const map: Record<string, string> = {
    idle: "空闲",
    queued: "排队中",
    running: "运行中",
    awaiting_human: "等待人工输入",
    passed: "成功",
    failed: "失败",
    connected: "已连接",
    disconnected: "已断开",
    authorizing: "授权中",
    error: "错误",
    starting: "启动中",
    stopping: "停止中",
    completed: "已完成",
  }
  return map[status] ?? status
}

export const translateArtifactKind = (kind: string) => {
  const map: Record<string, string> = {
    trace: "运行轨迹 (Trace)",
    video: "录制视频 (Video)",
    screenshot: "步骤截图 (Screenshot)",
  }
  return map[kind] ?? kind
}

export const translateTestType = (type: string) => {
  const map: Record<string, string> = {
    functional: "功能测试",
    regression: "回归测试",
    smoke: "冒烟测试",
  }
  return map[type] ?? type
}
