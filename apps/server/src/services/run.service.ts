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
  type ScriptArtifact,
  type StartRunRequest,
  type TestCase,
} from "@autovis/shared"
import { analyzeImageWithLlm } from "../llm.js"
import { log } from "../log.js"
import { TaskControlRegistry, type TaskController } from "./task-control.js"
import type { RunStateService } from "./run-state.service.js"

export class RunService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService,
    private readonly tasks: TaskControlRegistry,
    private readonly runStateService: RunStateService,
  ) {}

  public getRunStateService(): RunStateService {
    return this.runStateService
  }

  public ensureRunStep(run: ExecutionRun, title: string, log: string, kind: Parameters<typeof createExecutionStep>[4]) {
    const existingIndex = run.steps.findIndex((step) => step.title === title)
    if (existingIndex >= 0) {
      return existingIndex
    }
    run.steps.splice(Math.max(run.steps.length - 1, 0), 0, createExecutionStep(run.id, run.steps.length + 1, title, log, kind))
    return run.steps.findIndex((step) => step.title === title)
  }

  public isTemporaryRun(run: ExecutionRun) {
    return run.kind === "temporary"
  }

  /**
   * 逐项核对运行所需依赖，返回点名缺失项、可指导用户操作的中文错误（而非笼统的
   * "Run dependencies not found"）。校验通过返回 null。
   */
  private describeMissingRunDependencies(input: { projectId: string; testCaseId: string; scriptId: string }): string | null {
    const project = this.db.getProject(input.projectId)
    if (!project) {
      return "无法启动执行：所属项目不存在或已被删除，请刷新页面后重试。"
    }
    const testCase = this.db.getTestCase(input.testCaseId)
    if (!testCase) {
      return "无法启动执行：测试用例不存在或已被删除，请刷新页面后重新选择用例。"
    }
    const script = this.db.getScript(input.scriptId)
    if (!script) {
      return `无法启动执行：用例 ${testCase.caseCode} 所选脚本版本不存在或已被删除，请重新生成或选择一个有效的脚本版本。`
    }
    return null
  }

  public listActiveRuns(projectId?: string): ExecutionRun[] {
    return this.tasks
      .listByKind("run")
      .map((ctrl) => this.db.getRun(ctrl.id))
      .filter((run): run is ExecutionRun => Boolean(run) && (!projectId || run!.projectId === projectId))
  }

  /**
   * 解析 targetUrlId 到 { id, url }；若未提供 id 则回落到项目主域名 TargetUrl。
   * 找不到任何 URL 时抛错。
   */
  public resolveTargetUrlOrThrow(projectId: string, targetUrlId?: string): { id?: string; url: string } {
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

  private markRunInterrupted(runId: string, reason: string) {
    const run = this.db.getRun(runId)
    if (!run) return
    if (run.status === "passed" || run.status === "failed" || run.status === "cancelled" || run.status === "interrupted") {
      return
    }
    run.status = "interrupted"
    run.finishedAt = run.finishedAt || now()
    run.pendingHumanHandoff = undefined
    run.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
    this.runStateService.saveRunSnapshot(run)
    this.runStateService.notifyRun(run)
    this.runStateService.rejectPendingHumanInput(run.id, reason)
  }

  private createManagedRunController(
    run: ExecutionRun,
    request: StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string },
  ) {
    return this.tasks.create({
      kind: "run",
      id: run.id,
      projectId: run.projectId,
      testCaseId: run.testCaseId,
      recoveryPolicy: "restart",
      request: {
        ...request,
        scriptTimeoutMs: request.scriptTimeoutMs,
        llmOwnerKey: request.llmOwnerKey,
      },
      buildCheckpoint: () => ({
        status: run.status,
        orchestrationPhase: run.orchestrationPhase ?? null,
        currentPreconditionCaseId: run.currentPreconditionCaseId ?? null,
        completedPreconditionCaseIds: run.completedPreconditionCaseIds ?? [],
        pendingHumanHandoffId: run.pendingHumanHandoff?.id ?? null,
        stepCount: run.steps.length,
        artifactCount: run.artifacts.length,
      }),
      applyAction: (action) => {
        switch (action) {
          case "pause":
            return this.pauseRun(run.id)
          case "resume":
            return this.resumeRun(run.id)
          case "cancel":
            return this.cancelRun(run.id)
          default:
            return false
        }
      },
      onLeaseLost: (reason) => {
        this.markRunInterrupted(run.id, reason)
      },
    })
  }

  private launchRunExecution(
    run: ExecutionRun,
    project: NonNullable<ReturnType<AutoVisDatabase["getProject"]>>,
    testCase: TestCase,
    script: ScriptArtifact,
    preconditionPlan: ReturnType<SuiteService["buildPreconditionPlan"]>,
    request: StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string },
  ) {
    const taskController = this.createManagedRunController(run, request)
    if (run.status === "paused") {
      taskController.pause()
    }
    log.info("run.started", {
      runId: run.id,
      taskRunId: request.taskRunId ?? null,
      projectId: project.id,
      projectName: project.name,
      testCaseId: testCase.id,
      testCaseCode: testCase.caseCode,
      targetUrl: run.testBaseUrl,
      preconditionCount: preconditionPlan.nodes.length,
      scriptTimeoutMs: request.scriptTimeoutMs ?? null,
    })
    void this.executeRunWithPreconditions(run, project, testCase, script, preconditionPlan, taskController, request.scriptTimeoutMs, request.llmOwnerKey)
  }

  public async recoverRun(runId: string) {
    if (this.tasks.has(runId)) {
      return this.db.getRun(runId)
    }

    const existing = this.db.getRun(runId)
    if (!existing) {
      throw new Error(`Run ${runId} not found`)
    }
    if (existing.status === "passed" || existing.status === "failed" || existing.status === "cancelled" || existing.status === "interrupted") {
      return existing
    }

    const missing = this.describeMissingRunDependencies({
      projectId: existing.projectId,
      testCaseId: existing.testCaseId,
      scriptId: existing.scriptId,
    })
    if (missing) {
      throw new Error(`无法恢复执行 ${runId}：${missing}`)
    }
    const project = this.db.getProject(existing.projectId)!
    const testCase = this.db.getTestCase(existing.testCaseId)!
    const script = this.db.getScript(existing.scriptId)!

    const target = this.resolveTargetUrlOrThrow(existing.projectId, existing.targetUrlId)
    const preconditionPlan = this.suiteService.buildPreconditionPlan(testCase)
    const run = createExecutionTemplate({
      runId: existing.id,
      project,
      testCase,
      script,
      testBaseUrl: target.url,
    })
    run.targetUrlId = target.id
    run.taskRunId = existing.taskRunId
    run.batchOrder = existing.batchOrder
    run.kind = existing.kind
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
    run.logs.push(`[${new Date().toLocaleTimeString()}] 检测到过期 lease，已自动重启执行。`)

    const leaseRequest = this.db.getTaskLease("run", runId)?.request ?? {}
    const request = {
      projectId: run.projectId,
      testCaseId: run.testCaseId,
      scriptId: run.scriptId,
      targetUrlId: run.targetUrlId,
      kind: run.kind,
      taskRunId: run.taskRunId,
      batchOrder: run.batchOrder,
      scriptTimeoutMs: typeof leaseRequest.scriptTimeoutMs === "number" ? leaseRequest.scriptTimeoutMs : undefined,
      llmOwnerKey: typeof leaseRequest.llmOwnerKey === "string" ? leaseRequest.llmOwnerKey : undefined,
    } satisfies StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string }

    this.runStateService.saveRunSnapshot(run)
    this.runStateService.notifyRun(run)
    this.launchRunExecution(run, project, testCase, script, preconditionPlan, request)
    if (existing.status === "paused") {
      this.pauseRun(run.id)
    }
    return run
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
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
    }

    const handleHumanInput = async (request: any) => {
      const value = await this.runStateService.requestRunHumanInput(run, request)
      run.pendingHumanHandoff = undefined
      run.status = "running"
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
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
        this.runStateService.saveRunSnapshot(run)
        this.runStateService.notifyRun(run)
        return
      }
      if (event.type === "chunk" && event.chunk) {
        this.runStateService.notifyLiveViewport(run.id, event.chunk)
        return
      }
      if (event.type === "ended") {
        if (run.liveViewport) {
          run.liveViewport = { ...run.liveViewport, status: "ended" }
          this.runStateService.saveRunSnapshot(run)
          this.runStateService.notifyRun(run)
        }
        return
      }
      run.liveViewport = {
        mode: "ws-jpeg-stream",
        url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${run.id}/live`,
        status: "unavailable",
        mimeType: "image/jpeg",
      }
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
    }

    let session: RunnerSession | null = null
    let targetStorageStateJson: string | undefined = undefined
    let landingUrl: string | undefined = undefined

    try {
      run.status = "running"
      run.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
      await onUpdate()

      if (targetTestCase.authProfileId) {
        const authProfile = this.db.getAuthProfile(targetTestCase.authProfileId)
        if (authProfile) {
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

      if (session.liveStream) {
        this.runStateService.registerLiveViewportController(run.id, session.liveStream)
      }

      for (const dependency of preconditionPlan.nodes) {
        run.orchestrationPhase = "preconditions"
        run.currentPreconditionCaseId = dependency.testCase.id
        run.logs.push(`[${new Date().toLocaleTimeString()}] 启动前置用例 ${dependency.testCase.caseCode}...`)
        await onUpdate()

        const stepIndex = run.steps.findIndex((s) => s.statusKind === "target")
        const newStepIndex = stepIndex === -1 ? run.steps.length - 1 : stepIndex
        run.steps.splice(newStepIndex, 0, createExecutionStep(run.id, run.steps.length + 1, `[前置用例] ${dependency.testCase.caseCode}`, `执行前置用例 ${dependency.testCase.caseCode}`, "precondition_case"))
        await onUpdate()

        await executeScriptInSession({
          run,
          session,
          script: dependency.script,
          onUpdate,
          requestHumanInput: handleHumanInput,
          analyzeImage: (analysisRequest) => this.analyzeImageWithCurrentLlm(analysisRequest, llmOwnerKey),
          stepIndex: newStepIndex,
          startedLog: `[前置用例 ${dependency.testCase.caseCode}] 开始执行。`,
          completedLog: `[前置用例 ${dependency.testCase.caseCode}] 执行完成。`,
          handoffContext: { scope: "precondition", testCaseId: dependency.testCase.id },
          screenshotFilePrefix: `pre-${dependency.testCase.caseCode}`,
          signal: taskController?.signal,
          waitIfPaused: taskController ? () => taskController.waitIfPaused() : undefined,
          runtimeProducer: { testCaseId: dependency.testCase.id, caseCode: dependency.testCase.caseCode, caseName: dependency.testCase.purpose },
          overrideBaseUrl: dependency.testCase.defaultTargetUrlId ? this.resolveTargetUrlOrThrow(project.id, dependency.testCase.defaultTargetUrlId).url : undefined,
          timeoutMs: scriptTimeoutMs,
        })

        run.completedPreconditionCaseIds = [...(run.completedPreconditionCaseIds ?? []), dependency.testCase.id]
        run.logs.push(`[${new Date().toLocaleTimeString()}] 前置用例 ${dependency.testCase.caseCode} 顺利完成。`)
        await onUpdate()
      }

      run.orchestrationPhase = "target"
      run.currentPreconditionCaseId = undefined
      let targetStepIndex = run.steps.findIndex((s) => s.statusKind === "target")
      if (targetStepIndex === -1) targetStepIndex = 1
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

      if (session && run.targetUrlId) {
        const matchedProfile = this.db.listAuthProfiles(project.id).find((p) => p.sourceCaseId === run.testCaseId)
        if (matchedProfile) {
          const state = await session.context.storageState().catch(() => undefined)
          if (state) {
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
      this.runStateService.rejectPendingHumanInput(run.id, wasCancelled ? "Run cancelled" : "Run failed")
    } finally {
      this.runStateService.unregisterLiveViewportController(run.id)
      this.tasks.unregister(run.id)
    }
  }

  public pauseRun(runId: string): boolean {
    const ctrl = this.tasks.get(runId)
    if (!ctrl || ctrl.kind !== "run") return false
    if (!ctrl.pause()) return false
    const run = this.db.getRun(runId)
    if (run) {
      run.status = "paused"
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
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
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
    }
    return true
  }

  public cancelRun(runId: string): boolean {
    const ctrl = this.tasks.get(runId)
    if (!ctrl || ctrl.kind !== "run") return false
    const run = this.db.getRun(runId)
    if (run) {
      run.status = "cancelling"
      this.runStateService.saveRunSnapshot(run)
      this.runStateService.notifyRun(run)
    }
    this.runStateService.rejectPendingHumanInput(runId, "Run cancelled")
    return ctrl.cancel("Run cancelled by user.")
  }

  public async startRun(request: StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string; skipPreconditions?: boolean }) {
    const missing = this.describeMissingRunDependencies({
      projectId: request.projectId,
      testCaseId: request.testCaseId,
      scriptId: request.scriptId,
    })
    if (missing) {
      throw new Error(missing)
    }
    const project = this.db.getProject(request.projectId)!
    const testCase = this.db.getTestCase(request.testCaseId)!
    const script = this.db.getScript(request.scriptId)!

    if (!request.taskRunId) {
      const existing = this.tasks.findActiveForCase("run", request.testCaseId)
      if (existing) {
        const conflict = new Error(`用例 ${testCase.caseCode} 已有一个进行中的运行任务，请等待其结束或先取消后再重试。`) as Error & {
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

    const preconditionPlan = request.skipPreconditions ? { nodes: [] } : this.suiteService.buildPreconditionPlan(testCase)
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

    this.runStateService.saveRunSnapshot(run)
    this.runStateService.notifyRun(run)

    this.launchRunExecution(run, project, testCase, script, preconditionPlan, request)

    return run
  }

  public async startVerification(request: StartRunRequest & { llmOwnerKey?: string }) {
    const run = await this.startRun({ ...request, kind: "verification" })
    void (async () => {
      const finishedRun = await this.runStateService.waitForRunCompletion(run.id)
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

  public async runSourceCaseForAuth(profileId: string, targetUrlId: string): Promise<ExecutionRun> {
    const profile = this.db.getAuthProfile(profileId)
    if (!profile) throw new Error("Auth profile not found")
    const sourceCase = this.db.getTestCase(profile.sourceCaseId)
    if (!sourceCase) throw new Error("登录用例不存在，请重新配置登录态来源。")
    if (!sourceCase.latestScriptId) throw new Error(`登录用例 ${sourceCase.caseCode} 缺少可执行脚本，无法刷新登录态。`)
    const run = await this.startRun({
      projectId: profile.projectId,
      testCaseId: sourceCase.id,
      scriptId: sourceCase.latestScriptId,
      targetUrlId,
    })
    return this.runStateService.waitForRunCompletion(run.id)
  }
}
