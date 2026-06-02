import { AutoVisDatabase } from "../db.js"
import { appOrigin, artifactsDir, createId, now } from "./common.js"
import { type SuiteService } from "./suite.service.js"
import { type LlmConfigService } from "./llm-config.service.js"
import {
  createExecutionStep,
  createExecutionTemplate,
  createRunnerSession,
  executeScriptInSession,
  failRunnerSession,
  finalizeRunnerSession,
  validateAuthState,
  type RunnerSession,
} from "@autovis/runner"
import {
  type ExecutionRun,
  type HumanHandoffRequest,
  type ScriptArtifact,
  type StartRunRequest,
  type StartTaskRunRequest,
  type Task,
  type TaskModeConfig,
  type TaskRun,
  type TestCase,
  type AgentSession,
} from "@autovis/shared"
import { analyzeImageWithLlm } from "../llm.js"
import { TaskControlRegistry, type TaskController } from "./task-control.js"

function describeTaskMode(mode: TaskModeConfig): string {
  switch (mode.kind) {
    case "oneshot":
      return "oneshot"
    case "polling":
      return `polling(interval=${mode.intervalMs}ms,max=${mode.maxAttempts},stopOn=${mode.stopOn ?? "success"},attemptTimeout=${mode.attemptTimeoutMs ?? "(runner default)"})`
    case "deadline":
      return `deadline(at=${mode.at},extra=${mode.extraTimeoutMs ?? 600000}ms)`
    default:
      return "(unknown)"
  }
}

export class RunService {
  private readonly subscribers = new Map<string, Set<(run: ExecutionRun) => void>>()
  private readonly taskRunSubscribers = new Map<string, Set<(taskRun: TaskRun) => void>>()
  private readonly liveViewportSubscribers = new Map<string, Set<(chunk: Uint8Array) => void>>()
  private readonly pendingRunHumanInputs = new Map<string, { handoffId: string; resolve: (value: string) => void; reject: (error: Error) => void }>()

