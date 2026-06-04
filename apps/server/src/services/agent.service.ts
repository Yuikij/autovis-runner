import { AutoVisDatabase } from "../db.js"
import { appOrigin, artifactsDir, createId, escapeSingleQuotedString, escapeTemplateComment, now } from "./common.js"
import { type SuiteService } from "./suite.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import { type ProjectService } from "./project.service.js"
import { type RunService } from "./run.service.js"
import { CopilotSessionError } from "../copilot.js"
import { generateScriptWithLlm } from "../llm.js"
import { runAgentLoop } from "../agent.js"
import { AgentWarmupService } from "./agent-warmup.service.js"
import { getPageSnapshot } from "../agent/helpers.js"
import { type InitialPageState, type PreconditionReport } from "../agent/types.js"

import { finalizeRunnerSession, failRunnerSession, createExecutionStep, createExecutionTemplate, createRunnerSession, executeScriptInSession, type RunnerSession } from "@autovis/runner"
import {
  type AgentSession,
  type AgentStep,
  type DirectExecutionResult,
  type DirectOperationStep,
  type GenerateScriptRequest,
  type HumanHandoffRequest,
  type RuntimeOutput,
  type ScriptArtifact,
  type StartDirectAgentRequest,
} from "@autovis/shared"
import { TaskControlRegistry } from "./task-control.js"

type LlmOwned = { llmOwnerKey?: string }

