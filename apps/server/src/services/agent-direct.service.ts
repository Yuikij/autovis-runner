import { failRunnerSession, finalizeRunnerSession } from "@autovis/runner"
import {
  type AgentSession,
  type AgentStep,
  type DirectExecutionResult,
  type DirectOperationStep,
  type ExecutionRun,
  type StartDirectAgentRequest,
} from "@autovis/shared"

import { runAgentLoop } from "../agent.js"
import { AutoVisDatabase } from "../db.js"
import { artifactsDir, createId, now } from "./common.js"
import type { AgentWarmupService } from "./agent-warmup.service.js"
import type { LlmConfigService } from "./llm-config.service.js"
import type { ProjectService } from "./project.service.js"
import type { RunService } from "./run.service.js"
import { AgentSessionService } from "./agent-session.service.js"
import {
  type LlmOwned,
  closeWarmupSession,
  createAgentConflictError,
  ensureProjectAndTestCase,
  getOwnerKey,
  handleUnauthorizedCopilotError,
  prepareAgentExecutionContext,
} from "./agent-runtime-context.js"

export class AgentDirectService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly projectService: ProjectService,
    private readonly llmService: LlmConfigService,
    private readonly runService: RunService,
    private readonly agentWarmupService: AgentWarmupService,
    private readonly sessionService: AgentSessionService,
  ) {}

  private buildDirectResult(steps: AgentStep[]): DirectExecutionResult {
    const operationSteps: DirectOperationStep[] = steps
      .filter((step) => step.type === "tool_call" && step.toolName !== "execute_step")
      .map((step, index) => ({
        index: index + 1,
        action: step.toolName!,
        description: step.title,
        status: step.status === "error" ? "error" : "completed",
        screenshotUrl: step.screenshotUrl,
        url: step.url,
        timestamp: step.timestamp,
      }))
    const lastGeneration = [...steps].reverse().find((step) => step.type === "generation")
    return {
      operationSteps,
      outcome: operationSteps.some((step) => step.status === "error") ? "partial" : "completed",
      summary: lastGeneration?.content,
    }
  }

  public async runDirectAgent(request: StartDirectAgentRequest & { sessionId: string; stealthOverride?: boolean } & LlmOwned) {
    const ownerKey = getOwnerKey(request)
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const { project, testCase } = ensureProjectAndTestCase(this.db, request.projectId, request.testCaseId)

    const existing = this.sessionService.findActiveAgentConflict(request.testCaseId)
    if (existing) {
      throw createAgentConflictError("当前用例已有进行中的 Agent 任务。", existing.id, existing.status)
    }

    const session = this.sessionService.createAgentSession({
      sessionId: request.sessionId,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      taskRunId: request.taskRunId,
    }, "direct")
    this.sessionService.persistAndNotifyAgent(session)

    const preparingStepId = `prep_${session.id}`
    let preparingResolved = false
    const resolvePreparingStep = () => {
      if (preparingResolved) return
      preparingResolved = true
      this.sessionService.appendOrUpdateStep(session, {
        id: preparingStepId,
        type: "thinking",
        stage: "page",
        title: "执行环境准备完成",
        content: "浏览器与前置依赖已就绪，开始执行任务。",
        status: "completed",
        timestamp: now(),
      })
    }

    let warmupRunForDisplay: ExecutionRun | null = null
    const onStep = (step: AgentStep) => {
      // 第一个真实步骤到达时，把"准备中"步骤收尾，避免两个 running 步骤并存。
      if (step.id !== preparingStepId) {
        resolvePreparingStep()
      }
      this.sessionService.appendOrUpdateStep(session, step)
      if (!warmupRunForDisplay) return
      const runLogParts = [step.title, step.content, step.detail].filter(Boolean)
      if (runLogParts.length) {
        warmupRunForDisplay.logs.push(`[${new Date().toLocaleTimeString()}] ${runLogParts.join(" · ")}`)
      }
      const runningIndex = warmupRunForDisplay.steps.findIndex((item) => item.status === "running")
      if (runningIndex >= 0) {
        warmupRunForDisplay.steps[runningIndex].log = step.title
        if (step.screenshotUrl) {
          warmupRunForDisplay.steps[runningIndex].screenshotUrl = step.screenshotUrl
          warmupRunForDisplay.currentViewport = step.screenshotUrl
        }
      }
      this.runService.getRunStateService().saveRunSnapshot(warmupRunForDisplay)
      this.runService.getRunStateService().notifyRun(warmupRunForDisplay)
    }

    onStep({
      id: preparingStepId,
      type: "thinking",
      stage: "page",
      title: "正在准备执行环境",
      content: "已接收执行请求，正在初始化浏览器与前置依赖……首次启动浏览器可能较慢，请稍候。",
      status: "running",
      timestamp: now(),
    })

    let taskController: ReturnType<AgentSessionService["createManagedController"]>
    try {
      taskController = this.sessionService.createManagedController(
        session,
        { ...request, mode: "direct", sessionId: session.id },
        () => ({
          mode: session.mode,
          status: session.status,
          verificationStatus: session.verificationStatus,
          stepCount: session.steps.length,
          latestRunId: session.latestRunId ?? null,
          warmupRunId: session.warmupRunId ?? null,
          pausedAt: session.pausedAt ?? null,
        }),
      )
    } catch (controllerError) {
      // 控制器/租约创建在主 try 之前，若不收敛会让会话永远停留在 running + 空步骤。
      const message = controllerError instanceof Error ? controllerError.message : String(controllerError)
      session.status = "error"
      session.error = message
      session.finishedAt = now()
      onStep({
        id: preparingStepId,
        type: "error",
        stage: "page",
        title: "无法启动执行任务",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.sessionService.persistAndNotifyAgent(session)
      throw controllerError
    }

    let warmupSession: Awaited<ReturnType<typeof prepareAgentExecutionContext>>["warmupSession"] = null
    let warmupRunId: string | undefined

    try {
      const prepared = await prepareAgentExecutionContext({
        mode: "direct",
        request,
        ownerKey,
        current,
        db: this.db,
        projectService: this.projectService,
        runService: this.runService,
        agentWarmupService: this.agentWarmupService,
        session,
        project,
        testCase,
        onStep,
        updateSession: (patch) => {
          if (patch.preconditionSummary !== undefined) {
            session.preconditionSummary = patch.preconditionSummary
          }
          if (patch.warmupRunId !== undefined) {
            session.warmupRunId = patch.warmupRunId
            warmupRunId = patch.warmupRunId ?? warmupRunId
          }
          this.sessionService.persistAndNotifyAgent(session)
        },
      })

      warmupSession = prepared.warmupSession
      warmupRunForDisplay = prepared.warmupRunForDisplay

      await runAgentLoop({
        mode: "direct",
        request: {
          projectId: request.projectId,
          testCaseId: request.testCaseId,
          prompt: request.prompt,
          runTargetUrlId: request.runTargetUrlId,
        },
        project,
        effectiveBaseUrl: prepared.resolvedRunUrl,
        testCase,
        session: current.session,
        secrets: current.secrets,
        agentSessionId: session.id,
        artifactsDir,
        onStep,
        listWorkspaceTree: (path) => this.projectService.listWorkspaceTree(request.projectId, path),
        globWorkspacePaths: (pattern) => this.projectService.globWorkspacePaths(request.projectId, pattern),
        searchWorkspaceCode: (query, path, limit) => this.projectService.searchWorkspaceCode(request.projectId, query, path, limit),
        readWorkspaceFile: (path, offset, limit) => this.projectService.readWorkspaceFile(request.projectId, path, offset, limit),
        browser: prepared.warmupSession?.browser,
        browserContext: prepared.warmupSession?.context,
        page: prepared.warmupSession?.page,
        preconditionSummary: session.preconditionSummary,
        preconditionReport: prepared.preconditionReport,
        initialPageState: prepared.initialPageState,
        hasWorkspace: prepared.hasWorkspace,
        analyzeImage: (input) => this.runService.analyzeImageWithCurrentLlm(input, ownerKey),
        signal: taskController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
        runtimeContext: {
          outputs: prepared.warmupRuntimeOutputs,
          tempValues: new Map<string, unknown>(),
          producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
        },
        authStorageStateJson: prepared.authStorageStateJson,
        stealth: prepared.stealth,
      })

      session.directResult = this.buildDirectResult(session.steps)

      if (warmupRunForDisplay && warmupSession) {
        const displayRun = warmupRunForDisplay
        displayRun.logs.push(`[${new Date().toLocaleTimeString()}] AI 直接执行完成，开始归档产物。`)
        await finalizeRunnerSession({
          run: displayRun,
          session: warmupSession,
          onUpdate: async () => {
            this.runService.getRunStateService().saveRunSnapshot(displayRun)
            this.runService.getRunStateService().notifyRun(displayRun)
          },
          archiveStepIndex: displayRun.steps.length - 1,
        })
        session.latestRunId = displayRun.id
        warmupSession = null
      }

      onStep({
        id: createId("agent_direct_done"),
        type: "generation",
        stage: "generation",
        title: "直接执行完成",
        content: session.directResult.summary || `共执行 ${session.directResult.operationSteps.length} 个操作步骤。`,
        status: "completed",
        timestamp: now(),
      })

      current.session.lastSyncedAt = now()
      current.session.lastError = undefined
      this.llmService.saveLlmConfigState(state, ownerKey)

      session.status = "completed"
      session.verificationStatus = "idle"
      session.finishedAt = now()
      session.finalSummary = session.directResult.summary || "直接执行完成。"
      this.sessionService.persistAndNotifyAgent(session)
    } catch (error) {
      const message = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
        : "Agent 执行失败"
      const wasCancelled = taskController.signal.aborted
      session.status = wasCancelled ? "cancelled" : "error"

      if (session.warmupRunId && warmupSession && warmupRunForDisplay) {
        const displayRun = warmupRunForDisplay
        await failRunnerSession(
          displayRun,
          warmupSession,
          async () => {
            this.runService.getRunStateService().saveRunSnapshot(displayRun)
            this.runService.getRunStateService().notifyRun(displayRun)
          },
          new Error(message),
        )
        session.latestRunId = displayRun.id
        warmupSession = null
      }

      session.error = message
      session.finishedAt = now()
      session.pausedAt = undefined
      this.sessionService.appendOrUpdateStep(session, {
        id: `step_err_${Math.random().toString(36).slice(2, 8)}`,
        type: "error",
        stage: "verification",
        title: wasCancelled ? "Agent 已取消" : "Agent 执行失败",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.sessionService.persistAndNotifyAgent(session)

      handleUnauthorizedCopilotError({ error, message, llmService: this.llmService, state, current, ownerKey })
    } finally {
      this.sessionService.unregister(session.id)
      if (warmupRunId) {
        this.runService.getRunStateService().unregisterLiveViewportController(warmupRunId)
      }
      await closeWarmupSession(warmupSession)
    }
  }

  public async startDirectAgentForTask(opts: {
    projectId: string
    testCaseId: string
    targetUrlId?: string
    taskRunId: string
    stealth?: boolean
  }): Promise<AgentSession> {
    const testCase = this.db.getTestCase(opts.testCaseId)
    if (!testCase) throw new Error(`用例 ${opts.testCaseId} 不存在`)

    const promptParts: string[] = [`请执行以下测试任务：${testCase.purpose || testCase.caseCode}`]
    if (testCase.steps.length > 0) {
      promptParts.push("执行步骤：", ...testCase.steps.map((step, index) => `${index + 1}. ${step}`))
    }
    if (testCase.expectedResult) {
      promptParts.push(`预期结果：${testCase.expectedResult}`)
    }
    const prompt = promptParts.join("\n")

    const sessionId = `agent_task_${Math.random().toString(36).slice(2, 10)}`

    void this.runDirectAgent({
      sessionId,
      projectId: opts.projectId,
      testCaseId: opts.testCaseId,
      prompt,
      runTargetUrlId: opts.targetUrlId,
      taskRunId: opts.taskRunId,
      stealthOverride: opts.stealth,
    })

    for (let index = 0; index < 40; index += 1) {
      const session = this.db.getAgentSession(sessionId)
      if (session) return session
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error("等待 Agent session 初始化超时")
  }
}