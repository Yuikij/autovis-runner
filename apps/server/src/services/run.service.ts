import { AutoVisDatabase } from "../db.js"
import { appOrigin, artifactsDir, createId, now, resolvePersistentProfileDir } from "./common.js"
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
  type InvokeCaseResponse,
  type RuntimeOutput,
  type ScriptArtifact,
  type StartRunRequest,
  type TestCase,
  validateAgainstFields,
} from "@autovis/shared"
import { analyzeImageWithLlm, generateTextWithLlm } from "../llm.js"
import { knowledgeService } from "../knowledge.js"
import { log } from "../log.js"
import { TaskControlRegistry, type TaskController } from "./task-control.js"
import type { RunStateService } from "./run-state.service.js"

/** 任务编排中"续用会话"的链式执行选项（仅服务内部使用，不进 API schema）。 */
export interface RunChainOptions {
  /** 以该 storage state 启动浏览器上下文（续用上一个用例的登录态）。 */
  initialStorageStateJson?: string
  /** 初始打开的页面（上一个用例结束时停留的 URL）。 */
  initialLandingUrl?: string
  /** 继承执行链中已产出的 outputs，供 inputs.get / guard.ownedData 消费。 */
  initialRuntimeOutputs?: RuntimeOutput[]
  /** 目标脚本成功后捕获会话状态（storage state + 当前 URL），供下一个用例续用。 */
  captureChainState?: boolean
}

export interface RunChainState {
  storageStateJson?: string
  landingUrl?: string
}

type StartRunOptions = StartRunRequest & {
  scriptTimeoutMs?: number
  llmOwnerKey?: string
  skipPreconditions?: boolean
  /**
   * deadline 模式目标时刻（ISO）。透传到目标脚本，使其在正文执行前自动 `schedule.waitUntil(at)`，
   * 实现"提前启动→预热→卡点执行"。仅作用于目标脚本，前置用例作为预热照常先跑。
   */
  deadlineWaitUntil?: string
  chain?: RunChainOptions
  /**
   * 反检测有头模式（真实 Chrome）覆盖开关：任务用例级配置（TaskItem.stealth）透传至此。
   * undefined 表示继承所用 TargetUrl 的 needsStealth；true/false 强制开关。
   */
  stealthOverride?: boolean
  /**
   * 外部 API 调用方传入、已按 contract 校验的入参。仅注入「目标脚本」（不注入前置用例），
   * 通过沙箱 `params.get()` 读取。
   */
  apiParams?: Record<string, unknown>
  /**
   * 跳过「同用例已有进行中运行」的冲突检查。API 调用按 contract.maxConcurrency 自行限流，
   * 允许同一用例并发，因此走这条路。
   */
  allowConcurrent?: boolean
}

