import type { Browser } from "@playwright/test"
import type { ExecutionRun } from "@autovis/shared"
import type { CreateExecutionTemplateInput, ExecutePlaywrightRunInput, ValidateAuthStateInput } from "./types.js"
import { createRunnerSession, finalizeRunnerSession, failRunnerSession, waitForSpaContent } from "./browser-manager.js"
import { executeScriptInSession, runValidationOnPage, extractScriptBody } from "./script-executor.js"
import { createExecutionStep, now } from "./utils.js"
import { launchReplayBrowser, shouldStealthReplay } from "./browser.js"

export * from "./types.js"
export * from "./utils.js"
export * from "./live-streamer.js"
export * from "./browser-manager.js"
export * from "./script-executor.js"
export * from "./risk-control.js"

export const createExecutionTemplate = ({ runId, project, testCase, script, testBaseUrl }: CreateExecutionTemplateInput): ExecutionRun => {
  const steps = [
    createExecutionStep(runId, 1, "初始化浏览器与 Trace", `准备执行 ${project.name} / ${testCase.caseCode} / 脚本 v${script.version}`, "orchestration"),
    createExecutionStep(runId, 2, "执行 Playwright 脚本", "执行由 Copilot 代理能力生成或维护的测试脚本。", "target"),
    createExecutionStep(runId, 3, "归档产物与关闭会话", "保存 trace、video 与关键截图。", "archive"),
  ]

  return {
    id: runId,
    projectId: project.id,
    testCaseId: testCase.id,
    scriptId: script.id,
    kind: "execution",
    status: "queued",
    startedAt: now(),
    currentViewport: "",
    logs: ["执行任务已创建，等待 Playwright Runner。"],
    steps,
    artifacts: [],
    testBaseUrl,
    completedPreconditionCaseIds: [],
    preconditionSummary: [],
  }
}

export const validateAuthState = async ({
  storageStateJson,
  validationScriptCode,
  testBaseUrl,
  headless = true,
  timeoutMs = 30_000,
}: ValidateAuthStateInput): Promise<{ valid: boolean; error?: string }> => {
  let browser: Browser | undefined
  try {
    // 校验登录态也必须用与采集一致的指纹，否则会被风控页误判为"已登出"而触发重新登录。
    const stealth = shouldStealthReplay(storageStateJson)
    browser = await launchReplayBrowser({ stealth, headless })
    const context = await browser.newContext({
      viewport: stealth ? null : { width: 1440, height: 960 },
      storageState: JSON.parse(storageStateJson),
    })
    const page = await context.newPage()
    try {
      await page.goto(testBaseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("interrupted by another navigation"))) {
        throw err
      }
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
    }
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
    await waitForSpaContent(page, 15_000)

    const result = await runValidationOnPage(page, validationScriptCode, timeoutMs)
    return result.ok ? { valid: true } : { valid: false, error: result.error }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await browser?.close()
  }
}

export const executePlaywrightRun = async ({
  run,
  project: _project,
  script,
  artifactsDir,
  appOrigin: _appOrigin,
  headless = true,
  onUpdate,
  onLiveViewportEvent,
  requestHumanInput,
  analyzeImage,
}: ExecutePlaywrightRunInput) => {
  let session = null
  try {
    session = await createRunnerSession({
      run,
      artifactsDir,
      headless,
      onUpdate,
      onLiveViewportEvent,
      initStepIndex: 0,
    })

    await executeScriptInSession({
      run,
      session,
      script,
      onUpdate,
      requestHumanInput,
      analyzeImage,
      stepIndex: 1,
      startedLog: "开始执行生成后的 Playwright 脚本。",
      completedLog: "Playwright 脚本执行完成。",
      handoffContext: { scope: "target", testCaseId: run.testCaseId },
      screenshotFilePrefix: "target",
    })

    await finalizeRunnerSession({
      run,
      session,
      onUpdate,
      archiveStepIndex: run.steps.findIndex(s => s.kind === "archive"),
    })
  } catch (error) {
    if (session) {
      await failRunnerSession(run, session, onUpdate, error as Error)
    } else {
      run.status = "failed"
      run.finishedAt = now()
      run.logs.push(`[${new Date().toLocaleTimeString()}] 执行失败: ${(error as Error).message}`)
      await onUpdate()
    }
  }
}
