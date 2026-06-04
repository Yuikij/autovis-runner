import type { Identifier } from "./core"
import type { TaskModeConfig, TaskRunStatus } from "./task"

export type HumanHandoffReason = "captcha" | "otp" | "manual_confirmation" | "custom"
export type RunPhase = "preconditions" | "target" | "archive"
export type ExecutionStepKind = "orchestration" | "precondition_case" | "target" | "archive" | "business_step"
export type RunStatus =
  | "idle"
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "awaiting_human"
  | "passed"
  | "failed"
export type ExecutionStepStatus = "queued" | "running" | "passed" | "failed"
export type ExecutionRunKind = "execution" | "verification" | "temporary"
export type LiveViewportStatus = "connecting" | "live" | "ended" | "unavailable"
export type VerificationStatus = "idle" | "queued" | "running" | "passed" | "failed"

export interface HumanHandoffRequest {
  id: Identifier
  kind: "text_input"
  reason: HumanHandoffReason
  instruction: string
  inputLabel?: string
  placeholder?: string
  confirmText?: string
  imageUrl?: string
  scope?: "precondition" | "target"
  suiteId?: Identifier
  testCaseId?: Identifier
  createdAt: string
}

export interface ExecutionStep {
  id: Identifier
  title: string
  kind?: ExecutionStepKind
  status: ExecutionStepStatus
  startedAt: string
  finishedAt?: string
  screenshotUrl?: string
  log: string
}

export interface RunArtifact {
  kind: "trace" | "video" | "screenshot"
  name: string
  url: string
}

export interface LiveViewportState {
  mode: "ws-jpeg-stream"
  url: string
  status: LiveViewportStatus
  mimeType: "image/jpeg"
  width?: number
  height?: number
}

export interface RuntimeOutput {
  id: Identifier
  runId: Identifier
  testCaseId?: Identifier
  caseCode?: string
  caseName?: string
  description: string
  value: unknown
  meta?: Record<string, unknown>
  createdAt: string
}

export interface ExecutionRun {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  scriptId: Identifier
  kind: ExecutionRunKind
  taskRunId?: Identifier
  batchOrder?: number
  status: RunStatus
  startedAt: string
  finishedAt?: string
  currentViewport: string
  liveViewport?: LiveViewportState
  pendingHumanHandoff?: HumanHandoffRequest
  logs: string[]
  steps: ExecutionStep[]
  artifacts: RunArtifact[]
  targetUrlId?: Identifier
  testBaseUrl: string
  orchestrationPhase?: RunPhase
  currentPreconditionCaseId?: Identifier
  completedPreconditionCaseIds?: Identifier[]
  preconditionSummary?: string[]
  runtimeOutputs?: RuntimeOutput[]
}

/** 任务的一次执行记录（取代原 TestSuiteRun）。每个任务可查看自己的执行历史。 */
export interface TaskRun {
  id: Identifier
  projectId: Identifier
  taskId: Identifier
  status: TaskRunStatus
  /** 任务级默认 URL（展示用）；每个子 run 实际使用各自 TaskItem 的 targetUrlId。 */
  targetUrlId?: Identifier
  testBaseUrl: string
  totalCount: number
  queuedCount: number
  runningCount: number
  passedCount: number
  failedCount: number
  skippedCount: number
  runIds: Identifier[]
  currentRunId?: Identifier
  /** 当前正在执行的 AI 直接执行 Agent session id（用例无脚本时使用）。 */
  currentAgentId?: Identifier
  /** 最近一次 direct-agent 的 session id，用于任务历史回看。 */
  lastAgentId?: Identifier
  logs: string[]
  startedAt: string
  finishedAt?: string
  /** 触发该 taskRun 的 ScheduleTrigger id（手动启动则为空）。 */
  scheduleTriggerId?: Identifier
  /** polling 链中本次 attempt 的序号（1 起；oneshot/deadline 为 undefined）。 */
  attemptNo?: number
  /** polling 链中指向上一轮 attempt 的 taskRun id；首轮为空。 */
  parentTaskRunId?: Identifier
  /** 实际生效的执行模式（如 polling/deadline 的具体参数），便于前端展示与排错。 */
  effectiveTaskMode?: TaskModeConfig
}