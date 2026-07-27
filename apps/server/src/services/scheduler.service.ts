import type { ScheduleTrigger, Task, UpsertScheduleTriggerRequest } from "@browsewright/shared"

import type { BrowsewrightDatabase } from "../db.js"
import { createId, now } from "./common.js"
import { log } from "../log.js"
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

/** setTimeout 32-bit 上限约 24.85 天；超长延迟先睡到上限再重新排程。 */
const MAX_DELAY = 2 ** 31 - 1

/**
 * deadline 任务的系统预热提前量：目标时刻前多久启动任务开始预热（浏览器实例化 + 登录态 + 首页 + 前置）。
 * 用户不配置。MVP 给保守常量；后续可基于该任务历史运行的"就绪耗时" p95 自动估算。
 */
const DEFAULT_DEADLINE_PREWARM_MS = 2 * 60 * 1000

export class SchedulerService {
  private readonly handles = new Map<string, ScheduledHandle>()
  private started = false

  constructor(
    private readonly db: BrowsewrightDatabase,
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
    log.info("scheduler.started", {
      triggerCount: all.length,
      enabledCount,
    })
    for (const trigger of all) {
      if (!trigger.enabled) continue
      this.rescheduleTrigger(trigger.id)
    }
  }

  /**
   * deadline 任务的系统预热提前量。目前返回保守常量；预留 task 入参，后续可用其历史运行的就绪耗时 p95 估算。
   */
  private estimateDeadlinePrewarmMs(_task: Task): number {
    return DEFAULT_DEADLINE_PREWARM_MS
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

  private rescheduleTrigger(id: string, firedTarget?: Date) {
    this.clearHandle(id)
    const trigger = this.db.getScheduleTrigger(id)
    if (!trigger || !trigger.enabled) {
      if (trigger) {
        log.info("scheduler.trigger_disabled", {
          triggerId: id,
          projectId: trigger.projectId,
          taskId: trigger.taskId,
          name: trigger.name,
        })
      }
      return
    }

    // firedTarget 存在时（cron 刚触发完的重排），从刚触发的目标时刻之后算下一次，
    // 避免 deadline 提前触发后从"现在（早于目标）"又算出同一目标而无限重触发。
    const nextFireDate = this.computeNextFireTime(trigger, firedTarget)
    if (!nextFireDate) {
      log.info("scheduler.trigger_parked", {
        triggerId: id,
        projectId: trigger.projectId,
        taskId: trigger.taskId,
        name: trigger.name,
        kind: trigger.kind,
      })
      this.db.updateScheduleTriggerNextFireAt(id, null)
      return
    }
    // deadline 模式：目标时刻 = 触发器时间（nextFireDate），但要在其之前用系统预热提前量提前启动，
    // 好让浏览器/登录/首页/前置在目标时刻前就绪，runner 再卡到目标时刻执行脚本正文。
    const task = this.db.getTask(trigger.taskId)
    const isDeadline = task?.executionMode?.kind === "deadline"
    const prewarmMs = isDeadline && task ? this.estimateDeadlinePrewarmMs(task) : 0
    // 实际启动时刻（钳到不早于现在，避免高频 cron + 大 prewarm 触发过去时间）。
    const startAtMs = Math.max(Date.now(), nextFireDate.getTime() - prewarmMs)
    const delay = Math.max(0, startAtMs - Date.now())
    // 超长延迟先睡到 setTimeout 上限再 reschedule。
    const useDelay = Math.min(delay, MAX_DELAY)
    // nextFireAt 记录的是"动作目标时刻"（对 deadline 也是），预热提前启动只是内部细节。
    this.db.updateScheduleTriggerNextFireAt(id, nextFireDate.toISOString())
    log.info("scheduler.trigger_scheduled", {
      triggerId: id,
      projectId: trigger.projectId,
      taskId: trigger.taskId,
      name: trigger.name,
      kind: trigger.kind,
      cronExpr: trigger.kind === "cron" ? trigger.cronExpr ?? null : null,
      nextFireAt: nextFireDate.toISOString(),
      deadline: isDeadline,
      prewarmMs: isDeadline ? prewarmMs : undefined,
      startAt: isDeadline ? new Date(startAtMs).toISOString() : undefined,
      delaySeconds: Math.round(delay / 1000),
      clampedByMaxDelay: delay > MAX_DELAY,
    })
    const timer = setTimeout(() => {
      if (delay > MAX_DELAY) {
        this.rescheduleTrigger(id)
        return
      }
      void this.fireTrigger(id, nextFireDate).catch((err) =>
        log.warn("scheduler.trigger_fire_failed", {
          triggerId: id,
          fireAt: nextFireDate.toISOString(),
          error: err,
        }),
      )
    }, useDelay)
    timer.unref?.()
    this.handles.set(id, { triggerId: id, timer, fireAt: startAtMs })
  }

  private async fireTrigger(id: string, targetAt: Date) {
    const trigger = this.db.getScheduleTrigger(id)
    if (!trigger || !trigger.enabled) {
      log.info("scheduler.trigger_fire_skipped", {
        triggerId: id,
        fireAt: targetAt.toISOString(),
      })
      return
    }
    const task = this.db.getTask(trigger.taskId)
    if (!task) {
      log.warn("scheduler.trigger_task_missing", {
        triggerId: id,
        projectId: trigger.projectId,
        taskId: trigger.taskId,
      })
      return
    }
    const nowIso = now()
    // deadline 任务：把目标时刻（触发器时间）作为 deadlineAt 下传，任务在正文前卡到此刻执行。
    const isDeadline = task.executionMode?.kind === "deadline"
    // deadline 兜底：本任务已有活跃（非终态）run 时不再重复触发——避免任何多重触发导致重复抢购/下单。
    const hasActiveRun = isDeadline && this.hasActiveTaskRun(trigger.taskId)
    log.info("scheduler.trigger_firing", {
      triggerId: id,
      projectId: trigger.projectId,
      taskId: trigger.taskId,
      name: trigger.name,
      kind: trigger.kind,
      fireAt: targetAt.toISOString(),
      deadline: isDeadline,
      skippedActiveRun: hasActiveRun,
    })
    if (hasActiveRun) {
      log.info("scheduler.trigger_fire_skipped_active_run", {
        triggerId: id,
        projectId: trigger.projectId,
        taskId: trigger.taskId,
      })
    } else {
      try {
        const taskRun = await this.taskRunService.startTaskRun({
          projectId: trigger.projectId,
          taskId: trigger.taskId,
          scheduleTriggerId: trigger.id,
          deadlineAt: isDeadline ? targetAt.toISOString() : undefined,
        })
        log.info("scheduler.trigger_started_task_run", {
          triggerId: id,
          projectId: trigger.projectId,
          taskId: trigger.taskId,
          taskRunId: taskRun?.id ?? null,
          status: taskRun?.status ?? null,
        })
      } catch (err) {
        log.warn("scheduler.trigger_start_task_run_failed", {
          triggerId: id,
          projectId: trigger.projectId,
          taskId: trigger.taskId,
          error: err,
        })
      }
    }
    if (trigger.kind === "at") {
      this.db.updateScheduleTriggerFiredAt(id, nowIso, null)
      this.db.setScheduleTriggerEnabled(id, false)
      this.clearHandle(id)
      log.info("scheduler.at_trigger_consumed", {
        triggerId: id,
        projectId: trigger.projectId,
        taskId: trigger.taskId,
      })
    } else {
      this.db.updateScheduleTriggerFiredAt(id, nowIso, null)
      // 从刚触发的目标时刻之后算下一次（关键：deadline 提前触发时"现在"早于目标，
      // 若从现在算 cron 会得到同一目标 → 立即重复触发 → 死循环刷屏）。
      this.rescheduleTrigger(id, targetAt)
    }
  }

  /** 该任务是否有活跃（非终态）的 task run 正在进行。用于 deadline 触发前兜底去重。 */
  private hasActiveTaskRun(taskId: string): boolean {
    const terminal = new Set(["passed", "failed", "cancelled", "interrupted"])
    return this.db.listTaskRunsForTask(taskId).some((run) => !terminal.has(run.status))
  }

  /**
   * @param from cron 下一次的起算时间。默认当前时间；deadline 提前触发后必须传入"刚触发的目标时刻"，
   *   否则会从"现在（早于目标）"重新算出同一个目标 → 立即重复触发 → 死循环。
   */
  private computeNextFireTime(trigger: ScheduleTrigger, from: Date = new Date()): Date | null {
    if (trigger.kind === "at") {
      const ms = trigger.atTime ? Date.parse(trigger.atTime) : NaN
      if (!Number.isFinite(ms)) return null
      if (ms <= Date.now()) return null
      return new Date(ms)
    }
    if (trigger.kind === "cron" && trigger.cronExpr) {
      try {
        const parsed = parseCronExpression(trigger.cronExpr)
        return computeNextCronFireTime(parsed, from)
      } catch (err) {
        log.warn("scheduler.invalid_cron_expression", {
          triggerId: trigger.id,
          projectId: trigger.projectId,
          taskId: trigger.taskId,
          error: err,
        })
        return null
      }
    }
    return null
  }
}
