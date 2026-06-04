import { type RunnerSession } from "@autovis/runner"
import { type AgentSession, type AgentStep, type GenerateScriptRequest, type RuntimeOutput } from "@autovis/shared"

import type { AutoVisDatabase } from "../db.js"
import { CopilotSessionError } from "../copilot.js"
import { type InitialPageState, type PreconditionReport } from "../agent/types.js"
import { log } from "../log.js"
import { now } from "./common.js"
import { type AgentWarmupService, type ExecuteWarmupResult } from "./agent-warmup.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import type { ProjectService } from "./project.service.js"
import type { RunService } from "./run.service.js"

export type LlmOwned = { llmOwnerKey?: string }

type ActiveLlmBundle = ReturnType<LlmConfigService["getActiveLlmConfigBundle"]>
type ActiveLlmState = ActiveLlmBundle["state"]
type ActiveLlmCurrent = ActiveLlmBundle["current"]

export type AgentExecutionRequest = Pick<GenerateScriptRequest, "projectId" | "testCaseId" | "runTargetUrlId"> & {
  sessionId: string
  taskRunId?: string
}

export function getOwnerKey(request: LlmOwned) {
  return request.llmOwnerKey ?? "shared"
}

export function createAgentConflictError(message: string, conflictId: string, conflictStatus: string) {
  const conflict = new Error(message) as Error & {
    code?: string
    conflictId?: string
    conflictKind?: string
    conflictStatus?: string
  }
  conflict.code = "TASK_CONFLICT"
  conflict.conflictId = conflictId
  conflict.conflictKind = "agent"
  conflict.conflictStatus = conflictStatus
  return conflict
}

export function ensureProjectAndTestCase(db: AutoVisDatabase, projectId: string, testCaseId: string) {
  const project = db.getProject(projectId)
  const testCase = db.getTestCase(testCaseId)
  if (!project || !testCase) {
    throw new Error("Project or test case not found")
  }
  return { project, testCase }
}

export function handleUnauthorizedCopilotError(params: {
  error: unknown
  message: string
  llmService: LlmConfigService
  state: ActiveLlmState
  current: ActiveLlmCurrent
  ownerKey: string
}) {
  if (!(params.error instanceof CopilotSessionError) || params.error.statusCode !== 401) {
    return false
  }
  const bundle = { session: params.current.session, secrets: params.current.secrets.copilot ?? {} }
  params.llmService.applyCopilotSessionError(bundle, params.message, { disconnect: true, clearSecrets: true })
  params.current.session = bundle.session
  params.current.secrets = { ...params.current.secrets, copilot: bundle.secrets }
  params.llmService.saveLlmConfigState(params.state, params.ownerKey)
  return true
}

export async function closeWarmupSession(warmupSession: RunnerSession | null) {
  if (!warmupSession) return
  await warmupSession.context.close().catch(() => undefined)
  await warmupSession.browser.close().catch(() => undefined)
}

export async function prepareAgentExecutionContext(params: {
  mode: "generate" | "direct"
  request: AgentExecutionRequest
  ownerKey: string
  current: ActiveLlmCurrent
  db: AutoVisDatabase
  projectService: ProjectService
  runService: RunService
  agentWarmupService: AgentWarmupService
  session: AgentSession
  project: NonNullable<ReturnType<AutoVisDatabase["getProject"]>>
  testCase: NonNullable<ReturnType<AutoVisDatabase["getTestCase"]>>
  onStep: (step: AgentStep) => void
  updateSession: (patch: { warmupRunId?: string; preconditionSummary?: string[] }) => void
  logMissingAuthState?: boolean
}): Promise<ExecuteWarmupResult & {
  hasWorkspace: boolean
  resolvedRunTargetId?: string
  resolvedRunUrl: string
  authStorageStateJson?: string
}> {
  const {
    mode,
    request,
    ownerKey,
    current,
    db,
    projectService,
    runService,
    agentWarmupService,
    session,
    project,
    testCase,
    onStep,
    updateSession,
    logMissingAuthState = false,
  } = params

  const hasWorkspace = await projectService.hasWorkspace(request.projectId)

  if (current.session.connectionStatus !== "connected") {
    throw new Error("当前 AI 配置未连接，请先完成授权或填写 API Key。")
  }

  if (!request.runTargetUrlId) {
    throw new Error(mode === "direct" ? "直接执行需要先选择一个目标 URL。" : "生成脚本需要先在工作台选择一个目标 URL。")
  }

  const resolvedRunTarget = db.resolveTargetUrl(request.projectId, request.runTargetUrlId)
  if (!resolvedRunTarget?.url) {
    throw new Error(`所选的目标 URL 不存在或已被删除（targetUrlId=${request.runTargetUrlId}）。请刷新页面后重新选择。`)
  }
  const resolvedRunUrl = resolvedRunTarget.url

  let authStorageStateJson: string | undefined
  if (testCase.authProfileId && resolvedRunTarget.id) {
    const authProfile = db.getAuthProfile(testCase.authProfileId)
    if (authProfile) {
      const stateRow = db.getAuthProfileState(authProfile.id, resolvedRunTarget.id)
      if (stateRow?.storageStateJson) {
        authStorageStateJson = stateRow.storageStateJson
        log.info("agent.auth_state_injected", {
          sessionId: request.sessionId,
          projectId: request.projectId,
          testCaseId: request.testCaseId,
          taskRunId: request.taskRunId ?? null,
          authProfileId: authProfile.id,
          authProfileName: authProfile.name,
          targetUrl: resolvedRunUrl,
        })
      } else if (logMissingAuthState) {
        log.warn("agent.auth_state_missing", {
          sessionId: request.sessionId,
          projectId: request.projectId,
          testCaseId: request.testCaseId,
          authProfileId: authProfile.id,
          authProfileName: authProfile.name,
          targetUrl: resolvedRunUrl,
        })
      }
    }
  }

  try {
    const warmupResult = await agentWarmupService.executeWarmup({
      sessionId: request.sessionId,
      mode,
      taskRunId: request.taskRunId,
      project,
      testCase,
      resolvedRunTargetId: resolvedRunTarget.id,
      resolvedRunUrl,
      authStorageStateJson,
      provider: current.session.provider,
      llmOwnerKey: ownerKey,
      onStep,
      updateSession,
    })

    return {
      ...warmupResult,
      hasWorkspace,
      resolvedRunTargetId: resolvedRunTarget.id,
      resolvedRunUrl,
      authStorageStateJson,
    }
  } catch (error) {
    if (session.warmupRunId) {
      const run = await runService.getRunStateService().getRun(session.warmupRunId)
      if (run) {
        run.status = "failed"
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${error instanceof Error ? error.message : String(error)}`)
        run.finishedAt = now()
        runService.getRunStateService().saveRunSnapshot(run)
        runService.getRunStateService().notifyRun(run)
      }
    }
    throw error
  }
}