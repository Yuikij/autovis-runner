import type { Identifier } from "./core"
import type { VerificationStatus } from "./run"

export type AgentSessionMode = "generate" | "direct"
export type AgentSessionStatus =
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "completed"
  | "error"
export type AgentStage = "code" | "page" | "generation" | "verification"
export type AgentStepType = "thinking" | "tool_call" | "tool_result" | "generation" | "verification" | "error"

export interface AgentStep {
  id: string
  type: AgentStepType
  stage?: AgentStage
  title: string
  content: string
  detail?: string
  status: "running" | "completed" | "error"
  toolName?: string
  timestamp: string
  payloadJson?: string
  screenshotUrl?: string
  url?: string
  fileName?: string
  selector?: string
  runId?: Identifier
  scriptId?: Identifier
}

export interface DirectOperationStep {
  index: number
  action: string
  description: string
  status: "completed" | "error"
  screenshotUrl?: string
  url?: string
  timestamp: string
}

export interface DirectExecutionResult {
  /** 按时间顺序的操作步骤 */
  operationSteps: DirectOperationStep[]
  /** 最终状态 */
  outcome: "completed" | "partial" | "failed"
  /** Agent 对执行结果的总结 */
  summary?: string
}

export interface AgentSession {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  mode: AgentSessionMode
  status: AgentSessionStatus
  verificationStatus: VerificationStatus
  steps: AgentStep[]
  resultScriptId?: Identifier
  latestScriptId?: Identifier
  latestRunId?: Identifier
  warmupRunId?: Identifier
  taskRunId?: Identifier
  preconditionSummary?: string[]
  finalSummary?: string
  directResult?: DirectExecutionResult
  error?: string
  startedAt: string
  pausedAt?: string
  finishedAt?: string
}