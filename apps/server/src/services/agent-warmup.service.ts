import { AutoVisDatabase } from "../db.js"
import { appOrigin, artifactsDir, createId, now } from "./common.js"
import { type SuiteService } from "./suite.service.js"
import { type RunService } from "./run.service.js"
import { getPageSnapshot } from "../agent/helpers.js"
import { type InitialPageState, type PreconditionReport } from "../agent/types.js"
import { createExecutionStep, createExecutionTemplate, createRunnerSession, executeScriptInSession, type RunnerSession } from "@autovis/runner"
import {
  type AgentStep,
  type ExecutionRun,
  type HumanHandoffRequest,
  type LlmProviderKind,
  type Project,
  type RuntimeOutput,
  type TestCase,
} from "@autovis/shared"

export type ExecuteWarmupResult = {
  warmupSession: RunnerSession | null
  warmupRunForDisplay: ExecutionRun | null
  warmupRuntimeOutputs: RuntimeOutput[]
  initialPageState?: InitialPageState
  preconditionReport: PreconditionReport
}

export type WarmupOptions = {
  sessionId: string
  mode: "generate" | "direct"
  taskRunId?: string
  project: Project
  testCase: TestCase
  resolvedRunTargetId?: string
  resolvedRunUrl: string
  authStorageStateJson?: string
  provider: LlmProviderKind
  llmOwnerKey: string
  onStep: (step: AgentStep) => void
  updateSession: (patch: { warmupRunId?: string; preconditionSummary?: string[] }) => void
}

export class AgentWarmupService {
  constructor(
    private readonly db: AutoVisDatabase,
    private readonly suiteService: SuiteService,
    private readonly runService: RunService,
  ) {}

  public async executeWarmup(options: WarmupOptions): Promise<ExecuteWarmupResult> {
    const { sessionId, mode, taskRunId, project, testCase, resolvedRunTargetId, resolvedRunUrl, authStorageStateJson, provider, llmOwnerKey, onStep, updateSession } = options

    let warmupSession: RunnerSession | null = null
    let warmupRunForDisplay: ExecutionRun | null = null
    let initialPageState: InitialPageState | undefined
    let warmupRuntimeOutputs: RuntimeOutput[] = []
    let currentWarmupRunId: string | undefined = undefined

    const preconditionPlan = this.suiteService.buildPreconditionPlan(testCase)
    const preconditionSummary = preconditionPlan.nodes.map((entry) => `${entry.testCase.caseCode}: ${entry.testCase.purpose || entry.testCase.expectedResult}`)
    const preconditionReport: PreconditionReport = {
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

    updateSession({ preconditionSummary })

    try {
      const taskLabel = mode === "direct" ? "direct execution" : "script generation"
      const warmupRun = createExecutionTemplate({
        runId: createId("warmup"),
        project,
        testCase,
        script: {
          id: createId("warmup_script"),
          testCaseId: testCase.id,
          version: 0,
          source: "generated",
          provider,
          prompt: `Precondition warmup for ${taskLabel}`,
          code: "",
          createdAt: now(),
        },
        testBaseUrl: resolvedRunUrl,
      })
      warmupRun.targetUrlId = resolvedRunTargetId
      if (mode === "direct") {
        warmupRun.taskRunId = taskRunId
      }
      warmupRun.kind = "temporary"
      warmupRun.orchestrationPhase = preconditionPlan.nodes.length > 0 ? "preconditions" : "target"
      warmupRun.preconditionSummary = [...preconditionSummary]
      warmupRun.liveViewport = {
        mode: "ws-jpeg-stream",
        url: `${appOrigin.replace(/^http/, "ws")}/api/runs/${warmupRun.id}/live`,
        status: "connecting",
        mimeType: "image/jpeg",
      }
      this.runService.getRunStateService().saveRunSnapshot(warmupRun)
      this.runService.getRunStateService().notifyRun(warmupRun)
      
      currentWarmupRunId = warmupRun.id
      updateSession({ warmupRunId: currentWarmupRunId })

      onStep({
        id: createId("agent_precondition_warmup"),
        type: "thinking",
        stage: "page",
        title: "执行前置依赖预热",
        content: preconditionPlan.nodes.length > 0 
          ? `正在执行前置依赖项，为${mode === "direct" ? "直接执行" : "脚本生成"}准备浏览器状态。` 
          : "当前用例没有前置依赖项，直接准备浏览器状态。",
        status: "running",
        timestamp: now(),
        runId: warmupRun.id,
      })

      const onWarmupUpdate = async () => {
        this.runService.getRunStateService().saveRunSnapshot(warmupRun)
        this.runService.getRunStateService().notifyRun(warmupRun)
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
            this.runService.getRunStateService().notifyLiveViewport(warmupRun.id, event.chunk)
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
            const value = await this.runService.getRunStateService().requestRunHumanInput(warmupRun, handoffRequest)
            warmupRun.pendingHumanHandoff = undefined
            warmupRun.status = "running"
            this.runService.getRunStateService().saveRunSnapshot(warmupRun)
            this.runService.getRunStateService().notifyRun(warmupRun)
            return value
          },
          analyzeImage: (analysisRequest) => this.runService.analyzeImageWithCurrentLlm(analysisRequest, llmOwnerKey),
          stepIndex,
          startedLog: `[前置用例 ${dependency.testCase.caseCode}] 开始执行。`,
          completedLog: `[前置用例 ${dependency.testCase.caseCode}] 执行完成。`,
          handoffContext: { scope: "precondition", testCaseId: dependency.testCase.id },
          screenshotFilePrefix: `warmup-${dependency.testCase.caseCode}`,
          runtimeProducer: { testCaseId: dependency.testCase.id, caseCode: dependency.testCase.caseCode, caseName: dependency.testCase.purpose },
        })
      }
      warmupRuntimeOutputs = warmupRun.runtimeOutputs ?? []
      if (mode === "generate") {
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
      }

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
      this.runService.getRunStateService().saveRunSnapshot(warmupRun)
      this.runService.getRunStateService().notifyRun(warmupRun)