export class RunService {
  /** run 结束时捕获的会话状态（内存态，供任务链下一用例续用，消费即删）。 */
  private readonly chainStates = new Map<string, RunChainState>()

  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly llmService: LlmConfigService,
    private readonly tasks: TaskControlRegistry,
    private readonly runStateService: RunStateService,
  ) {}

  /** 取出并清除某个 run 捕获的链式会话状态；未捕获（失败/未开启捕获/进程重启）时返回 undefined。 */
  public consumeChainState(runId: string): RunChainState | undefined {
    const state = this.chainStates.get(runId)
    this.chainStates.delete(runId)
    return state
  }

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

  public async generateTextWithCurrentLlm(input: { prompt: string; systemPrompt?: string }, llmOwnerKey = "shared") {
    const { state, current } = this.llmService.getActiveLlmConfigBundle(undefined, llmOwnerKey)
    if (current.session.connectionStatus !== "connected" && !current.secrets.apiKey) {
      throw new Error("当前未启用已连接的 AI 配置，无法执行文本生成。")
    }
    const text = await generateTextWithLlm({
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      session: current.session,
      secrets: current.secrets,
    })
    current.session.lastSyncedAt = now()
    current.session.lastError = undefined
    this.llmService.saveLlmConfigState(state, llmOwnerKey)
    return text.trim()
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
    request: StartRunOptions,
  ) {
    // chain 里可能含整份 storage state，体积大且为内存态语义，不进 lease 持久化。
    const { chain: _chain, ...leaseRequest } = request
    return this.tasks.create({
      kind: "run",
      id: run.id,
      projectId: run.projectId,
      testCaseId: run.testCaseId,
      recoveryPolicy: "restart",
      request: {
        ...leaseRequest,
        scriptTimeoutMs: request.scriptTimeoutMs,
        llmOwnerKey: request.llmOwnerKey,
        deadlineWaitUntil: request.deadlineWaitUntil,
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
    request: StartRunOptions,
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
      chained: Boolean(request.chain?.initialStorageStateJson),
    })
    void this.executeRunWithPreconditions(run, project, testCase, script, preconditionPlan, taskController, request.scriptTimeoutMs, request.llmOwnerKey, request.chain, request.stealthOverride, request.apiParams, request.deadlineWaitUntil)
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
      stealthOverride: typeof leaseRequest.stealthOverride === "boolean" ? leaseRequest.stealthOverride : undefined,
      deadlineWaitUntil: typeof leaseRequest.deadlineWaitUntil === "string" ? leaseRequest.deadlineWaitUntil : undefined,
    } satisfies StartRunRequest & { scriptTimeoutMs?: number; llmOwnerKey?: string; stealthOverride?: boolean; deadlineWaitUntil?: string }

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
    chain?: RunChainOptions,
    stealthOverride?: boolean,
    apiParams?: Record<string, unknown>,
    deadlineWaitUntil?: string,
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

      // 持久 profile：开了就用固定 userDataDir 回放（与登录沙盒共用），cookie/指纹跨运行保留。
      let targetUserDataDir: string | undefined

      if (chain?.initialStorageStateJson) {
        // 任务链续用会话：上一用例已带着登录态结束，直接以其状态与页面为起点，跳过鉴权配置流程。
        targetStorageStateJson = chain.initialStorageStateJson
        landingUrl = chain.initialLandingUrl
        run.logs.push(`[${new Date().toLocaleTimeString()}] 续用上一个用例的会话状态${landingUrl ? `，起始页面 ${landingUrl}` : ""}。`)
        await onUpdate()
      } else if (targetTestCase.authProfileId) {
        const authProfile = this.db.getAuthProfile(targetTestCase.authProfileId)
        if (authProfile) {
          if (authProfile.usePersistentProfile !== false) {
            targetUserDataDir = resolvePersistentProfileDir(authProfile.id)
          }
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

      // 反检测有头模式（真实 Chrome）按配置解析：任务用例级覆盖 > 站点 needsStealth > 默认 false。
      // 解析为显式布尔后交给 runner，不再让其按"有无登录态"自行推断（env 仍是最终钳制）。
      const targetUrlNeedsStealth = run.targetUrlId ? this.db.getTargetUrl(run.targetUrlId)?.needsStealth : undefined
      const effectiveStealth = stealthOverride ?? targetUrlNeedsStealth ?? false

      session = await createRunnerSession({
        run,
        artifactsDir,
        headless: process.env.HEADLESS !== "false",
        onUpdate,
        onLiveViewportEvent: handleLiveViewportEvent,
        initStepIndex: 0,
        storageStateJson: targetStorageStateJson,
        landingUrl,
        stealth: effectiveStealth,
        userDataDir: targetUserDataDir,
      })

      if (session.liveStream) {
        this.runStateService.registerLiveViewportController(run.id, session.liveStream)
      }

      // 项目级数据表运行时 API：脚本可用 `tables` 做跨运行持久记录 / 去重。
      const dataTablesApi = this.db.createDataTableScriptApi(project.id, (line) => {
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`)
      })
      // 项目级知识库运行时 API：脚本可用 `knowledge` 沉淀多层级 Markdown 与资产。
      const knowledgeApi = knowledgeService.createScriptApi(project.id, (line) => {
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`)
      })

      for (const dependency of preconditionPlan.nodes) {
        run.orchestrationPhase = "preconditions"
        run.currentPreconditionCaseId = dependency.testCase.id
        run.logs.push(`[${new Date().toLocaleTimeString()}] 启动前置用例 ${dependency.testCase.caseCode}...`)
        await onUpdate()

        const stepIndex = run.steps.findIndex((s) => s.kind === "target")
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
          generateText: (prompt, systemPrompt) => this.generateTextWithCurrentLlm({ prompt, systemPrompt }, llmOwnerKey),
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
          dataTables: dataTablesApi,
          knowledge: knowledgeApi,
        })

        run.completedPreconditionCaseIds = [...(run.completedPreconditionCaseIds ?? []), dependency.testCase.id]
        run.logs.push(`[${new Date().toLocaleTimeString()}] 前置用例 ${dependency.testCase.caseCode} 顺利完成。`)
        await onUpdate()
      }

      run.orchestrationPhase = "target"
      run.currentPreconditionCaseId = undefined
      let targetStepIndex = run.steps.findIndex((s) => s.kind === "target")
      if (targetStepIndex === -1) targetStepIndex = 1
      await executeScriptInSession({
        run,
        session,
        script: targetScript,
        onUpdate,
        requestHumanInput: handleHumanInput,
        analyzeImage: (analysisRequest) => this.analyzeImageWithCurrentLlm(analysisRequest, llmOwnerKey),
        generateText: (prompt, systemPrompt) => this.generateTextWithCurrentLlm({ prompt, systemPrompt }, llmOwnerKey),
        stepIndex: targetStepIndex,
        startedLog: "[目标脚本] 开始执行生成后的 Playwright 脚本。",
        completedLog: "[目标脚本] Playwright 脚本执行完成。",
        handoffContext: { scope: "target", testCaseId: targetTestCase.id },
        screenshotFilePrefix: "target",
        signal: taskController?.signal,
        waitIfPaused: taskController ? () => taskController.waitIfPaused() : undefined,
        runtimeProducer: { testCaseId: targetTestCase.id, caseCode: targetTestCase.caseCode, caseName: targetTestCase.purpose },
        timeoutMs: scriptTimeoutMs,
        deadlineWaitUntil,
        apiParams,
        dataTables: dataTablesApi,
        knowledge: knowledgeApi,
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

      if (chain?.captureChainState && session) {
        // 下一个用例配置了续用会话：在关闭浏览器前捕获登录态与停留页面。
        const state = await session.context.storageState().catch(() => undefined)
        const rawUrl = session.page.url()
        this.chainStates.set(run.id, {
          storageStateJson: state ? JSON.stringify(state) : undefined,
          landingUrl: rawUrl && rawUrl !== "about:blank" ? rawUrl : undefined,
        })
        run.logs.push(`[${new Date().toLocaleTimeString()}] 已捕获会话状态，供下一个用例续用${rawUrl && rawUrl !== "about:blank" ? `（停留页面 ${rawUrl}）` : ""}。`)
        await onUpdate()
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

  public async startRun(request: StartRunOptions) {
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

    if (!request.taskRunId && !request.allowConcurrent) {
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
    const chain = request.chain
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
    // 续用会话时继承执行链中已产出的 outputs，使 inputs.get / guard.ownedData 能引用前序用例的数据。
    run.runtimeOutputs = chain?.initialRuntimeOutputs ? [...chain.initialRuntimeOutputs] : []
    run.preconditionSummary = preconditionPlan.nodes.map((entry) => `前置用例 ${entry.testCase.caseCode}`)

    this.runStateService.saveRunSnapshot(run)
    this.runStateService.notifyRun(run)

    this.launchRunExecution(run, project, testCase, script, preconditionPlan, request)

    return run
  }

  /**
   * API 网关：把一个「已开启 API + 已冻结契约」的用例当接口调用。
   * 入参校验 → 注入 params 起 run → 等待完成 → 出参校验 → 返回结构化响应。
   * 入参不合法直接拒绝，不进浏览器（与「做 AutoVis 就是为了稳定」一致）。
   */
  public async invokeCase(input: {
    testCaseId: string
    params?: Record<string, unknown>
    targetUrlId?: string
    llmOwnerKey?: string
  }): Promise<InvokeCaseResponse> {
    const testCase = this.db.getTestCase(input.testCaseId)
    if (!testCase) {
      throw new Error("用例不存在或已被删除。")
    }
    if (!testCase.apiEnabled) {
      throw new Error(`用例 ${testCase.caseCode} 未开启 API（请先在用例上打开 API 开关）。`)
    }
    if (!testCase.contract) {
      throw new Error(`用例 ${testCase.caseCode} 尚未定义 API 契约（contract）。`)
    }
    const scriptId = testCase.latestScriptId
    if (!scriptId) {
      throw new Error(`用例 ${testCase.caseCode} 没有可执行脚本，无法作为 API 调用。`)
    }

    // 入参网关：不合法直接拒绝，不起浏览器。
    const paramCheck = validateAgainstFields(testCase.contract.params, input.params)
    if (!paramCheck.ok) {
      return { ok: false, status: "invalid_params", errors: paramCheck.errors }
    }

    // 并发限流：按 contract.maxConcurrency（默认 1）控制同一用例的在跑 API 数。
    const maxConcurrency = Math.max(1, testCase.contract.maxConcurrency ?? 1)
    const activeForCase = this.tasks.listByKind("run").filter((ctrl) => ctrl.testCaseId === testCase.id).length
    if (activeForCase >= maxConcurrency) {
      return {
        ok: false,
        status: "busy",
        errors: [`用例 ${testCase.caseCode} 并发已达上限（${maxConcurrency}），请稍后重试。`],
      }
    }

    const run = await this.startRun({
      projectId: testCase.projectId,
      testCaseId: testCase.id,
      scriptId,
      targetUrlId: input.targetUrlId ?? testCase.defaultTargetUrlId,
      kind: "temporary",
      apiParams: paramCheck.value,
      allowConcurrent: true,
      llmOwnerKey: input.llmOwnerKey,
    })

    const finished = await this.runStateService.waitForRunCompletion(run.id)
    if (finished.status !== "passed") {
      const lastLog = finished.logs[finished.logs.length - 1]
      return {
        ok: false,
        runId: finished.id,
        status: finished.status,
        result: finished.apiResult,
        errors: [lastLog ?? `运行未通过（status=${finished.status}）`],
      }
    }

    // 出参校验：脚本结束按 response schema 校验返回值。
    const responseCheck = validateAgainstFields(testCase.contract.response, finished.apiResult)
    return {
      ok: responseCheck.ok,
      runId: finished.id,
      status: finished.status,
      result: responseCheck.value,
      errors: responseCheck.ok ? undefined : responseCheck.errors,
    }
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
