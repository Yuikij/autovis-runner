import type { Identifier } from "./core.js"

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
export type TaskItemFailurePolicy = "stop" | "continue"

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
  /** 该用例失败后的编排行为：stop=终止后续步骤；continue=记录失败但继续执行后续步骤。默认 stop。 */
  onFailure?: TaskItemFailurePolicy
  /**
   * 续用上一个用例的会话：以上一用例结束时的登录态（storage state）与停留页面作为本用例的起点，
   * 并继承执行链中已产出的 outputs。仅当上一用例执行通过时生效；首个用例忽略该配置。
   */
  continueSession?: boolean
  /**
   * 本用例是否使用反检测有头模式（真实 Chrome）的覆盖开关：
   * - `undefined`（默认）：继承所用 TargetUrl 的 needsStealth；
   * - `true` / `false`：忽略站点默认，强制开 / 关（演示等特殊场景灵活配置）。
   * 最终仍受 STEALTH_REPLAY / STEALTH_ALWAYS 环境变量钳制。
   */
  stealth?: boolean
}

/**
 * 任务执行模式。控制一次"触发"如何展开为一组真实的脚本执行：
 * - `oneshot`：默认；只跑一次，遇错即终止。
 * - `polling`：到点起一次后，按 intervalMs 循环重跑，直到达到 stopOn 条件或达到 maxAttempts。适用于秒杀、抢票"反复刷新直到成功"。
 * - `deadline`：一种"调度执行策略"，不自带时间。目标时刻来自绑定的触发器（At 的 atTime / Cron 的下一次触发）；
 *   调度器在目标时刻前用系统估算的预热提前量提前启动任务（浏览器实例化 + 登录态 + 首页 + 前置预热），
 *   runner 在目标脚本正文前自动 `schedule.waitUntil(目标时刻)` 卡点执行。预热提前量与脚本超时窗口都由系统决定，无需用户配置。
 *   手动"立即执行"没有目标时刻，则退化为普通预热执行（不卡点）。
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
  | { kind: "deadline" }

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