      onStep({
        id: createId("agent_precondition_warmup"),
        type: "thinking",
        stage: "page",
        title: mode === "generate" ? "执行前置依赖预热" : "前置预热完成",
        content: initialPageState
          ? `前置依赖已执行完成，当前 URL: ${initialPageState.url}`
          : `前置依赖已执行完成，开始${mode === "direct" ? "直接执行任务。" : "基于当前浏览器状态生成脚本。"}`,
        status: "completed",
        timestamp: now(),
        runId: warmupRun.id,
      })

      if (mode === "direct") {
        warmupRun.status = "running"
        warmupRun.finishedAt = undefined
        warmupRun.logs.push(`[${new Date().toLocaleTimeString()}] 前置依赖预热完成，由于是直接执行模式，复用当前运行状态作为显示。`)
        this.runService.getRunStateService().saveRunSnapshot(warmupRun)
        this.runService.getRunStateService().notifyRun(warmupRun)
        // Only assign warmupRunForDisplay if it succeeds, to prevent mixed state
        warmupRunForDisplay = warmupRun
      }

      return { warmupSession, warmupRunForDisplay, warmupRuntimeOutputs, initialPageState, preconditionReport }

    } catch (warmupError) {
      const warmupMsg = warmupError instanceof Error ? warmupError.message : String(warmupError)
      if (warmupSession) {
        await warmupSession.context.close().catch(() => undefined)
        await warmupSession.browser.close().catch(() => undefined)
        warmupSession = null
      }

      const isBrowserMissing = warmupMsg.includes("Executable doesn't exist") || warmupMsg.includes("browserType.launch")
      const finalErrorMsg = isBrowserMissing
        ? `Playwright 浏览器未安装，无法进行页面探索与前置依赖预热。请运行 npx playwright install chromium 安装。\n详细错误: ${warmupMsg}`
        : `前置依赖执行失败，已中止 Agent 运行。\n详细错误: ${warmupMsg}`

      // Self-contained failed state logic
      if (currentWarmupRunId) {
        const run = await this.runService.getRunStateService().getRun(currentWarmupRunId)
        if (run) {
          run.status = isBrowserMissing ? "cancelled" : "failed"
          run.logs.push(`[${new Date().toLocaleTimeString()}] ${finalErrorMsg}`)
          run.finishedAt = now()
          this.runService.getRunStateService().saveRunSnapshot(run)
          this.runService.getRunStateService().notifyRun(run)
        }
      }

      updateSession({ warmupRunId: undefined })
      onStep({
        id: createId("agent_warmup_failed"),
        type: "error",
        stage: "page",
        title: isBrowserMissing ? "浏览器未安装" : "前置依赖预热失败",
        content: finalErrorMsg,
        status: "error",
        timestamp: now(),
      })

      throw new Error(finalErrorMsg)
    }
  }
}