  /** 注入后由 AgentService 填充，用于任务中无脚本用例的 AI 直接执行路径。 */
  public runDirectAgentForTask: ((opts: { projectId: string; testCaseId: string; targetUrlId?: string; taskRunId: string }) => Promise<AgentSession>) | null = null
  /** 注入后由 AgentService 填充，用于取消正在运行的 agent。 */
  public cancelAgentCallback: ((sessionId: string) => boolean) | null = null
  /** 注入后由 AgentService 填充，用于查询 agent session 状态。 */
  public getAgentSessionCallback: ((sessionId: string) => AgentSession | undefined) | null = null

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService,
    private readonly tasks: TaskControlRegistry,
  ) {}

  public ensureRunStep(run: ExecutionRun, title: string, log: string, kind: Parameters<typeof createExecutionStep>[4]) {
    const existingIndex = run.steps.findIndex((step) => step.title === title)
    if (existingIndex >= 0) {
      return existingIndex
    }
    run.steps.splice(Math.max(run.steps.length - 1, 0), 0, createExecutionStep(run.id, run.steps.length + 1, title, log, kind))
    return run.steps.findIndex((step) => step.title === title)
  }

  public notifyRun(run: ExecutionRun) {
    this.subscribers.get(run.id)?.forEach((listener) => listener(run))
  }

  public isTemporaryRun(run: ExecutionRun) {
    return run.kind === "temporary"
  }

  public saveRunSnapshot(run: ExecutionRun) {
    this.db.upsertRun(run)
  }

  public getRunSnapshot(runId: string) {
    return this.db.getRun(runId)
  }

  public listActiveRuns(projectId?: string): ExecutionRun[] {
    return this.tasks
      .listByKind("run")
      .map((ctrl) => this.db.getRun(ctrl.id))
      .filter((run): run is ExecutionRun => Boolean(run) && (!projectId || run!.projectId === projectId))
  }

  public listActiveTaskRuns(projectId?: string): TaskRun[] {
    return this.tasks
      .listByKind("task-run")
      .map((ctrl) => this.db.getTaskRun(ctrl.id))
      .filter((taskRun): taskRun is TaskRun => Boolean(taskRun) && (!projectId || taskRun!.projectId === projectId))
  }

  public async requestRunHumanInput(
    run: ExecutionRun,
    request: Omit<HumanHandoffRequest, "id" | "kind" | "createdAt">,
  ) {
    const handoffId = createId("handoff")
    run.status = "awaiting_human"
    run.pendingHumanHandoff = {
      id: handoffId,
      kind: "text_input",
      createdAt: now(),
      ...request,
    }
    this.saveRunSnapshot(run)
    this.notifyRun(run)

    return await new Promise<string>((resolve, reject) => {
      this.pendingRunHumanInputs.set(run.id, { handoffId, resolve, reject })
    })
  }

  public notifyLiveViewport(runId: string, chunk: Uint8Array) {
    this.liveViewportSubscribers.get(runId)?.forEach((listener) => listener(chunk))
  }

  public persistAndNotifyTaskRun(taskRun: TaskRun) {
    this.db.upsertTaskRun(taskRun)
    this.taskRunSubscribers.get(taskRun.id)?.forEach((listener) => listener(taskRun))
  }

  public createTaskRun(projectId: string, taskId: string, testBaseUrl: string, totalCount: number, targetUrlId?: string): TaskRun {
    return {
      id: createId("task_run"),
      projectId,
      taskId,
      status: "queued",
      targetUrlId,
      testBaseUrl,
      totalCount,
      queuedCount: totalCount,
      runningCount: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      runIds: [],
      logs: ["任务已创建，等待执行。"],
      startedAt: now(),
    }
  }

  /**
   * 解析 targetUrlId 到 { id, url }；若未提供 id 则回落到项目主域名 TargetUrl。
   * 找不到任何 URL 时抛错。
   */
  private resolveTargetUrlOrThrow(projectId: string, targetUrlId?: string): { id?: string; url: string } {
    const resolved = this.db.resolveTargetUrl(projectId, targetUrlId)
    if (!resolved) {
      throw new Error("无法解析目标 URL：请先在项目设置中配置主域名或添加 TargetUrl。")
    }
    return resolved
  }

  public async analyzeImageWithCurrentLlm(input: { dataUrl: string; mimeType: string; prompt: string }, llmOwnerKey = "shared") {
    const { state, current } = this.llmService.getActiveVisionLlmConfigBundle(undefined, llmOwnerKey)
    if (current.session.connectionStatus !== "connected" && !current.secrets.apiKey) {
      throw new Error("当前未启用已连接的 AI 配置，无法执行图片分析。")
    }
    const result = await analyzeImageWithLlm({
      ...input,
      session: current.session,
      secrets: current.secrets,
    })
    current.session.lastSyncedAt = now()
    current.session.lastError = undefined
    this.llmService.saveLlmConfigState(state, llmOwnerKey)
    return result.text.trim()
  }

  public buildRepairPrompt(testCase: TestCase, run: ExecutionRun, originalPrompt: string) {
    const failedStep = run.steps.find((step) => step.status === "failed")
    const failureLogs = run.logs.slice(-8).join("\n")
    return [
      originalPrompt,
      "",
      "请基于刚才的真实失败结果修复脚本：",
      `失败用例: ${testCase.caseCode}`,
      `失败步骤: ${failedStep?.title ?? "未知步骤"}`,
      `失败信息: ${failedStep?.log ?? run.logs[run.logs.length - 1] ?? "无"}`,
      `最近日志:\n${failureLogs}`,
      "请直接返回修复后的完整 Playwright TypeScript 代码。",
    ].join("\n")
  }

  public async executeRunWithPreconditions(
    run: ExecutionRun,
    project: ReturnType<AutoVisDatabase["getProject"]>,
    targetTestCase: TestCase,
    targetScript: ScriptArtifact,
    preconditionPlan: ReturnType<SuiteService["buildPreconditionPlan"]>,
    taskController?: TaskController,
    scriptTimeoutMs?: number,
    llmOwnerKey = "shared",
  ) {
    if (!project) throw new Error("Project not found")
    const onUpdate = async () => {
      this.saveRunSnapshot(run)
      this.notifyRun(run)
    }

    const handleHumanInput = async (request: {
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
      const value = await this.requestRunHumanInput(run, request)
      run.pendingHumanHandoff = undefined
      run.status = "running"
      this.saveRunSnapshot(run)
      this.notifyRun(run)
      this.pendingRunHumanInputs.delete(run.id)
      return value
    }

    const handleLiveViewportEvent = async (event: { type: "started" | "chunk" | "ended" | "unavailable"; chunk?: Uint8Array; width?: number; height?: number }) => {
      if (event.type === "started") {
        run.liveViewport = {
          mode: "ws-jpeg-stream",
          url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${run.id}/live`,
          status: "live",
          mimeType: "image/jpeg",
          width: event.width,
          height: event.height,
        }
        this.saveRunSnapshot(run)
        this.notifyRun(run)
        return
      }
      if (event.type === "chunk" && event.chunk) {
        this.notifyLiveViewport(run.id, event.chunk)
        return
      }
      if (event.type === "ended") {
        if (run.liveViewport) {
          run.liveViewport = { ...run.liveViewport, status: "ended" }
          this.saveRunSnapshot(run)
          this.notifyRun(run)
        }
        return
      }
      run.liveViewport = {
        mode: "ws-jpeg-stream",
        url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${run.id}/live`,
        status: "unavailable",
        mimeType: "image/jpeg",
      }
      this.saveRunSnapshot(run)
      this.notifyRun(run)
    }

    let session: RunnerSession | null = null
    let targetStorageStateJson: string | undefined = undefined
    // 注入登录态后的"落地 URL"：来自 auth_profile_states 行（override ?? auto）。
    // 仅在用例显式挂了 authProfileId 且该行有 postLoginUrl 时才生效，不影响其他用例。
    let landingUrl: string | undefined = undefined

    try {
      run.status = "running"
      run.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
      await onUpdate()

      if (targetTestCase.authProfileId) {
        const authProfile = this.db.getAuthProfile(targetTestCase.authProfileId)
        if (authProfile) {
          // 鉴权按 run.targetUrlId 维度分桶：每个目标 URL 一份 storage state。
          const runTargetUrlId = run.targetUrlId
          if (!runTargetUrlId) {
            throw new Error("当前 run 未关联 targetUrlId，无法定位登录态。")
          }
          const stateRow = this.db.getAuthProfileState(authProfile.id, runTargetUrlId)
          let isValid = false
          if (stateRow?.storageStateJson) {
            if (authProfile.validationScript) {
              run.logs.push(`[${new Date().toLocaleTimeString()}] 执行鉴权验证脚本...`)
              await onUpdate()
              const result = await validateAuthState({
                storageStateJson: stateRow.storageStateJson,
                validationScriptCode: authProfile.validationScript,
                testBaseUrl: run.testBaseUrl || "/",
                headless: process.env.HEADLESS !== "false",
              })
              isValid = result.valid
              if (!isValid) {
                run.logs.push(`[${new Date().toLocaleTimeString()}] 鉴权验证脚本判定状态失效: ${result.error}`)
                await onUpdate()
              }
            } else {
              isValid = true
            }
          }
          if (!isValid) {
            run.logs.push(`[${new Date().toLocaleTimeString()}] 鉴权状态失效或不存在，准备执行登录用例 ${authProfile.sourceCaseId} 刷新（targetUrl=${run.testBaseUrl}）...`)
            await onUpdate()
            const finishedRefreshRun = await this.runSourceCaseForAuth(authProfile.id, runTargetUrlId)
            if (finishedRefreshRun.status !== "passed") {
              throw new Error("刷新鉴权状态失败：登录用例执行未通过。")
            }
            const updatedState = this.db.getAuthProfileState(authProfile.id, runTargetUrlId)
            if (!updatedState?.storageStateJson) {
              throw new Error("刷新鉴权状态失败：登录用例执行后未能提取到有效的 storage state。")
            }
            targetStorageStateJson = updatedState.storageStateJson
            landingUrl = updatedState.postLoginUrlOverride ?? updatedState.postLoginUrlAuto ?? undefined
          } else {
            targetStorageStateJson = stateRow?.storageStateJson
            landingUrl = stateRow?.postLoginUrlOverride ?? stateRow?.postLoginUrlAuto ?? undefined
          }
        }
      }

      session = await createRunnerSession({
        run,
        artifactsDir,
        headless: process.env.HEADLESS !== "false",
        onUpdate,
        onLiveViewportEvent: handleLiveViewportEvent,
        initStepIndex: 0,
        storageStateJson: targetStorageStateJson,
        landingUrl,
      })

      for (const dependency of preconditionPlan.nodes) {
        run.orchestrationPhase = "preconditions"
        run.currentPreconditionCaseId = dependency.testCase.id
        const dependencyStepIndex = this.ensureRunStep(run, `[前置用例] ${dependency.testCase.caseCode}`, `执行前置用例 ${dependency.testCase.caseCode}`, "precondition_case")
        await executeScriptInSession({
          run,
          session,
          script: dependency.script,
          onUpdate,
          requestHumanInput: handleHumanInput,
          analyzeImage: (analysisRequest) => this.analyzeImageWithCurrentLlm(analysisRequest, llmOwnerKey),
          stepIndex: dependencyStepIndex,
          startedLog: `[前置用例 ${dependency.testCase.caseCode}] 开始执行。`,
          completedLog: `[前置用例 ${dependency.testCase.caseCode}] 执行完成。`,
          handoffContext: { scope: "precondition", testCaseId: dependency.testCase.id },
          screenshotFilePrefix: `precondition-${dependency.testCase.caseCode}`,
          signal: taskController?.signal,
          waitIfPaused: taskController ? () => taskController.waitIfPaused() : undefined,
          runtimeProducer: { testCaseId: dependency.testCase.id, caseCode: dependency.testCase.caseCode, caseName: dependency.testCase.purpose },
        })
        run.completedPreconditionCaseIds = [...(run.completedPreconditionCaseIds ?? []), dependency.testCase.id]
        await onUpdate()
      }

      run.orchestrationPhase = "target"
      run.currentPreconditionCaseId = undefined
      const targetStepIndex = 1
      await executeScriptInSession({
        run,
        session,
        script: targetScript,
        onUpdate,
        requestHumanInput: handleHumanInput,
        analyzeImage: (analysisRequest) => this.analyzeImageWithCurrentLlm(analysisRequest, llmOwnerKey),
        stepIndex: targetStepIndex,
        startedLog: "[目标脚本] 开始执行生成后的 Playwright 脚本。",
        completedLog: "[目标脚本] Playwright 脚本执行完成。",
        handoffContext: { scope: "target", testCaseId: targetTestCase.id },
        screenshotFilePrefix: "target",
        signal: taskController?.signal,
        waitIfPaused: taskController ? () => taskController.waitIfPaused() : undefined,
        runtimeProducer: { testCaseId: targetTestCase.id, caseCode: targetTestCase.caseCode, caseName: targetTestCase.purpose },
        timeoutMs: scriptTimeoutMs,
      })

      // 登录态采集：若本 run 跑的用例正是某登录态(AuthProfile)的来源登录用例，
      // 则在脚本结束、会话尚存时抓取 storageState 落到 (profile, targetUrl) 行。
      if (session && run.targetUrlId) {
        const matchedProfile = this.db.listAuthProfiles(project.id).find((p) => p.sourceCaseId === run.testCaseId)
        if (matchedProfile) {
          const state = await session.context.storageState().catch(() => undefined)
          if (state) {
            // 同步采集"登录后 URL"：登录用例跑完后浏览器停留的页面 = 用户登录完成后期望落地的页面。
            // about:blank / 空字符串 表示页面已被脚本关闭或处于初始态，此时落 null 避免污染。
            const rawUrl = session.page.url()
            const postLoginUrl = rawUrl && rawUrl !== "about:blank" ? rawUrl : null
            this.db.upsertAuthProfileState(matchedProfile.id, run.targetUrlId, JSON.stringify(state), postLoginUrl)
            run.logs.push(`[${new Date().toLocaleTimeString()}] 已将当前登录态保存至鉴权配置 ${matchedProfile.name}（targetUrl=${run.testBaseUrl}${postLoginUrl ? `, postLoginUrl=${postLoginUrl}` : ""}）`)
            await onUpdate()
          }
        }
      }

      run.orchestrationPhase = "archive"
      await finalizeRunnerSession({
        run,
        session,
        onUpdate,
        archiveStepIndex: run.steps.length - 1,
      })
    } catch (error) {
      const wasCancelled = Boolean(taskController?.signal.aborted)
      if (session) {
        await failRunnerSession(run, session, onUpdate, error as Error)
      } else {
        run.status = wasCancelled ? "cancelled" : "failed"
        run.finishedAt = now()
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${wasCancelled ? "已取消" : "执行失败"}: ${(error as Error).message}`)
        await onUpdate()
      }
      if (wasCancelled && session) {
        run.status = "cancelled"
      }
      this.rejectPendingHumanInput(run.id, wasCancelled ? "Run cancelled" : "Run failed")
    } finally {
      this.tasks.unregister(run.id)
    }
  }

  private rejectPendingHumanInput(runId: string, reason: string) {
    const pending = this.pendingRunHumanInputs.get(runId)
    if (!pending) return
    this.pendingRunHumanInputs.delete(runId)
    try {
      pending.reject(new Error(reason))
    } catch {
      // ignore
    }
  }

  public pauseRun(runId: string): boolean {
    const ctrl = this.tasks.get(runId)
    if (!ctrl || ctrl.kind !== "run") return false
    if (!ctrl.pause()) return false
    const run = this.db.getRun(runId)
    if (run) {
      run.status = "paused"
      this.saveRunSnapshot(run)
      this.notifyRun(run)
    }
    return true
  }

  public resumeRun(runId: string): boolean {
    const ctrl = this.tasks.get(runId)
    if (!ctrl || ctrl.kind !== "run") return false
    if (!ctrl.resume()) return false
    const run = this.db.getRun(runId)
    if (run) {
      run.status = "running"
      this.saveRunSnapshot(run)
      this.notifyRun(run)
    }
    return true
  }

  public cancelRun(runId: string): boolean {
    const ctrl = this.tasks.get(runId)
    if (!ctrl || ctrl.kind !== "run") return false
    const run = this.db.getRun(runId)
    if (run) {
      run.status = "cancelling"
      this.saveRunSnapshot(run)
      this.notifyRun(run)
    }
    this.rejectPendingHumanInput(runId, "Run cancelled")
    return ctrl.cancel("Run cancelled by user.")
  }

  public pauseTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    if (!ctrl.pause()) return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "paused"
      this.persistAndNotifyTaskRun(taskRun)
    }
    return true
  }

  public resumeTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    if (!ctrl.resume()) return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "running"
      this.persistAndNotifyTaskRun(taskRun)
    }
    return true
  }

  public cancelTaskRun(taskRunId: string): boolean {
    const ctrl = this.tasks.get(taskRunId)
    if (!ctrl || ctrl.kind !== "task-run") return false
    const taskRun = this.db.getTaskRun(taskRunId)
    if (taskRun) {
      taskRun.status = "cancelling"
      this.persistAndNotifyTaskRun(taskRun)
    }
    // also cancel any currently running child run
    const childRun = taskRun?.currentRunId
    if (childRun) {
      this.cancelRun(childRun)
    }
    // also cancel any currently running direct agent
    const childAgent = taskRun?.currentAgentId
    if (childAgent) {
      this.cancelAgentCallback?.(childAgent)
    }
    return ctrl.cancel("Task run cancelled by user.")
  }

  public async startRun(request: StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string }) {
    const project = this.db.getProject(request.projectId)
    const testCase = this.db.getTestCase(request.testCaseId)
    const script = this.db.getScript(request.scriptId)

    if (!project || !testCase || !script) {
      throw new Error("Run dependencies not found")
    }

    if (!request.taskRunId) {
      const existing = this.tasks.findActiveForCase("run", request.testCaseId)
      if (existing) {
        const conflict = new Error("当前用例已有进行中的运行任务。") as Error & {
          code?: string
          conflictId?: string
          conflictKind?: string
          conflictStatus?: string
        }
        conflict.code = "TASK_CONFLICT"
        conflict.conflictId = existing.id
        conflict.conflictKind = "run"
        const existingRun = this.db.getRun(existing.id)
        conflict.conflictStatus = existingRun?.status ?? existing.state
        throw conflict
      }
    }

    const preconditionPlan = this.suiteService.buildPreconditionPlan(testCase)
    const target = this.resolveTargetUrlOrThrow(request.projectId, request.targetUrlId)
    const run = createExecutionTemplate({
      runId: createId("run"),
      project,
      testCase,
      script,
      testBaseUrl: target.url,
    })
    run.targetUrlId = target.id
    run.taskRunId = request.taskRunId
    run.batchOrder = request.batchOrder
    run.kind = request.kind ?? "execution"
    run.liveViewport = {
      mode: "ws-jpeg-stream",
      url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${run.id}/live`,
      status: "connecting",
      mimeType: "image/jpeg",
    }
    run.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
    run.completedPreconditionCaseIds = []
    run.runtimeOutputs = []
    run.preconditionSummary = preconditionPlan.nodes.map((entry) => `前置用例 ${entry.testCase.caseCode}`)

    this.saveRunSnapshot(run)
    this.notifyRun(run)

    const taskController = this.tasks.create({
      kind: "run",
      id: run.id,
      projectId: request.projectId,
      testCaseId: request.testCaseId,
    })

    console.log(`[run] startRun runId=${run.id} case=${testCase.caseCode} project=${project.name} targetUrl=${target.url} preconditions=${preconditionPlan.nodes.length} scriptTimeoutMs=${request.scriptTimeoutMs ?? "(default)"} taskRunId=${request.taskRunId ?? "(standalone)"}`)
    void this.executeRunWithPreconditions(run, project, testCase, script, preconditionPlan, taskController, request.scriptTimeoutMs, request.llmOwnerKey)

    return run
  }

  public async startVerification(request: StartRunRequest & { llmOwnerKey?: string }) {
    const run = await this.startRun({ ...request, kind: "verification" })
    void (async () => {
      const finishedRun = await this.waitForRunCompletion(run.id)
      if (finishedRun.status === "cancelled" || finishedRun.status === "interrupted") {
        return
      }
      this.db.updateTestCaseVerification({
        testCaseId: request.testCaseId,
        runId: finishedRun.id,
        status: finishedRun.status === "passed" || finishedRun.status === "failed" ? finishedRun.status : "failed",
        verifiedAt: finishedRun.finishedAt,
      })
    })()
    return run
  }

  /**
   * 刷新登录态：把某 AuthProfile 的登录用例(sourceCase)按指定 targetUrl 单独跑一次。
   * 执行结束时，executeRunWithPreconditions 会把 storageState 落到 (profile, targetUrl) 行。
   * 返回启动的 run（前端可订阅其 stream 观察进度）。
   */
  public async runSourceCaseForAuth(profileId: string, targetUrlId: string): Promise<ExecutionRun> {
    const profile = this.db.getAuthProfile(profileId)
    if (!profile) throw new Error("Auth profile not found")
    const sourceCase = this.db.getTestCase(profile.sourceCaseId)
    if (!sourceCase) throw new Error("登录用例不存在，请重新配置登录态来源。")
    if (!sourceCase.latestScriptId) throw new Error(`登录用例 ${sourceCase.caseCode} 缺少可执行脚本，无法刷新登录态。`)
    return this.startRun({
      projectId: profile.projectId,
      testCaseId: sourceCase.id,
      scriptId: sourceCase.latestScriptId,
      targetUrlId,
    })
  }

  /**
   * 启动一次任务执行。会根据 effective TaskMode 选择不同的编排策略：
   * - oneshot：把 task.items 按顺序跑一遍即结束（默认）；
   * - deadline：把脚本超时拉长到 (at - now + extra)，由脚本里的 schedule.waitUntil 卡精确时刻；
   * - polling：跑一次失败后按 interval 反复重启，最多 maxAttempts 次；每次 attempt 都是独立 taskRun，
   *   通过 parentTaskRunId 串成一条链便于排查。
   * 返回的是"本轮第一次 attempt"对应的 taskRun（前端继续以此 id 订阅展示；后续 attempt 会在 logs 里点名）。
   */
  public async startTaskRun(request: StartTaskRunRequest): Promise<TaskRun> {
    const task = this.db.getTask(request.taskId)
    if (!task) {
      throw new Error("Task not found")
    }

    const effectiveTaskMode: TaskModeConfig = request.taskMode ?? task.executionMode ?? { kind: "oneshot" }
    console.log(`[task-run] startTaskRun project=${request.projectId} task=${request.taskId} mode=${describeTaskMode(effectiveTaskMode)} scheduleTriggerId=${request.scheduleTriggerId ?? "(none)"} parentTaskRunId=${request.parentTaskRunId ?? "(none)"} attemptNo=${request.attemptNo ?? 1}`)

    if (effectiveTaskMode.kind === "polling" && !request.parentTaskRunId) {
      // polling 模式由这里启动整条链；第一次 attempt 走 oneshot 路径，由后台 watcher 触发后续 attempts。
      const firstAttempt = await this.runTaskRunOnce(task, {
        projectId: request.projectId,
        taskId: request.taskId,
        scheduleTriggerId: request.scheduleTriggerId,
        attemptNo: request.attemptNo ?? 1,
        parentTaskRunId: undefined,
        effectiveTaskMode,
        scriptTimeoutMs: effectiveTaskMode.attemptTimeoutMs,
      })
      console.log(`[task-run] polling chain started taskRunId=${firstAttempt.id} maxAttempts=${effectiveTaskMode.maxAttempts} intervalMs=${effectiveTaskMode.intervalMs} stopOn=${effectiveTaskMode.stopOn ?? "success"}`)
      void this.driveTaskPollingChain(firstAttempt, effectiveTaskMode, task, request)
      return firstAttempt
    }

    return this.runTaskRunOnce(task, {
      projectId: request.projectId,
      taskId: request.taskId,
      scheduleTriggerId: request.scheduleTriggerId,
      attemptNo: request.attemptNo,
      parentTaskRunId: request.parentTaskRunId,
      effectiveTaskMode,
      scriptTimeoutMs: this.computeScriptTimeoutMsForMode(effectiveTaskMode),
    })
  }

  /**
   * 根据 mode 计算"单次 attempt"应给脚本的超时：
   * - deadline：(at - now) + extraTimeoutMs（默认 10 分钟）；
   * - polling：attemptTimeoutMs；
   * - oneshot：undefined → runner 默认 5 分钟。
   */
  private computeScriptTimeoutMsForMode(mode: TaskModeConfig): number | undefined {
    if (mode.kind === "deadline") {
      const targetMs = Date.parse(mode.at)
      const extra = mode.extraTimeoutMs ?? 10 * 60 * 1000
      if (Number.isFinite(targetMs)) {
        const remaining = Math.max(0, targetMs - Date.now())
        return remaining + extra
      }
      return undefined
    }
    if (mode.kind === "polling") {
      return mode.attemptTimeoutMs
    }
    return undefined
  }

  /** polling 链的后台驱动：等首轮跑完，按规则决定是否再起一轮，每轮都是独立 taskRun。 */
  private async driveTaskPollingChain(
    firstAttempt: TaskRun,
    mode: TaskModeConfig,
    task: Task,
    request: StartTaskRunRequest,
  ) {
    if (mode.kind !== "polling") return
    const maxAttempts = Math.max(1, mode.maxAttempts)
    const intervalMs = Math.max(0, mode.intervalMs)
    const stopOn = mode.stopOn ?? "success"
    let previous = firstAttempt
    let attemptNo = (previous.attemptNo ?? 1)

    while (attemptNo < maxAttempts) {
      const finished = await this.waitForTaskRunCompletion(previous.id)
      console.log(`[polling] attempt#${attemptNo} taskRun=${previous.id} finished status=${finished.status} passed=${finished.passedCount}/${finished.totalCount}`)
      if (finished.status === "cancelled" || finished.status === "interrupted") {
        console.log(`[polling] chain abort because attempt#${attemptNo} status=${finished.status}`)
        return
      }
      if (stopOn === "success" && finished.status === "passed") {
        console.log(`[polling] chain done (stopOn=success met) after attempt#${attemptNo}`)
        return
      }
      attemptNo += 1
      if (intervalMs > 0) {
        console.log(`[polling] sleeping ${intervalMs}ms before attempt#${attemptNo}`)
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
      }
      console.log(`[polling] starting attempt#${attemptNo} (parent=${previous.id})`)

      // 直接 runTaskRunOnce，不走入口 startTaskRun（避免递归触发 polling driver）。
      const next = await this.runTaskRunOnce(task, {
        projectId: request.projectId,
        taskId: request.taskId,
        scheduleTriggerId: request.scheduleTriggerId,
        attemptNo,
        parentTaskRunId: previous.id,
        effectiveTaskMode: mode,
        scriptTimeoutMs: mode.attemptTimeoutMs,
      }).catch((err) => {
        console.warn(`[polling] attempt#${attemptNo} runTaskRunOnce failed:`, err instanceof Error ? err.stack || err.message : err)
        return undefined
      })
      if (!next) {
        console.log(`[polling] chain aborted: attempt#${attemptNo} could not start`)
        return
      }
      console.log(`[polling] attempt#${attemptNo} started taskRunId=${next.id}`)
      previous = next
    }
    console.log(`[polling] chain exhausted maxAttempts=${maxAttempts}`)
  }

  /**
   * 真正去跑一次 taskRun：按 task.items 顺序逐项启动子 run，每项用 item.targetUrlId 作为初始 URL
   * （缺省回落项目主域名）。额外打通 scheduleTriggerId/parentTaskRunId/attemptNo 以及 scriptTimeoutMs。
   */
  private async runTaskRunOnce(
    task: Task,
    opts: {
      projectId: string
      taskId: string
      scheduleTriggerId?: string
      attemptNo?: number
      parentTaskRunId?: string
      effectiveTaskMode: TaskModeConfig
      scriptTimeoutMs?: number
    },
  ): Promise<TaskRun> {
    // 展开任务编排项 → 用例 + 每项初始 URL。缺脚本的用例标记跳过。
    const resolvedItems = task.items.map((item) => {
      const testCase = this.db.getTestCase(item.caseId)
      return { item, testCase }
    })

    // taskRun 的展示 URL：取第一项的初始 URL（缺省项目主域名）。
    const displayTarget = this.resolveTargetUrlOrThrow(opts.projectId, task.items[0]?.targetUrlId)
    const taskRun = this.createTaskRun(opts.projectId, opts.taskId, displayTarget.url, resolvedItems.length, displayTarget.id)
    taskRun.scheduleTriggerId = opts.scheduleTriggerId
    taskRun.attemptNo = opts.attemptNo
    taskRun.parentTaskRunId = opts.parentTaskRunId
    taskRun.effectiveTaskMode = opts.effectiveTaskMode
    console.log(`[task-run] runTaskRunOnce taskRunId=${taskRun.id} items=${resolvedItems.length} effectiveMode=${describeTaskMode(opts.effectiveTaskMode)} scriptTimeoutMs=${opts.scriptTimeoutMs ?? "(runner default 300s)"} attemptNo=${opts.attemptNo ?? 1}`)
    if (opts.attemptNo && opts.attemptNo > 1) {
      taskRun.logs.push(`polling · 第 ${opts.attemptNo} 轮（上一轮: ${opts.parentTaskRunId ?? "?"}）。`)
    }
    if (opts.effectiveTaskMode.kind === "deadline") {
      taskRun.logs.push(`deadline · 目标时刻 ${opts.effectiveTaskMode.at}，脚本内请使用 schedule.waitUntil 卡到精确时间。`)
    }

    if (resolvedItems.length === 0) {
      taskRun.status = "failed"
      taskRun.finishedAt = now()
      taskRun.logs.push("该任务没有编排任何测试用例。")
      this.persistAndNotifyTaskRun(taskRun)
      return taskRun
    }

    this.persistAndNotifyTaskRun(taskRun)

    const taskController = this.tasks.create({
      kind: "task-run",
      id: taskRun.id,
      projectId: opts.projectId,
    })

    void (async () => {
      taskRun.status = "running"
      this.persistAndNotifyTaskRun(taskRun)
      try {
        for (const [index, { item, testCase }] of resolvedItems.entries()) {
          if (taskController.signal.aborted) break
          await taskController.waitIfPaused()

          if (!testCase) {
            taskRun.skippedCount += 1
            taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
            taskRun.logs.push(`跳过第 ${index + 1} 项：引用的用例不存在。`)
            this.persistAndNotifyTaskRun(taskRun)
            continue
          }
          if (!testCase.latestScriptId) {
            if (this.runDirectAgentForTask) {
              // 无脚本时走 AI 直接执行路径
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.runningCount = 1
              taskRun.logs.push(`开始 AI 直接执行 ${testCase.caseCode}（无脚本）。`)
              this.persistAndNotifyTaskRun(taskRun)
              let agentSession: AgentSession | undefined
              try {
                agentSession = await this.runDirectAgentForTask({
                  projectId: opts.projectId,
                  testCaseId: testCase.id,
                  targetUrlId: item.targetUrlId,
                  taskRunId: taskRun.id,
                })
                taskRun.currentAgentId = agentSession.id
                this.persistAndNotifyTaskRun(taskRun)
                const finishedAgent = await this.waitForAgentCompletion(agentSession.id)
                taskRun.runningCount = 0
                taskRun.currentAgentId = undefined
                if (finishedAgent.status === "completed") {
                  taskRun.passedCount += 1
                  taskRun.logs.push(`${testCase.caseCode} AI 直接执行成功。`)
                } else if (finishedAgent.status === "cancelled") {
                  taskRun.logs.push(`${testCase.caseCode} 已取消。`)
                } else {
                  taskRun.failedCount += 1
                  taskRun.logs.push(`${testCase.caseCode} AI 直接执行失败。`)
                }
              } catch (agentErr) {
                taskRun.runningCount = 0
                taskRun.currentAgentId = undefined
                taskRun.failedCount += 1
                taskRun.logs.push(`${testCase.caseCode} AI 直接执行异常: ${(agentErr as Error).message}`)
              }
              this.persistAndNotifyTaskRun(taskRun)
            } else {
              taskRun.skippedCount += 1
              taskRun.queuedCount = Math.max(0, taskRun.queuedCount - 1)
              taskRun.logs.push(`跳过 ${testCase.caseCode}：缺少最新脚本。`)
              this.persistAndNotifyTaskRun(taskRun)
            }
            continue
          }

          const run = await this.startRun({
            projectId: opts.projectId,
            testCaseId: testCase.id,
            scriptId: testCase.latestScriptId,
            targetUrlId: item.targetUrlId,
            taskRunId: taskRun.id,
            batchOrder: index + 1,
            scriptTimeoutMs: opts.scriptTimeoutMs,
          })
          taskRun.runIds.push(run.id)
          taskRun.currentRunId = run.id
          taskRun.queuedCount = Math.max(0, taskRun.totalCount - taskRun.runIds.length - taskRun.skippedCount)
          taskRun.runningCount = 1
          taskRun.logs.push(`开始执行 ${testCase.caseCode}。`)
          this.persistAndNotifyTaskRun(taskRun)

          const finishedRun = await this.waitForRunCompletion(run.id)
          taskRun.runningCount = 0
          taskRun.currentRunId = undefined
          if (finishedRun.status === "passed") {
            taskRun.passedCount += 1
            taskRun.logs.push(`${testCase.caseCode} 执行成功。`)
          } else if (finishedRun.status === "cancelled") {
            taskRun.logs.push(`${testCase.caseCode} 已取消。`)
          } else {
            taskRun.failedCount += 1
            taskRun.logs.push(`${testCase.caseCode} 执行失败。`)
          }
          this.persistAndNotifyTaskRun(taskRun)
        }

        if (taskController.signal.aborted) {
          taskRun.status = "cancelled"
          taskRun.logs.push("任务已取消。")
        } else {
          taskRun.status = taskRun.failedCount > 0 ? "failed" : "passed"
        }
      } catch (error) {
        taskRun.status = taskController.signal.aborted ? "cancelled" : "failed"
        taskRun.logs.push(`任务执行异常: ${(error as Error).message}`)
      } finally {
        taskRun.finishedAt = now()
        taskRun.currentRunId = undefined
        taskRun.currentAgentId = undefined
        taskRun.runningCount = 0
        // polling 链上的中间 attempt 不应覆盖任务的最近执行状态。
        const isPollingMidAttempt = opts.effectiveTaskMode.kind === "polling" && !!opts.parentTaskRunId
        if (!isPollingMidAttempt) {
          this.db.updateTaskLastRun({
            taskId: task.id,
            lastRunId: taskRun.id,
            lastStatus: taskRun.status,
            lastRunAt: taskRun.finishedAt,
          })
        }
        this.persistAndNotifyTaskRun(taskRun)
        this.tasks.unregister(taskRun.id)
      }
    })()

    return taskRun
  }

  public async waitForRunCompletion(runId: string): Promise<ExecutionRun> {
    for (;;) {
      const run = this.getRunSnapshot(runId)
      if (!run) {
        return {
          id: runId,
          projectId: "",
          testCaseId: "",
          scriptId: "",
          kind: "execution",
          status: "failed",
          startedAt: now(),
          finishedAt: now(),
          currentViewport: "",
          logs: ["运行记录在执行完成前被清理。"],
          steps: [],
          artifacts: [],
          testBaseUrl: "",
        }
      }
      if (run.status === "passed" || run.status === "failed" || run.status === "cancelled" || run.status === "interrupted") {
        return run
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  public async waitForAgentCompletion(sessionId: string): Promise<AgentSession> {
    for (;;) {
      const session = this.getAgentSessionCallback?.(sessionId)
      if (!session) {
        throw new Error("Agent session not found")
      }
      if (session.status === "completed" || session.status === "cancelled" || session.status === "error" || session.status === "interrupted") {
        return session
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  public async waitForTaskRunCompletion(taskRunId: string): Promise<TaskRun> {
    for (;;) {
      const taskRun = this.db.getTaskRun(taskRunId)
      if (!taskRun) {
        throw new Error("Task run not found")
      }
      if (
        taskRun.status === "passed" ||
        taskRun.status === "failed" ||
        taskRun.status === "cancelled" ||
        taskRun.status === "interrupted"
      ) {
        return taskRun
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  public subscribeTaskRun(taskRunId: string, listener: (taskRun: TaskRun) => void) {
    const set = this.taskRunSubscribers.get(taskRunId) ?? new Set<(taskRun: TaskRun) => void>()
    set.add(listener)
    this.taskRunSubscribers.set(taskRunId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.taskRunSubscribers.delete(taskRunId)
      }
    }
  }

  public async getRun(runId: string) {
    return this.getRunSnapshot(runId)
  }

  public async submitRunHumanInput(runId: string, handoffId: string, value: string) {
    const run = this.getRunSnapshot(runId)
    if (!run) {
      throw new Error("Run not found")
    }
    if (run.status !== "awaiting_human" || !run.pendingHumanHandoff) {
      throw new Error("当前运行未在等待人工输入。")
    }
    const pending = this.pendingRunHumanInputs.get(runId)
    if (!pending || pending.handoffId !== handoffId || run.pendingHumanHandoff.id !== handoffId) {
      throw new Error("人工输入请求已失效，请重新执行。")
    }
    pending.resolve(value)
    return this.getRunSnapshot(runId) ?? run
  }

  public subscribe(runId: string, listener: (run: ExecutionRun) => void) {
    const set = this.subscribers.get(runId) ?? new Set<(run: ExecutionRun) => void>()
    set.add(listener)
    this.subscribers.set(runId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.subscribers.delete(runId)
      }
    }
  }

  public subscribeLiveViewport(runId: string, listener: (chunk: Uint8Array) => void) {
    const set = this.liveViewportSubscribers.get(runId) ?? new Set<(chunk: Uint8Array) => void>()
    set.add(listener)
    this.liveViewportSubscribers.set(runId, set)

    return () => {
      set.delete(listener)
      if (set.size === 0) {
        this.liveViewportSubscribers.delete(runId)
      }
    }
  }
}
