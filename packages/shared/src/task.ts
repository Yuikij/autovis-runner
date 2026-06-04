import type { Identifier } from "./core"

export type TaskRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "passed"
  | "failed"
export type TaskRunVerificationStatus = "passed" | "failed"
export type ScheduleTriggerKind = "at" | "cron"
export type TaskKind = "agent" | "run" | "task-run" | "recorder"
export type TaskControlAction = "pause" | "resume" | "cancel"
export type TaskControlCommandStatus = "requested" | "applied" | "rejected" | "orphaned"

export interface PersistedTaskControlCommand {
  id: Identifier
  taskKind: TaskKind
  taskId: Identifier
  action: TaskControlAction
  status: TaskControlCommandStatus
  requestedAt: string
  resolvedAt?: string
  note?: string
}

/**
 * 任务（Task）是可持久化、可编辑的编排实体，取代了原先"测试集 + 调度触发器"的双重概念。
 * - `items`：有序的用例列表，每项可指定自己的初始 URL（缺省回落项目主域名）。
 * - `executionMode`：oneshot / polling / deadline，控制一次触发如何展开为真实执行。
 * - 触发器（ScheduleTrigger）通过 taskId 绑定到任务上，只负责"什么时候触发"。
 */
export interface Task {
  id: Identifier
  projectId: Identifier
  name: string
  description?: string
  items: TaskItem[]
  executionMode?: TaskModeConfig
  lastRunId?: Identifier
  lastStatus?: TaskRunStatus
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

/** 任务编排中的一项：一条用例 + 该用例本次执行使用的初始 URL（缺省回落项目主域名）。 */
export interface TaskItem {
  caseId: Identifier
  /** 该用例的初始 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

/**
 * 任务执行模式。控制一次"触发"如何展开为一组真实的脚本执行：
 * - `oneshot`：默认；只跑一次，遇错即终止。
 * - `polling`：到点起一次后，按 intervalMs 循环重跑，直到达到 stopOn 条件或达到 maxAttempts。适用于秒杀、抢票"反复刷新直到成功"。
 * - `deadline`：在 `at` 时刻前提前 `prewarmMs` 启动浏览器与登录态，由脚本内部 `await schedule.waitUntil(at)` 卡到精确时间点；
 *   单次 attempt 的脚本超时会自动放大到 `at - now + extraTimeoutMs` 以承载等待。
 */
export type TaskModeConfig =
  | { kind: "oneshot" }
  | {
      kind: "polling"
      /** 两次 attempt 之间的间隔毫秒数。 */
      intervalMs: number
      /** 最多重试次数（含首次）。 */
      maxAttempts: number
      /** 何时停止：success = 出现一次成功就停；exhausted = 跑满 maxAttempts。 */
      stopOn?: "success" | "exhausted"
      /** 单次 attempt 的脚本超时；默认沿用 runner 默认 5 分钟。 */
      attemptTimeoutMs?: number
    }
  | {
      kind: "deadline"
      /** 精确触发时刻（ISO 字符串）。 */
      at: string
      /** 提前多少毫秒启动浏览器预热；建议 60s ~ 5min。 */
      prewarmMs?: number
      /** 在 at 之后再额外加多少毫秒超时上限，避免下单 / 后续步骤被卡断。 */
      extraTimeoutMs?: number
    }

export interface ScheduleTrigger {
  id: Identifier
  projectId: Identifier
  /** 触发的任务；任务自带执行模式、有序用例与每项初始 URL，触发器只负责"什么时候触发"。 */
  taskId: Identifier
  name: string
  kind: ScheduleTriggerKind
  /** kind=at 时为目标 ISO 时刻；cron 时忽略。 */
  atTime?: string
  /** kind=cron 时为标准 5 字段表达式（分 时 日 月 周）；at 时忽略。 */
  cronExpr?: string
  enabled: boolean
  lastFiredAt?: string
  nextFireAt?: string
  createdAt: string
  updatedAt: string
}