export class AgentService {
  private readonly agentSubscribers = new Map<string, Set<(session: AgentSession) => void>>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService,
    private readonly projectService: ProjectService,
    private readonly runService: RunService,
    private readonly agentWarmupService: AgentWarmupService,
    private readonly tasks: TaskControlRegistry,
  ) {}

  public getAgentSession(sessionId: string): AgentSession | undefined {
    return this.db.getAgentSession(sessionId)
  }

  public findActiveAgentForCase(testCaseId: string): AgentSession | undefined {
    const ctrl = this.tasks.findActiveForCase("agent", testCaseId)
    if (!ctrl) return undefined
    return this.db.getAgentSession(ctrl.id)
  }

  public listActiveAgents(projectId?: string): AgentSession[] {
    return this.tasks
      .listByKind("agent")
      .map((ctrl) => this.db.getAgentSession(ctrl.id))
      .filter((session): session is AgentSession => Boolean(session) && (!projectId || session!.projectId === projectId))
  }

  public pauseAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    if (!ctrl.pause()) return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "paused"
      session.pausedAt = now()
      this.persistAndNotifyAgent(session)
    }
    return true
  }

  public resumeAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    if (!ctrl.resume()) return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "running"
      session.pausedAt = undefined
      this.persistAndNotifyAgent(session)
    }
    return true
  }

  public cancelAgent(sessionId: string): boolean {
    const ctrl = this.tasks.get(sessionId)
    if (!ctrl || ctrl.kind !== "agent") return false
    const session = this.db.getAgentSession(sessionId)
    if (session) {
      session.status = "cancelling"
      this.persistAndNotifyAgent(session)
    }
    return ctrl.cancel("Agent 已被用户取消。")
  }

  public subscribeAgent(sessionId: string, listener: (session: AgentSession) => void) {
    const set = this.agentSubscribers.get(sessionId) ?? new Set<(session: AgentSession) => void>()
    set.add(listener)
    this.agentSubscribers.set(sessionId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.agentSubscribers.delete(sessionId)
      }
    }
  }

  private persistAndNotifyAgent(session: AgentSession) {
    this.db.upsertAgentSession(session)
    this.db.replaceAgentSteps(session.id, session.steps)
    this.agentSubscribers.get(session.id)?.forEach((listener) => listener(session))
  }

  private createAgentSession(request: { sessionId: string; projectId: string; testCaseId: string; taskRunId?: string }, mode: "generate" | "direct" = "generate"): AgentSession {
    return {
      id: request.sessionId,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      taskRunId: request.taskRunId,
      mode,
      status: "running",
      verificationStatus: "idle",
      steps: [],
      preconditionSummary: [],
      startedAt: now(),
    }
  }

  private appendOrUpdateStep(session: AgentSession, step: AgentStep) {
    const existing = session.steps.find((item) => item.id === step.id)
    if (existing) {
      Object.assign(existing, step)
    } else {
      session.steps.push({ ...step })
    }
    this.persistAndNotifyAgent(session)
  }

  public createScriptArtifact(testCaseId: string, provider: ScriptArtifact["provider"], prompt: string, code: string, source: ScriptArtifact["source"] = "generated"): ScriptArtifact {
    const nextVersion = this.db.listScriptsForTestCase(testCaseId).length + 1
    return {
      id: createId("script"),
      testCaseId,
      version: nextVersion,
      source,
      provider,
      prompt,
      code,
      createdAt: now(),
    }
  }

  public async saveScriptVersion(testCaseId: string, input: { code: string; baseScriptId?: string; prompt?: string }) {
    const testCase = this.db.getTestCase(testCaseId)
    if (!testCase) {
      throw new Error("Test case not found")
    }

    if (input.baseScriptId) {
      const baseScript = this.db.getScript(input.baseScriptId)
      if (!baseScript || baseScript.testCaseId !== testCaseId) {
        throw new Error("Base script not found")
      }
    }

    const script = this.createScriptArtifact(
      testCaseId,
      "manual-editor",
      input.prompt?.trim() || (input.baseScriptId ? `Manual editor save from ${input.baseScriptId}` : "Manual editor save"),
      input.code,
      "manual",
    )
    this.db.insertScript(script)
    return script
  }

  public async generateScript(request: GenerateScriptRequest & LlmOwned) {
    const ownerKey = request.llmOwnerKey ?? "shared"
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const project = this.db.getProject(request.projectId)
    const testCase = this.db.getTestCase(request.testCaseId)
    if (!project || !testCase) {
      throw new Error("Project or test case not found")
    }

    const codeContextFiles = await this.projectService.getWorkspaceCodeContext(request.projectId)
    const codeContext = codeContextFiles.length > 0
      ? codeContextFiles.map((file) => `// --- ${escapeTemplateComment(file.path)} ---\n// ${escapeTemplateComment(file.content).split("\n").join("\n// ")}`).join("\n\n")
      : ""

    const promptSummary = request.prompt
      .trim()
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `// ${escapeTemplateComment(line)}`)
      .join("\n")
    const scriptedSteps = testCase.steps.map((step, index) => `  // Step ${index + 1}: ${escapeTemplateComment(step)}`).join("\n")

    // 与 runScriptAgent 一致：必须由前端下拉显式选 URL；不再用 project.testBaseUrl 兜底。
    if (!request.runTargetUrlId) {
      throw new Error("生成脚本需要先在工作台选择一个目标 URL。")
    }
    const resolvedMockTarget = this.db.resolveTargetUrl(request.projectId, request.runTargetUrlId)
    if (!resolvedMockTarget?.url) {
      throw new Error(`所选的目标 URL 不存在或已被删除（targetUrlId=${request.runTargetUrlId}）。请刷新页面后重新选择。`)
    }
    const baseUrl = resolvedMockTarget.url

    let generatedCode = `import { test, expect } from '@playwright/test';
${codeContext ? `\n// === Code context (DOM reference) ===\n${codeContext}\n` : ""}
test('${escapeSingleQuotedString(`${testCase.caseCode} ${testCase.purpose}`)}', async ({ page }) => {
  await page.goto('${escapeSingleQuotedString(baseUrl)}');

${scriptedSteps}

  await expect(page.getByText('${escapeSingleQuotedString(testCase.expectedResult)}')).toBeVisible();
});

