import { AutoVisDatabase } from "../db.js"
import { appOrigin, artifactsDir, createId, escapeSingleQuotedString, escapeTemplateComment, now } from "./common.js"
import { type SuiteService } from "./suite.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import { type ProjectService } from "./project.service.js"
import { type RunService } from "./run.service.js"
import { CopilotSessionError } from "../copilot.js"
import { generateScriptWithLlm, generateValidationScriptWithLlmV2 } from "../llm.js"
import { runAgentLoop } from "../agent.js"
import { getPageSnapshot } from "../agent/helpers.js"
import { type InitialPageState, type PreconditionReport } from "../agent/types.js"
import {
  executeLoginStatusCheck,
  executeValidationScriptGeneration,
  type ValidationLlmCallInput,
  type ValidationStepEmitter,
} from "../agent/validation.js"
import { decorateAuthProfile } from "./authProfile.utils.js"
import { createExecutionStep, createExecutionTemplate, createRunnerSession, executeScriptInSession, type RunnerSession } from "@autovis/runner"
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
  type ValidationProgressStep,
  type ValidationTask,
  type ValidationTaskKind,
} from "@autovis/shared"
import { TaskControlRegistry } from "./task-control.js"

type LlmOwned = { llmOwnerKey?: string }

export class AgentService {
  private readonly agentSubscribers = new Map<string, Set<(session: AgentSession) => void>>()
  private readonly validationTasks = new Map<string, ValidationTask>()
  private readonly validationSubscribers = new Map<string, Set<(task: ValidationTask) => void>>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService,
    private readonly projectService: ProjectService,
    private readonly runService: RunService,
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

