import type { ScheduleTrigger, UpsertScheduleTriggerRequest } from "@autovis/shared"

import type { AutoVisDatabase } from "../db.js"
import { createId, now } from "./common.js"
import type { RunService } from "./run.service.js"
import type { TaskRunService } from "./task-run.service.js"

/**
 * 简单的 5 字段 cron 解析（分 时 日 月 周）。
 * - 支持：`*`、整数、`a-b` 区间、`*\/n` 步长、`a,b,c` 列表。
 * - 不支持：`L`、`#`、`W`、命名月份/周等扩展语法（项目内部用，够用即可）。
 */
function parseCronField(expr: string, min: number, max: number): number[] {
  const trimmed = expr.trim()
  const result = new Set<number>()
  for (const part of trimmed.split(",")) {
    const segment = part.trim()
    if (!segment) continue
    const stepMatch = segment.match(/^(.+)\/(\d+)$/)
    let rangeText = segment
    let step = 1
    if (stepMatch) {
      rangeText = stepMatch[1]
      step = Number(stepMatch[2])
      if (!Number.isFinite(step) || step <= 0) {
        throw new Error(`cron 字段步长非法：${segment}`)
      }
    }
    let start: number
    let end: number
    if (rangeText === "*") {
      start = min
      end = max
    } else if (rangeText.includes("-")) {
      const [a, b] = rangeText.split("-")
      start = Number(a)
      end = Number(b)
    } else {
      start = end = Number(rangeText)
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < min || end > max || start > end) {
      throw new Error(`cron 字段范围非法：${segment}`)
    }
    for (let i = start; i <= end; i += step) {
      result.add(i)
    }
  }
  return Array.from(result).sort((a, b) => a - b)
}

interface ParsedCron {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

export function parseCronExpression(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`cron 必须是 5 字段（分 时 日 月 周），实际：${expr}`)
  }
  return {
    minutes: parseCronField(parts[0], 0, 59),
    hours: parseCronField(parts[1], 0, 23),
    daysOfMonth: parseCronField(parts[2], 1, 31),
    months: parseCronField(parts[3], 1, 12),
    daysOfWeek: parseCronField(parts[4], 0, 6),
  }
}