${promptSummary || "// Prompt summary: (empty)"}`

    if (current.session.connectionStatus === "connected") {
      try {
        generatedCode = await generateScriptWithLlm({
          request,
          project,
          testCase,
          session: current.session,
          secrets: current.secrets,
        })
        current.session.lastError = undefined
      } catch (error) {
        const message = error instanceof Error
          ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
          : "LLM generation failed"
        if (error instanceof CopilotSessionError && error.statusCode === 401 && current.session.provider === "copilot-proxy") {
          const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
          this.llmService.applyCopilotSessionError(bundle, message, {
            disconnect: true,
            clearSecrets: true,
          })
          current.session = bundle.session
          current.secrets = { ...current.secrets, copilot: bundle.secrets }
        } else {
          current.session.lastError = message
          current.session.lastSyncedAt = now()
        }
        this.llmService.saveLlmConfigState(state, ownerKey)
        console.warn("LLM generation failed, falling back to template:", message)
      }
    }

    const nextScript = this.createScriptArtifact(testCase.id, current.session.provider, request.prompt, generatedCode)
    current.session.lastSyncedAt = now()
    current.session.lastError = undefined
    this.db.insertScript(nextScript)
    this.llmService.saveLlmConfigState(state, ownerKey)
    return nextScript
  }



  public async runScriptAgent(request: GenerateScriptRequest & { sessionId: string } & LlmOwned) {
    const ownerKey = request.llmOwnerKey ?? "shared"
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const project = this.db.getProject(request.projectId)
    const testCase = this.db.getTestCase(request.testCaseId)
    if (!project || !testCase) {
      throw new Error("Project or test case not found")
    }

    const existing = this.tasks.findActiveForCase("agent", request.testCaseId)
    if (existing) {
      const existingSession = this.db.getAgentSession(existing.id)
      const conflict = new Error("当前用例已有进行中的脚本生成任务。") as Error & {
        code?: string
        conflictId?: string
        conflictKind?: string
        conflictStatus?: string
      }
      conflict.code = "TASK_CONFLICT"
      conflict.conflictId = existing.id
      conflict.conflictKind = "agent"
      conflict.conflictStatus = existingSession?.status ?? existing.state
      throw conflict
    }

    const session = this.createAgentSession(request)
    this.persistAndNotifyAgent(session)

    const taskController = this.tasks.create({
      kind: "agent",
      id: session.id,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
    })
    const abortController = { signal: taskController.signal } as { signal: AbortSignal }

    const hasWorkspace = await this.projectService.hasWorkspace(request.projectId)

    const onStep = (step: AgentStep) => {
      this.appendOrUpdateStep(session, step)
    }

      let warmupSession: RunnerSession | null = null
      let initialPageState: InitialPageState | undefined
      let preconditionReport: PreconditionReport = { status: "none", suites: [] }
      let warmupRuntimeOutputs: RuntimeOutput[] = []

    try {
      if (current.session.connectionStatus !== "connected") {
        throw new Error("当前 AI 配置未连接，请先完成授权或填写 API Key。")
      }

      // 业务上不再使用 project.testBaseUrl 作为生成兜底——必须从下拉中选择一个 TargetUrl。
      // resolveTargetUrl 在 targetUrlId 命中时只看 target_urls 行，不会回落到 project.testBaseUrl。
      if (!request.runTargetUrlId) {
        throw new Error("生成脚本需要先在工作台选择一个目标 URL。")
      }
      const resolvedRunTarget = this.db.resolveTargetUrl(request.projectId, request.runTargetUrlId)
      if (!resolvedRunTarget?.url) {
        throw new Error(`所选的目标 URL 不存在或已被删除（targetUrlId=${request.runTargetUrlId}）。请刷新页面后重新选择。`)
      }
      const resolvedRunUrl = resolvedRunTarget.url

      // 解析登录态：若用例绑定了 authProfileId，取对应 targetUrl 的 storageState 注入浏览器。
      let authStorageStateJson: string | undefined
      if (testCase.authProfileId && resolvedRunTarget.id) {
        const authProfile = this.db.getAuthProfile(testCase.authProfileId)
        if (authProfile) {
          const stateRow = this.db.getAuthProfileState(authProfile.id, resolvedRunTarget.id)
          if (stateRow?.storageStateJson) {
            authStorageStateJson = stateRow.storageStateJson
            console.log(`[agent ${request.sessionId}] 注入登录态: profile=${authProfile.name} targetUrl=${resolvedRunUrl}`)
          } else {
            console.warn(`[agent ${request.sessionId}] 用例绑定了登录态 ${authProfile.name}，但 targetUrl=${resolvedRunUrl} 尚未采集 storageState，将以未登录状态生成脚本。`)
          }
        }
      }

      if (resolvedRunUrl) {
        try {
          const warmupResult = await this.agentWarmupService.executeWarmup({
            sessionId: request.sessionId,
            mode: "generate",
            project,
            testCase,
            resolvedRunTargetId: resolvedRunTarget.id,
            resolvedRunUrl,
            authStorageStateJson,
            provider: current.session.provider,
            llmOwnerKey: ownerKey,
            onStep,
            updateSession: (patch) => {
              if (patch.preconditionSummary !== undefined) {
                session.preconditionSummary = patch.preconditionSummary
              }
              if (patch.warmupRunId !== undefined) {
                session.warmupRunId = patch.warmupRunId
              }
              this.persistAndNotifyAgent(session)
            }
          })
          
          warmupSession = warmupResult.warmupSession
          initialPageState = warmupResult.initialPageState
          preconditionReport = warmupResult.preconditionReport
          warmupRuntimeOutputs = warmupResult.warmupRuntimeOutputs
        } catch (error) {
          if (session.warmupRunId) {
            const run = await this.runService.getRunStateService().getRun(session.warmupRunId)
            if (run) {
              run.status = "failed"
              run.logs.push(`[${new Date().toLocaleTimeString()}] ${error instanceof Error ? error.message : String(error)}`)
              run.finishedAt = now()
              this.runService.getRunStateService().saveRunSnapshot(run)
              this.runService.getRunStateService().notifyRun(run)
            }
          }
          throw error
        }
      }

      let agentPrompt = request.prompt
      let initialVerifiedCode = ""
      if (request.baseScriptId) {
        const baseScript = this.db.getScript(request.baseScriptId)
        if (!baseScript || baseScript.testCaseId !== testCase.id) {
          throw new Error("Base script not found")
        }
        agentPrompt = [
          `当前脚本版本: v${baseScript.version}`,
          "请基于下面这份现有脚本做修改，使用 execute_step 逐步验证修改后的代码。",
          "",
          "现有脚本:",
          baseScript.code,
          "",
          "修改要求:",
          request.prompt,
        ].join("\n")
        initialVerifiedCode = baseScript.code
      }

      const finalCode = await runAgentLoop({
        request: { ...request, prompt: agentPrompt },
        project,
        effectiveBaseUrl: resolvedRunUrl,
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
        browser: warmupSession?.browser,
        browserContext: warmupSession?.context,
        page: warmupSession?.page,
        preconditionSummary: session.preconditionSummary,
        preconditionReport,
        initialPageState,
        hasWorkspace,
        analyzeImage: (input) => this.runService.analyzeImageWithCurrentLlm(input, ownerKey),
        signal: abortController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
        lastVerifiedCode: initialVerifiedCode,
        runtimeContext: {
          outputs: warmupRuntimeOutputs,
          tempValues: new Map<string, unknown>(),
          producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
        },
        authStorageStateJson,
      })

      const script = this.createScriptArtifact(testCase.id, current.session.provider, request.prompt, finalCode)
      this.db.insertScript(script)
      session.resultScriptId = script.id
      session.latestScriptId = script.id

      const generationDone: AgentStep = {
        id: createId("agent_generation"),
        type: "generation",
        stage: "generation",
        title: "脚本已落库",
        content: `脚本 v${script.version} 已保存（增量生成过程中已逐步验证）。`,
        status: "completed",
        timestamp: now(),
        scriptId: script.id,
      }
      onStep(generationDone)

      current.session.lastSyncedAt = now()
      current.session.lastError = undefined
      this.llmService.saveLlmConfigState(state, ownerKey)

      session.status = "completed"
      session.verificationStatus = "passed"
      session.warmupRunId = undefined
      session.finishedAt = now()
      session.finalSummary = "脚本已通过增量生成并逐步验证完成。"
      this.persistAndNotifyAgent(session)
    } catch (error) {
      const message = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
        : "Agent 执行失败"
      const wasCancelled = taskController.signal.aborted
      session.status = wasCancelled ? "cancelled" : "error"
      
      session.warmupRunId = undefined
      session.error = message
      session.finishedAt = now()
      session.pausedAt = undefined
      this.appendOrUpdateStep(session, {
        id: `step_err_${Math.random().toString(36).slice(2, 8)}`,
        type: "error",
        stage: "verification",
        title: wasCancelled ? "Agent 已取消" : "Agent 执行失败",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.persistAndNotifyAgent(session)

      if (!wasCancelled && error instanceof CopilotSessionError && error.statusCode === 401) {
        const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
        this.llmService.applyCopilotSessionError(bundle, message, { disconnect: true, clearSecrets: true })
        current.session = bundle.session
        current.secrets = { ...current.secrets, copilot: bundle.secrets }
        this.llmService.saveLlmConfigState(state, ownerKey)
      }
    } finally {
      this.tasks.unregister(session.id)
      if (warmupSession) {
        await warmupSession.context.close().catch(() => undefined)
        await warmupSession.browser.close().catch(() => undefined)
      }
    }
  }

  private buildDirectResult(steps: AgentStep[]): DirectExecutionResult {
    const operationSteps: DirectOperationStep[] = steps
      .filter((s) => s.type === "tool_call" && s.toolName !== "execute_step")
      .map((s, i) => ({
        index: i + 1,
        action: s.toolName!,
        description: s.title,
        status: s.status === "error" ? "error" as const : "completed" as const,
        screenshotUrl: s.screenshotUrl,
        url: s.url,
        timestamp: s.timestamp,
      }))
    const lastGeneration = [...steps].reverse().find((s) => s.type === "generation")
    return {
      operationSteps,
      outcome: operationSteps.some((s) => s.status === "error") ? "partial" : "completed",
      summary: lastGeneration?.content,
    }
  }

  public async runDirectAgent(request: StartDirectAgentRequest & { sessionId: string } & LlmOwned) {
    const ownerKey = request.llmOwnerKey ?? "shared"
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, ownerKey)
    const project = this.db.getProject(request.projectId)
    const testCase = this.db.getTestCase(request.testCaseId)
    if (!project || !testCase) {
      throw new Error("Project or test case not found")
    }

    const existing = this.tasks.findActiveForCase("agent", request.testCaseId)
    if (existing) {
      const existingSession = this.db.getAgentSession(existing.id)
      const conflict = new Error("当前用例已有进行中的 Agent 任务。") as Error & {
        code?: string
        conflictId?: string
        conflictKind?: string
        conflictStatus?: string
      }
      conflict.code = "TASK_CONFLICT"
      conflict.conflictId = existing.id
      conflict.conflictKind = "agent"
      conflict.conflictStatus = existingSession?.status ?? existing.state
      throw conflict
    }

    const session = this.createAgentSession({
      sessionId: request.sessionId,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      taskRunId: request.taskRunId,
    }, "direct")
    this.persistAndNotifyAgent(session)

    const taskController = this.tasks.create({
      kind: "agent",
      id: session.id,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
    })
    const abortController = { signal: taskController.signal } as { signal: AbortSignal }

    const hasWorkspace = await this.projectService.hasWorkspace(request.projectId)

    const onStep = (step: AgentStep) => {
      this.appendOrUpdateStep(session, step)
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

    let warmupSession: RunnerSession | null = null
    let warmupRunForDisplay: import("@autovis/shared").ExecutionRun | null = null
    let initialPageState: InitialPageState | undefined
    let preconditionReport: PreconditionReport = { status: "none", suites: [] }
    let warmupRuntimeOutputs: RuntimeOutput[] = []

    try {
      if (current.session.connectionStatus !== "connected") {
        throw new Error("当前 AI 配置未连接，请先完成授权或填写 API Key。")
      }

      if (!request.runTargetUrlId) {
        throw new Error("直接执行需要先选择一个目标 URL。")
      }
      const resolvedRunTarget = this.db.resolveTargetUrl(request.projectId, request.runTargetUrlId)
      if (!resolvedRunTarget?.url) {
        throw new Error(`所选的目标 URL 不存在或已被删除（targetUrlId=${request.runTargetUrlId}）。请刷新页面后重新选择。`)
      }
      const resolvedRunUrl = resolvedRunTarget.url

      let authStorageStateJson: string | undefined
      if (testCase.authProfileId && resolvedRunTarget.id) {
        const authProfile = this.db.getAuthProfile(testCase.authProfileId)
        if (authProfile) {
          const stateRow = this.db.getAuthProfileState(authProfile.id, resolvedRunTarget.id)
          if (stateRow?.storageStateJson) {
            authStorageStateJson = stateRow.storageStateJson
            console.log(`[agent ${request.sessionId}] 注入登录态: profile=${authProfile.name} targetUrl=${resolvedRunUrl}`)
          }
        }
      }

      if (resolvedRunUrl) {
        try {
          const warmupResult = await this.agentWarmupService.executeWarmup({
            sessionId: request.sessionId,
            mode: "direct",
            taskRunId: request.taskRunId,
            project,
            testCase,
            resolvedRunTargetId: resolvedRunTarget.id,
            resolvedRunUrl,
            authStorageStateJson,
            provider: current.session.provider,
            llmOwnerKey: ownerKey,
            onStep,
            updateSession: (patch) => {
              if (patch.preconditionSummary !== undefined) {
                session.preconditionSummary = patch.preconditionSummary
              }
              if (patch.warmupRunId !== undefined) {
                session.warmupRunId = patch.warmupRunId
              }
              this.persistAndNotifyAgent(session)
            }
          })
          
          warmupSession = warmupResult.warmupSession
          warmupRunForDisplay = warmupResult.warmupRunForDisplay
          initialPageState = warmupResult.initialPageState
          preconditionReport = warmupResult.preconditionReport
          warmupRuntimeOutputs = warmupResult.warmupRuntimeOutputs
        } catch (error) {
          if (session.warmupRunId) {
            const run = await this.runService.getRunStateService().getRun(session.warmupRunId)
            if (run) {
              run.status = "failed"
              run.logs.push(`[${new Date().toLocaleTimeString()}] ${error instanceof Error ? error.message : String(error)}`)
              run.finishedAt = now()
              this.runService.getRunStateService().saveRunSnapshot(run)
              this.runService.getRunStateService().notifyRun(run)
            }
          }
          throw error
        }
      }

      await runAgentLoop({
        mode: "direct",
        request: { projectId: request.projectId, testCaseId: request.testCaseId, prompt: request.prompt, runTargetUrlId: request.runTargetUrlId },
        project,
        effectiveBaseUrl: resolvedRunUrl,
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
        browser: warmupSession?.browser,
        browserContext: warmupSession?.context,
        page: warmupSession?.page,
        preconditionSummary: session.preconditionSummary,
        preconditionReport,
        initialPageState,
        hasWorkspace,
        analyzeImage: (input) => this.runService.analyzeImageWithCurrentLlm(input, ownerKey),
        signal: abortController.signal,
        waitIfPaused: () => taskController.waitIfPaused(),
        runtimeContext: {
          outputs: warmupRuntimeOutputs,
          tempValues: new Map<string, unknown>(),
          producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
        },
        authStorageStateJson,
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

      const doneStep: AgentStep = {
        id: createId("agent_direct_done"),
        type: "generation",
        stage: "generation",
        title: "直接执行完成",
        content: session.directResult.summary || `共执行 ${session.directResult.operationSteps.length} 个操作步骤。`,
        status: "completed",
        timestamp: now(),
      }
      onStep(doneStep)

      current.session.lastSyncedAt = now()
      current.session.lastError = undefined
      this.llmService.saveLlmConfigState(state, ownerKey)

      session.status = "completed"
      session.verificationStatus = "idle"
      session.finishedAt = now()
      session.finalSummary = session.directResult.summary || "直接执行完成。"
      this.persistAndNotifyAgent(session)
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
      this.appendOrUpdateStep(session, {
        id: `step_err_${Math.random().toString(36).slice(2, 8)}`,
        type: "error",
        stage: "verification",
        title: wasCancelled ? "Agent 已取消" : "Agent 执行失败",
        content: message,
        status: "error",
        timestamp: now(),
      })
      this.persistAndNotifyAgent(session)

      if (!wasCancelled && error instanceof CopilotSessionError && error.statusCode === 401) {
        const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
        this.llmService.applyCopilotSessionError(bundle, message, { disconnect: true, clearSecrets: true })
        current.session = bundle.session
        current.secrets = { ...current.secrets, copilot: bundle.secrets }
        this.llmService.saveLlmConfigState(state, ownerKey)
      }
    } finally {
      this.tasks.unregister(session.id)
      if (warmupSession) {
        await warmupSession.context.close().catch(() => undefined)
        await warmupSession.browser.close().catch(() => undefined)
      }
    }
  }

  /**
   * 任务编排中无脚本用例的 AI 直接执行入口。
   * 自动从用例的 purpose/steps/expectedResult 组成 prompt，使用 runDirectAgent 执行。
   * 返回启动的 AgentSession（可通过 getAgentSession 轮询状态）。
   */
  public async startDirectAgentForTask(opts: {
    projectId: string
    testCaseId: string
    targetUrlId?: string
    taskRunId: string
  }): Promise<import("@autovis/shared").AgentSession> {
    const testCase = this.db.getTestCase(opts.testCaseId)
    if (!testCase) throw new Error(`用例 ${opts.testCaseId} 不存在`)

    const promptParts: string[] = [`请执行以下测试任务：${testCase.purpose || testCase.caseCode}`]
    if (testCase.steps.length > 0) {
      promptParts.push("执行步骤：", ...testCase.steps.map((s, i) => `${i + 1}. ${s}`))
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
    })

    // 等 session 被写入 DB 后返回（runDirectAgent 开头即 persistAndNotifyAgent）
    for (let i = 0; i < 40; i++) {
      const session = this.db.getAgentSession(sessionId)
      if (session) return session
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error("等待 Agent session 初始化超时")
  }
}