  private createAgentSession(request: { sessionId: string; projectId: string; testCaseId: string }, mode: "generate" | "direct" = "generate"): AgentSession {
    return {
      id: request.sessionId,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
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

  public getValidationTask(taskId: string): ValidationTask | undefined {
    return this.validationTasks.get(taskId)
  }

  public subscribeValidationTask(taskId: string, listener: (task: ValidationTask) => void): () => void {
    if (!this.validationSubscribers.has(taskId)) {
      this.validationSubscribers.set(taskId, new Set())
    }
    this.validationSubscribers.get(taskId)!.add(listener)
    return () => { this.validationSubscribers.get(taskId)?.delete(listener) }
  }

  private notifyValidationTask(task: ValidationTask) {
    this.validationTasks.set(task.id, { ...task })
    const subs = this.validationSubscribers.get(task.id)
    if (subs) {
      const snapshot = { ...task, steps: [...task.steps] }
      for (const listener of subs) listener(snapshot)
    }
  }

  private createValidationTask(profileId: string, kind: ValidationTaskKind, targetUrlId?: string): ValidationTask {
    const prefix = kind === "check" ? "vcheck" : "vtask"
    const taskId = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const task: ValidationTask = { id: taskId, profileId, kind, targetUrlId, status: "running", steps: [] }
    this.validationTasks.set(taskId, task)
    return task
  }

  private makeStepEmitter(taskId: string): ValidationStepEmitter {
    const getTask = () => this.validationTasks.get(taskId)
    return {
      emit: (step) => {
        const task = getTask()
        if (!task) return
        task.steps = [...task.steps, { ...step }]
        this.notifyValidationTask(task)
      },
      updateLast: (patch) => {
        const task = getTask()
        if (!task || task.steps.length === 0) return
        const lastIndex = task.steps.length - 1
        task.steps = [...task.steps.slice(0, lastIndex), { ...task.steps[lastIndex], ...patch }]
        this.notifyValidationTask(task)
      },
    }
  }

  public startGenerateValidationScript(projectId: string, profileId: string, targetUrlId?: string, llmOwnerKey = "shared"): string {
    const task = this.createValidationTask(profileId, "generate", targetUrlId)
    void this.runGenerateValidationScript(task.id, projectId, profileId, targetUrlId, llmOwnerKey).catch((err) => {
      const current = this.validationTasks.get(task.id)
      if (!current) return
      current.status = "error"
      current.error = err instanceof Error ? err.message : String(err)
      current.steps = [
        ...current.steps,
        {
          kind: "result",
          label: "任务终止",
          status: "error",
          detail: current.error,
        },
      ]
      this.notifyValidationTask(current)
    })
    return task.id
  }

  public startCheckLoginStatus(projectId: string, profileId: string, targetUrlId: string): string {
    const task = this.createValidationTask(profileId, "check", targetUrlId)
    void this.runCheckLoginStatus(task.id, projectId, profileId, targetUrlId).catch((err) => {
      const current = this.validationTasks.get(task.id)
      if (!current) return
      current.status = "error"
      current.error = err instanceof Error ? err.message : String(err)
      current.steps = [
        ...current.steps,
        {
          kind: "result",
          label: "重放终止",
          status: "error",
          detail: current.error,
        },
      ]
      this.notifyValidationTask(current)
    })
    return task.id
  }

  private resolveTargetUrlForProfile(projectId: string, targetUrlId?: string) {
    const resolved = this.db.resolveTargetUrl(projectId, targetUrlId)
    if (!resolved || !resolved.id) {
      throw new Error("无法解析目标 URL：请确认登录态对应的 URL 已加入项目网址管理。")
    }
    const targetUrl = this.db.getTargetUrl(resolved.id)
    if (!targetUrl) throw new Error("无法找到目标 URL 记录")
    return targetUrl
  }

  private async runGenerateValidationScript(taskId: string, projectId: string, profileId: string, targetUrlId?: string, llmOwnerKey = "shared") {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error("Project not found")
    const authProfile = this.db.getAuthProfile(profileId)
    if (!authProfile) throw new Error("Auth profile not found")

    const targetUrl = this.resolveTargetUrlForProfile(projectId, targetUrlId)
    const state = this.db.getAuthProfileState(profileId, targetUrl.id)
    if (!state?.storageStateJson) {
      throw new Error(`目标 URL「${targetUrl.label}」尚未捕获 storageState。请先在概览页对该 URL 执行『刷新登录态』。`)
    }

    const { state: llmState, current } = this.llmService.getActiveLlmConfigBundle(undefined, llmOwnerKey)
    if (current.session.connectionStatus !== "connected") {
      throw new Error("当前 AI 配置未连接。失效校验脚本依赖 LLM 基于实际页面差异生成，无法在断连状态下安全生成。")
    }

    const emitter = this.makeStepEmitter(taskId)

    const callLlm = async (input: ValidationLlmCallInput) => {
      try {
        const code = await generateValidationScriptWithLlmV2({
          ...input,
          authProfileName: input.profile.name,
          authProfileDescription: input.profile.description,
          session: current.session,
          secrets: current.secrets,
        })
        current.session.lastError = undefined
        this.llmService.saveLlmConfigState(llmState, llmOwnerKey)
        return code
      } catch (error) {
        const message = error instanceof Error
          ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
          : "LLM generation failed"
        if (error instanceof CopilotSessionError && error.statusCode === 401 && current.session.provider === "copilot-proxy") {
          const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
          this.llmService.applyCopilotSessionError(bundle, message, { disconnect: true, clearSecrets: true })
          current.session = bundle.session
          current.secrets = { ...current.secrets, copilot: bundle.secrets }
        } else {
          current.session.lastError = message
          current.session.lastSyncedAt = now()
        }
        this.llmService.saveLlmConfigState(llmState, llmOwnerKey)
        throw error
      }
    }

    const { code } = await executeValidationScriptGeneration({
      taskId,
      project,
      authProfile,
      targetUrl,
      storageStateJson: state.storageStateJson,
      emitter,
      callLlm,
      maxAttempts: 3,
    })

    emitter.emit({ kind: "save", label: "校验脚本通过双向回归，正在落库", status: "running" })
    this.db.updateAuthProfileValidationScript(profileId, code)
    const updated = this.db.getAuthProfile(profileId)
    emitter.updateLast({ status: "done", detail: "已写入 auth_profile.validationScript" })
    emitter.emit({
      kind: "result",
      label: "校验脚本生成完成",
      status: "done",
      detail: "校验脚本对所有目标 URL 通用；可在概览页对其他 URL 单独执行『检查登录状态』。",
      codePreview: code,
    })

    const task = this.validationTasks.get(taskId)
    if (task) {
      task.status = "completed"
      task.resultProfile = decorateAuthProfile(updated) ?? undefined
      this.notifyValidationTask(task)
    }
  }

  private async runCheckLoginStatus(taskId: string, projectId: string, profileId: string, targetUrlId: string) {
    const project = this.db.getProject(projectId)
    if (!project) throw new Error("Project not found")
    const authProfile = this.db.getAuthProfile(profileId)
    if (!authProfile) throw new Error("Auth profile not found")

    const targetUrl = this.resolveTargetUrlForProfile(projectId, targetUrlId)
    const state = this.db.getAuthProfileState(profileId, targetUrl.id)
    if (!state?.storageStateJson) {
      throw new Error(`目标 URL「${targetUrl.label}」尚未捕获 storageState。请先在概览页执行『刷新登录态』。`)
    }

    const emitter = this.makeStepEmitter(taskId)
    const result = await executeLoginStatusCheck({
      taskId,
      project,
      authProfile,
      targetUrl,
      storageStateJson: state.storageStateJson,
      emitter,
    })

    const task = this.validationTasks.get(taskId)
    if (task) {
      task.status = "completed"
      task.checkResult = result
      task.error = result.valid ? undefined : result.error
      this.notifyValidationTask(task)
    }
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

      const preconditionPlan = this.suiteService.buildPreconditionPlan(testCase)
      session.preconditionSummary = preconditionPlan.nodes.map((entry) => `${entry.testCase.caseCode}: ${entry.testCase.purpose || entry.testCase.expectedResult}`)
      preconditionReport = {
        status: preconditionPlan.nodes.length > 0 ? "success" : "none",
        suites: preconditionPlan.nodes.map((entry) => ({
          kind: "case" as const,
          name: `前置用例 ${entry.testCase.caseCode}`,
          version: "",
          cases: [{
            caseCode: entry.testCase.caseCode,
            purpose: entry.testCase.purpose ?? "",
            expectedResult: entry.testCase.expectedResult ?? "",
            scriptCode: entry.script.code ?? "",
          }],
        })),
      }
      this.persistAndNotifyAgent(session)

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
          const warmupRun = createExecutionTemplate({
            runId: createId("warmup"),
            project,
            testCase,
            script: {
              id: createId("warmup_script"),
              testCaseId: testCase.id,
              version: 0,
              source: "generated",
              provider: current.session.provider,
              prompt: "precondition warmup",
              code: "",
              createdAt: now(),
            },
            testBaseUrl: resolvedRunUrl,
          })
          warmupRun.targetUrlId = resolvedRunTarget?.id
          warmupRun.kind = "temporary"
          warmupRun.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
          warmupRun.preconditionSummary = [...(session.preconditionSummary ?? [])]
          warmupRun.liveViewport = {
            mode: "ws-jpeg-stream",
            url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
            status: "connecting",
            mimeType: "image/jpeg",
          }
          this.runService.saveRunSnapshot(warmupRun)
          this.runService.notifyRun(warmupRun)
          session.warmupRunId = warmupRun.id
          this.persistAndNotifyAgent(session)

          onStep({
            id: createId("agent_precondition_warmup"),
            type: "thinking",
            stage: "page",
            title: "执行前置依赖预热",
            content: preconditionPlan.nodes.length > 0 ? `正在执行前置依赖项，为脚本生成准备浏览器状态。` : "当前用例没有前置依赖项，直接准备浏览器状态。",
            status: "running",
            timestamp: now(),
            runId: warmupRun.id,
          })

          const onWarmupUpdate = async () => {
            this.runService.saveRunSnapshot(warmupRun)
            this.runService.notifyRun(warmupRun)
          }

          warmupSession = await createRunnerSession({
            run: warmupRun,
            artifactsDir,
            headless: true,
            onUpdate: onWarmupUpdate,
            onLiveViewportEvent: async (event) => {
              if (event.type === "started") {
                warmupRun.liveViewport = {
                  mode: "ws-jpeg-stream",
                  url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
                  status: "live",
                  mimeType: "image/jpeg",
                  width: event.width,
                  height: event.height,
                }
                await onWarmupUpdate()
                return
              }
              if (event.type === "chunk" && event.chunk) {
                this.runService.notifyLiveViewport(warmupRun.id, event.chunk)
                return
              }
              if (event.type === "ended") {
                if (warmupRun.liveViewport) {
                  warmupRun.liveViewport = { ...warmupRun.liveViewport, status: "ended" }
                  await onWarmupUpdate()
                }
                return
              }
              warmupRun.liveViewport = {
                mode: "ws-jpeg-stream",
                url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
                status: "unavailable",
                mimeType: "image/jpeg",
              }
              await onWarmupUpdate()
            },
            initStepIndex: 0,
            storageStateJson: authStorageStateJson,
          })

          for (const dependency of preconditionPlan.nodes) {
            const stepIndex = warmupRun.steps.length - 1
            warmupRun.steps.splice(stepIndex, 0, createExecutionStep(warmupRun.id, warmupRun.steps.length + 1, `[前置用例] ${dependency.testCase.caseCode}`, `执行前置用例 ${dependency.testCase.caseCode}`, "precondition_case"))
            await onWarmupUpdate()
            await executeScriptInSession({
              run: warmupRun,
              session: warmupSession,
              script: dependency.script,
              onUpdate: onWarmupUpdate,
              requestHumanInput: async (handoffRequest: {
                reason: HumanHandoffRequest["reason"]
                instruction: string
                inputLabel?: string
                placeholder?: string
                confirmText?: string
                imageUrl?: string
                scope?: HumanHandoffRequest["scope"]
                suiteId?: string
                testCaseId?: string
              }) => {
                const value = await this.runService.requestRunHumanInput(warmupRun, handoffRequest)
                warmupRun.pendingHumanHandoff = undefined
                warmupRun.status = "running"
                this.runService.saveRunSnapshot(warmupRun)
                this.runService.notifyRun(warmupRun)
                return value
              },
              analyzeImage: (analysisRequest) => this.runService.analyzeImageWithCurrentLlm(analysisRequest, ownerKey),
              stepIndex,
              startedLog: `[前置用例 ${dependency.testCase.caseCode}] 开始执行。`,
              completedLog: `[前置用例 ${dependency.testCase.caseCode}] 执行完成。`,
              handoffContext: { scope: "precondition", testCaseId: dependency.testCase.id },
              screenshotFilePrefix: `warmup-${dependency.testCase.caseCode}`,
              runtimeProducer: { testCaseId: dependency.testCase.id, caseCode: dependency.testCase.caseCode, caseName: dependency.testCase.purpose },
            })
          }
          warmupRuntimeOutputs = warmupRun.runtimeOutputs ?? []
          preconditionReport.outputs = warmupRuntimeOutputs.map((output) => ({
            from: output.caseName || output.caseCode || output.testCaseId || "上游用例",
            description: output.description,
            valuePreview: (() => {
              try {
                return JSON.stringify(output.value)
              } catch {
                return String(output.value)
              }
            })(),
          }))

          if (warmupSession?.page) {
            try {
              const url = warmupSession.page.url()
              const snapshot = await getPageSnapshot(warmupSession.page)
              initialPageState = { url, snapshot }
            } catch (snapshotError) {
              const msg = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
              console.warn("Failed to capture initial page state after warmup:", msg)
            }
          }

          warmupRun.status = "passed"
          warmupRun.finishedAt = now()
          this.runService.saveRunSnapshot(warmupRun)
          this.runService.notifyRun(warmupRun)

          onStep({
            id: createId("agent_precondition_warmup"),
            type: "thinking",
            stage: "page",
            title: "执行前置依赖预热",
            content: initialPageState
              ? `前置依赖已执行完成，当前 URL: ${initialPageState.url}`
              : "前置依赖已执行完成，开始基于当前浏览器状态生成脚本。",
            status: "completed",
            timestamp: now(),
            runId: warmupRun.id,
          })
        } catch (warmupError) {
          const warmupMsg = warmupError instanceof Error ? warmupError.message : String(warmupError)
          const isBrowserMissing = warmupMsg.includes("Executable doesn't exist") || warmupMsg.includes("browserType.launch")

          if (session.warmupRunId) {
            const run = await this.runService.getRun(session.warmupRunId)
            if (run) {
              run.status = isBrowserMissing ? "cancelled" : "failed"
              run.logs.push(`[${new Date().toLocaleTimeString()}] ${warmupMsg}`)
              run.finishedAt = now()
              this.runService.saveRunSnapshot(run)
              this.runService.notifyRun(run)
            }
          }

          if (isBrowserMissing) {
            console.warn("Warmup session failed (browser missing), continuing without browser:", warmupMsg)
            warmupSession = null
            session.warmupRunId = undefined
            onStep({
              id: createId("agent_warmup_skip"),
              type: "thinking",
              stage: "page",
              title: "浏览器未安装，跳过页面预热",
              content: "Playwright 浏览器未安装，将跳过前置依赖预热与页面探索，直接基于代码与用例描述生成脚本。（可运行 npx playwright install chromium 安装）",
              status: "completed",
              timestamp: now(),
            })
            this.persistAndNotifyAgent(session)
          } else {
            // 前置依赖失败：立即中止 agent，不再静默继续浪费 token。
            if (warmupSession) {
              await warmupSession.context.close().catch(() => undefined)
              await warmupSession.browser.close().catch(() => undefined)
              warmupSession = null
            }
            session.warmupRunId = undefined
            onStep({
              id: createId("agent_warmup_failed"),
              type: "error",
              stage: "page",
              title: "前置依赖执行失败",
              content: `前置依赖未通过，已中止脚本生成。请先修复前置依赖节点，再重试。\n失败原因: ${warmupMsg}`,
              status: "error",
              timestamp: now(),
            })
            this.persistAndNotifyAgent(session)
            throw new Error(`前置依赖执行失败，已中止 Agent 运行。${warmupMsg}`)
          }
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

      if (session.warmupRunId) {
        const run = await this.runService.getRun(session.warmupRunId)
        if (run && (run.status === "running" || run.status === "paused" || run.status === "awaiting_human")) {
          run.status = wasCancelled ? "cancelled" : "failed"
          run.finishedAt = now()
          this.runService.saveRunSnapshot(run)
          this.runService.notifyRun(run)
        }
      }
      
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

    const session = this.createAgentSession(request, "direct")
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

      const preconditionPlan = this.suiteService.buildPreconditionPlan(testCase)
      session.preconditionSummary = preconditionPlan.nodes.map((entry) => `${entry.testCase.caseCode}: ${entry.testCase.purpose || entry.testCase.expectedResult}`)
      preconditionReport = {
        status: preconditionPlan.nodes.length > 0 ? "success" : "none",
        suites: preconditionPlan.nodes.map((entry) => ({
          kind: "case" as const,
          name: `前置用例 ${entry.testCase.caseCode}`,
          version: "",
          cases: [{
            caseCode: entry.testCase.caseCode,
            purpose: entry.testCase.purpose ?? "",
            expectedResult: entry.testCase.expectedResult ?? "",
            scriptCode: entry.script.code ?? "",
          }],
        })),
      }
      this.persistAndNotifyAgent(session)

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
          const warmupRun = createExecutionTemplate({
            runId: createId("warmup"),
            project,
            testCase,
            script: {
              id: createId("warmup_script"),
              testCaseId: testCase.id,
              version: 0,
              source: "generated",
              provider: current.session.provider,
              prompt: "direct execution warmup",
              code: "",
              createdAt: now(),
            },
            testBaseUrl: resolvedRunUrl,
          })
          warmupRun.targetUrlId = resolvedRunTarget?.id
          warmupRun.kind = "temporary"
          warmupRun.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
          warmupRun.preconditionSummary = [...(session.preconditionSummary ?? [])]
          warmupRun.liveViewport = {
            mode: "ws-jpeg-stream",
            url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
            status: "connecting",
            mimeType: "image/jpeg",
          }
          this.runService.saveRunSnapshot(warmupRun)
          this.runService.notifyRun(warmupRun)
          session.warmupRunId = warmupRun.id
          this.persistAndNotifyAgent(session)

          onStep({
            id: createId("agent_precondition_warmup"),
            type: "thinking",
            stage: "page",
            title: "执行前置依赖预热",
            content: preconditionPlan.nodes.length > 0 ? `正在执行前置依赖项，为直接执行准备浏览器状态。` : "当前用例没有前置依赖项，直接准备浏览器状态。",
            status: "running",
            timestamp: now(),
            runId: warmupRun.id,
          })

          const onWarmupUpdate = async () => {
            this.runService.saveRunSnapshot(warmupRun)
            this.runService.notifyRun(warmupRun)
          }

          warmupSession = await createRunnerSession({
            run: warmupRun,
            artifactsDir,
            headless: true,
            onUpdate: onWarmupUpdate,
            onLiveViewportEvent: async (event) => {
              if (event.type === "started") {
                warmupRun.liveViewport = {
                  mode: "ws-jpeg-stream",
                  url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
                  status: "live",
                  mimeType: "image/jpeg",
                  width: event.width,
                  height: event.height,
                }
                await onWarmupUpdate()
                return
              }
              if (event.type === "chunk" && event.chunk) {
                this.runService.notifyLiveViewport(warmupRun.id, event.chunk)
                return
              }
              if (event.type === "ended") {
                if (warmupRun.liveViewport) {
                  warmupRun.liveViewport = { ...warmupRun.liveViewport, status: "ended" }
                  await onWarmupUpdate()
                }
                return
              }
              warmupRun.liveViewport = {
                mode: "ws-jpeg-stream",
                url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
                status: "unavailable",
                mimeType: "image/jpeg",
              }
              await onWarmupUpdate()
            },
            initStepIndex: 0,
            storageStateJson: authStorageStateJson,
          })

          for (const dependency of preconditionPlan.nodes) {
            const stepIndex = warmupRun.steps.length - 1
            warmupRun.steps.splice(stepIndex, 0, createExecutionStep(warmupRun.id, warmupRun.steps.length + 1, `[前置用例] ${dependency.testCase.caseCode}`, `执行前置用例 ${dependency.testCase.caseCode}`, "precondition_case"))
            await onWarmupUpdate()
            await executeScriptInSession({
              run: warmupRun,
              session: warmupSession,
              script: dependency.script,
              onUpdate: onWarmupUpdate,
              requestHumanInput: async (handoffRequest: {
                reason: HumanHandoffRequest["reason"]
                instruction: string
                inputLabel?: string
                placeholder?: string
                confirmText?: string
                imageUrl?: string
                scope?: HumanHandoffRequest["scope"]
                suiteId?: string
                testCaseId?: string
              }) => {
                const value = await this.runService.requestRunHumanInput(warmupRun, handoffRequest)
                warmupRun.pendingHumanHandoff = undefined
                warmupRun.status = "running"
                this.runService.saveRunSnapshot(warmupRun)
                this.runService.notifyRun(warmupRun)
                return value
              },
              analyzeImage: (analysisRequest) => this.runService.analyzeImageWithCurrentLlm(analysisRequest, ownerKey),
              stepIndex,
              startedLog: `[前置用例 ${dependency.testCase.caseCode}] 开始执行。`,
              completedLog: `[前置用例 ${dependency.testCase.caseCode}] 执行完成。`,
              handoffContext: { scope: "precondition", testCaseId: dependency.testCase.id },
              screenshotFilePrefix: `warmup-${dependency.testCase.caseCode}`,
              runtimeProducer: { testCaseId: dependency.testCase.id, caseCode: dependency.testCase.caseCode, caseName: dependency.testCase.purpose },
            })
          }
          warmupRuntimeOutputs = warmupRun.runtimeOutputs ?? []

          if (warmupSession?.page) {
            try {
              const url = warmupSession.page.url()
              const snapshot = await getPageSnapshot(warmupSession.page)
              initialPageState = { url, snapshot }
            } catch (snapshotError) {
              const msg = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
              console.warn("Failed to capture initial page state after warmup:", msg)
            }
          }

          warmupRun.status = "passed"
          warmupRun.finishedAt = now()
          this.runService.saveRunSnapshot(warmupRun)
          this.runService.notifyRun(warmupRun)

          onStep({
            id: createId("agent_precondition_warmup"),
            type: "thinking",
            stage: "page",
            title: "前置预热完成",
            content: initialPageState
              ? `前置依赖已执行完成，当前 URL: ${initialPageState.url}`
              : "前置依赖已执行完成，开始直接执行任务。",
            status: "completed",
            timestamp: now(),
            runId: warmupRun.id,
          })
        } catch (warmupError) {
          const warmupMsg = warmupError instanceof Error ? warmupError.message : String(warmupError)
          const isBrowserMissing = warmupMsg.includes("Executable doesn't exist") || warmupMsg.includes("browserType.launch")

          if (session.warmupRunId) {
            const run = await this.runService.getRun(session.warmupRunId)
            if (run) {
              run.status = isBrowserMissing ? "cancelled" : "failed"
              run.logs.push(`[${new Date().toLocaleTimeString()}] ${warmupMsg}`)
              run.finishedAt = now()
              this.runService.saveRunSnapshot(run)
              this.runService.notifyRun(run)
            }
          }

          if (warmupSession) {
            await warmupSession.context.close().catch(() => undefined)
            await warmupSession.browser.close().catch(() => undefined)
            warmupSession = null
          }
          session.warmupRunId = undefined
          throw new Error(`浏览器初始化失败，无法进行直接执行。${warmupMsg}`)
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
      session.verificationStatus = "passed"
      session.warmupRunId = undefined
      session.finishedAt = now()
      session.finalSummary = session.directResult.summary || "直接执行完成。"
      this.persistAndNotifyAgent(session)
    } catch (error) {
      const message = error instanceof Error
        ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message)
        : "Agent 执行失败"
      const wasCancelled = taskController.signal.aborted
      session.status = wasCancelled ? "cancelled" : "error"

      if (session.warmupRunId) {
        const run = await this.runService.getRun(session.warmupRunId)
        if (run && (run.status === "running" || run.status === "paused" || run.status === "awaiting_human")) {
          run.status = wasCancelled ? "cancelled" : "failed"
          run.finishedAt = now()
          this.runService.saveRunSnapshot(run)
          this.runService.notifyRun(run)
        }
      }

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
}
