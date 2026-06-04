import type { ScheduleTrigger, TaskModeConfig } from "@autovis/shared"

import { formatDateTime } from "../../utils"

export const toDatetimeLocalValue = (iso?: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const describeTaskMode = (mode?: TaskModeConfig) => {
  if (!mode || mode.kind === "oneshot") return "oneshot · 跑一次"
  if (mode.kind === "polling") return `polling · 每 ${(mode.intervalMs / 1000).toFixed(1)}s 重试，最多 ${mode.maxAttempts} 次（${mode.stopOn ?? "success"}）`
  return `deadline · 目标 ${formatDateTime(mode.at)}（提前 ${(mode.prewarmMs ?? 0) / 1000}s 预热）`
}

export const describeTriggerKind = (trigger: ScheduleTrigger) => {
  if (trigger.kind === "at") return `at · ${trigger.atTime ? formatDateTime(trigger.atTime) : "未设置"}`
  return `cron · ${trigger.cronExpr ?? ""}`
}

export type TriggerFormState = {
  kind: "at" | "cron"
  name: string
  atTime: string
  cronExpr: string
}

export const emptyTriggerForm = (): TriggerFormState => ({ kind: "at", name: "", atTime: "", cronExpr: "0 9 * * *" })