/** 计算下一次 cron 触发时刻；上限向后扫 2 年防呆。 */
export function computeNextCronFireTime(parsed: ParsedCron, from: Date = new Date()): Date | null {
  const candidate = new Date(from.getTime() + 60_000)
  candidate.setSeconds(0, 0)

  const maxIterations = 366 * 24 * 60 * 2
  for (let i = 0; i < maxIterations; i += 1) {
    const month = candidate.getMonth() + 1
    const day = candidate.getDate()
    const dow = candidate.getDay()
    const hour = candidate.getHours()
    const minute = candidate.getMinutes()
    if (
      parsed.months.includes(month) &&
      parsed.daysOfMonth.includes(day) &&
      parsed.daysOfWeek.includes(dow) &&
      parsed.hours.includes(hour) &&
      parsed.minutes.includes(minute)
    ) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return null
}

interface ScheduledHandle {
  triggerId: string
  timer: NodeJS.Timeout
  fireAt: number
}

export class SchedulerService {
  private readonly handles = new Map<string, ScheduledHandle>()
  private started = false

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly runService: RunService,
    private readonly taskRunService: TaskRunService,
  ) {}

  /**
   * 启动调度器：从 DB 装载所有 enabled trigger，为每个安排下一次触发。
   * 应当在 server 启动时调用一次（PersistentStore 构造时调用）。
   */
  start() {
    if (this.started) return
    this.started = true
    const all = this.db.listAllScheduleTriggers()
    const enabledCount = all.filter((t) => t.enabled).length
    console.log(`[scheduler] start: ${all.length} trigger(s) in DB, ${enabledCount} enabled, reloading…`)
    for (const trigger of all) {
      if (!trigger.enabled) continue
      this.rescheduleTrigger(trigger.id)
    }
  }

  upsert(input: UpsertScheduleTriggerRequest): ScheduleTrigger {
    const id = input.id ?? createId("trigger")
    const normalized: UpsertScheduleTriggerRequest = {
      ...input,
      name: input.name?.trim() || (input.kind === "at" ? `定时执行 @ ${input.atTime ?? ""}` : `cron ${input.cronExpr ?? ""}`),
      atTime: input.kind === "at" ? input.atTime?.trim() || undefined : undefined,
      cronExpr: input.kind === "cron" ? input.cronExpr?.trim() || undefined : undefined,
      enabled: input.enabled !== false,
    }
    if (normalized.kind === "at") {
      if (!normalized.atTime || !Number.isFinite(Date.parse(normalized.atTime))) {
        throw new Error("at 触发器必须提供合法的 ISO 时间。")
      }
    } else {
      parseCronExpression(normalized.cronExpr ?? "") // throws on invalid
    }
    const saved = this.db.upsertScheduleTrigger({ ...normalized, id })
    if (!saved) throw new Error("保存 ScheduleTrigger 失败。")
    if (this.started) {
      this.rescheduleTrigger(saved.id)
    }
    return saved
  }

  delete(id: string) {
    this.clearHandle(id)
    this.db.deleteScheduleTrigger(id)
  }

  setEnabled(id: string, enabled: boolean) {
    this.db.setScheduleTriggerEnabled(id, enabled)
    if (!enabled) {
      this.clearHandle(id)
    } else if (this.started) {
      this.rescheduleTrigger(id)
    }
  }

  /**
   * 手动让某个 trigger 立即跑一次（不影响下次定时）。
   */
  async fireNow(id: string) {
    const trigger = this.db.getScheduleTrigger(id)
    if (!trigger) throw new Error("ScheduleTrigger not found")
    const task = this.db.getTask(trigger.taskId)
    if (!task) throw new Error("Task not found")
    return await this.taskRunService.startTaskRun({
      projectId: trigger.projectId,
      taskId: trigger.taskId,
      scheduleTriggerId: trigger.id,
    })
  }

  private clearHandle(id: string) {
    const handle = this.handles.get(id)
    if (handle) {
      clearTimeout(handle.timer)
      this.handles.delete(id)
    }
  }

  private rescheduleTrigger(id: string) {
    this.clearHandle(id)
    const trigger = this.db.getScheduleTrigger(id)
    if (!trigger || !trigger.enabled) {
      if (trigger) console.log(`[scheduler] trigger ${id} (${trigger.name}) disabled, skip schedule`)
      return
    }

    const nextFireDate = this.computeNextFireTime(trigger)
    if (!nextFireDate) {
      console.log(`[scheduler] trigger ${id} (${trigger.name}, kind=${trigger.kind}) has no upcoming fire time, parked`)
      this.db.updateScheduleTriggerNextFireAt(id, null)
      return
    }
    const delay = Math.max(0, nextFireDate.getTime() - Date.now())
    // setTimeout 32-bit 上限约 24.85 天；超长就先睡到上限再 reschedule。
    const MAX_DELAY = 2 ** 31 - 1
    const useDelay = Math.min(delay, MAX_DELAY)
    this.db.updateScheduleTriggerNextFireAt(id, nextFireDate.toISOString())
    console.log(`[scheduler] trigger ${id} (${trigger.name}, kind=${trigger.kind}${trigger.kind === "cron" ? `, expr="${trigger.cronExpr}"` : ""}) → next fire at ${nextFireDate.toISOString()} (in ${Math.round(delay / 1000)}s${delay > MAX_DELAY ? "; will rewake at 24d boundary" : ""})`)
    const timer = setTimeout(() => {
      if (delay > MAX_DELAY) {
        this.rescheduleTrigger(id)
        return
      }
      void this.fireTrigger(id, nextFireDate).catch((err) => console.warn(`[scheduler] fire failed for trigger ${id}:`, err))
    }, useDelay)
    timer.unref?.()
    this.handles.set(id, { triggerId: id, timer, fireAt: nextFireDate.getTime() })
  }

  private async fireTrigger(id: string, fireAt: Date) {
    const trigger = this.db.getScheduleTrigger(id)
    if (!trigger || !trigger.enabled) {
      console.log(`[scheduler] fireTrigger skipped, trigger ${id} disabled or missing at fire time ${fireAt.toISOString()}`)
      return
    }
    const task = this.db.getTask(trigger.taskId)
    if (!task) {
      console.warn(`[scheduler] fireTrigger skipped, task ${trigger.taskId} for trigger ${id} not found`)
      return
    }
    const nowIso = now()
    console.log(`[scheduler] FIRE trigger ${id} (${trigger.name}, kind=${trigger.kind}) task=${trigger.taskId} project=${trigger.projectId} fireAt=${fireAt.toISOString()}`)
    try {
      const taskRun = await this.taskRunService.startTaskRun({
        projectId: trigger.projectId,
        taskId: trigger.taskId,
        scheduleTriggerId: trigger.id,
      })
      console.log(`[scheduler] startTaskRun ok for trigger ${id} → taskRunId=${taskRun?.id ?? "(unknown)"} status=${taskRun?.status ?? "(unknown)"}`)
    } catch (err) {
      console.warn(`[scheduler] startTaskRun failed for trigger ${id}:`, err instanceof Error ? err.stack || err.message : err)
    }
    if (trigger.kind === "at") {
      this.db.updateScheduleTriggerFiredAt(id, nowIso, null)
      this.db.setScheduleTriggerEnabled(id, false)
      this.clearHandle(id)
      console.log(`[scheduler] at-trigger ${id} consumed (auto-disabled)`)
    } else {
      this.db.updateScheduleTriggerFiredAt(id, nowIso, null)
      this.rescheduleTrigger(id)
    }
  }

  private computeNextFireTime(trigger: ScheduleTrigger): Date | null {
    if (trigger.kind === "at") {
      const ms = trigger.atTime ? Date.parse(trigger.atTime) : NaN
      if (!Number.isFinite(ms)) return null
      if (ms <= Date.now()) return null
      return new Date(ms)
    }
    if (trigger.kind === "cron" && trigger.cronExpr) {
      try {
        const parsed = parseCronExpression(trigger.cronExpr)
        return computeNextCronFireTime(parsed)
      } catch (err) {
        console.warn("[scheduler] invalid cron expression", trigger.id, err)
        return null
      }
    }
    return null
  }
}
