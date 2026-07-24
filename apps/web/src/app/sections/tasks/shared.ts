import type { ScheduleTrigger, TaskModeConfig } from "@autovis/shared"

import { formatDateTime } from "../../utils.js"
import { t } from "../../../i18n/index.js"

export const describeTaskMode = (mode?: TaskModeConfig) => {
  if (!mode || mode.kind === "oneshot") return t("tasks.modeDescOneshot")
  if (mode.kind === "polling") return t("tasks.modeDescPolling", { interval: (mode.intervalMs / 1000).toFixed(1), attempts: mode.maxAttempts, stopOn: mode.stopOn ?? "success" })
  return t("tasks.modeDescDeadline")
}

export const describeTriggerKind = (trigger: ScheduleTrigger) => {
  if (trigger.kind === "at") return `at · ${trigger.atTime ? formatDateTime(trigger.atTime) : t("tasks.notSet")}`
  return `cron · ${trigger.cronExpr ?? ""}`
}

export type TriggerFormState = {
  kind: "at" | "cron"
  name: string
  atTime: string
  cronExpr: string
}

export const emptyTriggerForm = (): TriggerFormState => ({ kind: "at", name: "", atTime: "", cronExpr: "0 9 * * *" })