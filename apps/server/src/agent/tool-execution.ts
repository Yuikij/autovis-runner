import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { generateTextWithLlm, type LlmSecretState } from "../llm.js"
import { log } from "../log.js"
import type { AgentStep, CaseContract, Project, TestCase } from "@autovis/shared"

import { shouldStealthReplay } from "../browser.js"
import { appendAgentDebugLog, buildToolTitle, recoverBlankSpaRoute, waitForPageContent } from "./helpers.js"
import { executeTool } from "./tools/index.js"
import { clampStepTimeoutMs, executeStepTool } from "./tools/execute-step.js"
import { type AgentContext, type ScriptRuntimeContext, type ToolExecutionResult } from "./types.js"

type ToolCall = {
  id: string
  name: string
  arguments: string
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>

/**
 * 浏览器/上下文已被彻底关闭（进程级），任何 newContext / newPage / 页面操作都救不回来。
 * 与"导航被另一次导航打断""单次超时"等可恢复错误区分开：命中这些即视为不可恢复，
 * 必须让本次运行立即失败，而不是让 agent 一遍遍重试 execute_step 空转（浏览器没了越试越错）。
 */
function isBrowserGoneError(message: string): boolean {
  return (
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Target closed") ||
    message.includes("Browser has been closed") ||
    message.includes("browser has been closed") ||
    (message.includes("has been closed") &&
      (message.includes("newContext") || message.includes("newPage") || message.includes("browserContext")))
  )
}

/** 不可恢复的浏览器消失错误：抛出后由 runAgentLoop 透传，直接判本次运行失败。 */
class BrowserGoneError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrowserGoneError"
  }
}

export interface AgentToolExecutionState {
  page: Page | null
  browserContext: BrowserContext | null
  recoveryStorageState?: BrowserStorageState
  lastVerifiedCode: string
  verifiedRuntimeContext: ScriptRuntimeContext
  needsRecovery: boolean
  liveStateDirty: boolean
  lastExecuteStepFailed: boolean
  /**
   * 当前用例的 API 契约（线程化）。固化阶段 `define_contract` 声明后更新，
   * 后续 `execute_step` 据此注入占位入参，让参数化脚本能即时校验跑通。
   */
  currentContract?: CaseContract
  /**
   * 本会话 execute_step 请求过的最大超时（钳制后）。整段重放时作为超时下限——
   * 重放跑的是完整累积脚本，早期重步骤的时长必须计入。
   */
  maxStepTimeoutMs: number
}

export async function executeAgentToolCall(params: {
  toolCall: ToolCall
  parsedArgs: Record<string, unknown>
  session: AgentContext["session"]
  secrets: LlmSecretState
  ctx: AgentContext
  project: Project
  testCase: TestCase
  effectiveProject: Project
  effectiveBaseUrl: string
  agentSessionId: string
  artifactsDir: string
  pageMutatingTools: Set<string>
  recoveryUrl?: string
  ownedBrowser: Browser | null
  onStep: (step: AgentStep) => void
  stepId: () => string
  now: () => string
  truncate: (text: string, maxLen: number) => string
  cloneRuntimeContext: (context: ScriptRuntimeContext) => ScriptRuntimeContext
  state: AgentToolExecutionState
}): Promise<{ state: AgentToolExecutionState; toolMessageContent: string }> {
  const {
    toolCall,
    parsedArgs,
    session,
    secrets,
    ctx,
    project,
    testCase,
    effectiveProject,
    effectiveBaseUrl,
    agentSessionId,
    artifactsDir,
    pageMutatingTools,
    recoveryUrl,
    ownedBrowser,
    onStep,
    stepId,
    now,
    truncate,
    cloneRuntimeContext,
  } = params

  let {
    page,
    browserContext,
    recoveryStorageState,
    lastVerifiedCode,
    verifiedRuntimeContext,
    needsRecovery,
    liveStateDirty,
    lastExecuteStepFailed,
    currentContract,
    maxStepTimeoutMs,
  } = params.state

  const title = buildToolTitle(toolCall.name, parsedArgs)
  const callStep: AgentStep = {
    id: stepId(),
    type: "tool_call",
    stage: toolCall.name === "execute_step" ? "generation" : "page",
    title,
    content: title,
    status: "running",
    toolName: toolCall.name,
    timestamp: now(),
    payloadJson: toolCall.name === "execute_step" ? undefined : JSON.stringify(parsedArgs, null, 2),
  }
  onStep(callStep)

  let toolResult: ToolExecutionResult

  if (toolCall.name === "execute_step" && page) {
    const attemptRuntimeContext = cloneRuntimeContext(verifiedRuntimeContext)
    // 记录会话内请求过的最大步骤超时：整段重放要跑完整累积脚本，用它兜底。
    maxStepTimeoutMs = Math.max(maxStepTimeoutMs, clampStepTimeoutMs((parsedArgs as { timeoutMs?: number }).timeoutMs))
    try {
      const stepResult = await executeStepTool(
        parsedArgs as { title: string; code: string; timeoutMs?: number },
        {
          page,
          project: effectiveProject,
          agentSessionId,
          artifactsDir,
          lastVerifiedCode,
          analyzeImage: ctx.analyzeImage,
          requestHumanInput: ctx.requestHumanInput,
          generateText: async (prompt: string, systemPrompt?: string) => {
            return generateTextWithLlm({
              prompt,
              systemPrompt,
              session,
              secrets,
              signal: ctx.signal,
            })
          },
          forceReplayFromCheckpoint: needsRecovery || liveStateDirty,
          replayTimeoutFloorMs: maxStepTimeoutMs,
          resetBrowser: async () => {
            if (!recoveryUrl) {
              return page!
            }

            const recoveryBrowser = browserContext?.browser() ?? ownedBrowser ?? ctx.browser ?? null
            // 持久 profile（launchPersistentContext）：close()+newContext() 会连 Chrome 一起关掉、且
            // 持久浏览器不支持多 context，必崩 "Target page, context or browser has been closed"。
            // 对它只能"原页重新导航"恢复；这也正确——持久模式的登录态/指纹本就保存在目录里，
            // 无需用 storageState 重建。
            if (ctx.persistent || !recoveryBrowser || !recoveryStorageState) {
              try {
                await page!.goto(recoveryUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
              } catch (navErr) {
                if (!(navErr instanceof Error && navErr.message.includes("interrupted by another navigation"))) {
                  throw navErr
                }
                await page!.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
              }
              await recoverBlankSpaRoute(page!, recoveryUrl, effectiveBaseUrl)
              await page!.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
              await waitForPageContent(page!, 15_000)
              return page!
            }

            await browserContext?.close().catch(() => undefined)
            const replayStealth = shouldStealthReplay(ctx.authStorageStateJson, ctx.stealth)
            browserContext = await recoveryBrowser.newContext({
              viewport: replayStealth ? null : { width: 1440, height: 960 },
              ignoreHTTPSErrors: true,
              storageState: recoveryStorageState,
            })
            page = await browserContext.newPage()
            try {
              await page.goto(recoveryUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
            } catch (navErr) {
              if (!(navErr instanceof Error && navErr.message.includes("interrupted by another navigation"))) {
                throw navErr
              }
              await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
            }
            await recoverBlankSpaRoute(page, recoveryUrl, effectiveBaseUrl)
            await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
            await waitForPageContent(page, 15_000)
            return page
          },
          runtimeContext: attemptRuntimeContext,
          contract: currentContract,
          dataTables: ctx.dataTables,
          knowledge: ctx.knowledge,
          onStep: ctx.onStep,
        },
      )

      const stepPassed = Boolean(stepResult.newVerifiedCode)
      if (stepResult.newVerifiedCode) {
        lastVerifiedCode = stepResult.newVerifiedCode
        verifiedRuntimeContext = attemptRuntimeContext
        needsRecovery = false
        lastExecuteStepFailed = false
        liveStateDirty = false
        if (browserContext) {
          recoveryStorageState = await browserContext.storageState().catch(() => recoveryStorageState)
        }
        callStep.status = "completed"
        callStep.content = `步骤「${parsedArgs.title}」验证通过`
      } else {
        needsRecovery = true
        lastExecuteStepFailed = true
        callStep.status = "error"
        callStep.content = `步骤「${parsedArgs.title}」执行失败`
        log.warn("agent.execute_step_validation_failed", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          title: parsedArgs.title,
          contentPreview: truncate(stepResult.content, 600),
        })
      }

      log.debug("agent.execute_step_code_generated", {
        sessionId: agentSessionId,
        projectId: project.id,
        testCaseId: testCase.id,
        title: parsedArgs.title,
        status: stepPassed ? "passed" : "failed",
        generatedCode: String(parsedArgs.code ?? "(无 code)"),
      })
      await appendAgentDebugLog(
        artifactsDir,
        agentSessionId,
        [
          `\n==== ${now()} execute_step「${String(parsedArgs.title)}」 → ${stepPassed ? "PASS" : "FAIL"} ====`,
          `URL: ${stepResult.url ?? page?.url() ?? "?"}`,
          "--- LLM 生成的完整累积脚本 ---",
          String(parsedArgs.code ?? "(无 code)"),
          "--- 执行结果 / 错误 / 完整页面快照（含 iframe）---",
          stepResult.content,
        ].join("\n"),
      )

      if (stepResult.newPage) {
        page = stepResult.newPage
      }

      toolResult = {
        stage: stepResult.stage,
        content: stepResult.content,
        screenshotUrl: stepResult.screenshotUrl,
        url: stepResult.url,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 用户取消会主动关浏览器，同样会命中 isBrowserGoneError——优先按取消处理，别误报成崩溃。
      if (ctx.signal?.aborted) {
        throw new Error("Agent 已被用户取消。")
      }
      // 浏览器进程已没了：再 retry 也只会一直 newContext 失败、把 agent 卡在死循环里。
      // 直接抛出不可恢复错误，让本次运行立刻失败并给出清晰原因。
      if (isBrowserGoneError(message)) {
        log.error("agent.browser_gone", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          title: parsedArgs.title,
          error,
        })
        throw new BrowserGoneError(
          `浏览器在执行步骤「${String(parsedArgs.title)}」时已关闭/崩溃，无法恢复，已中止本次运行。原始错误: ${message}`,
        )
      }
      needsRecovery = true
      lastExecuteStepFailed = true
      log.error("agent.execute_step_failed", {
        sessionId: agentSessionId,
        projectId: project.id,
        testCaseId: testCase.id,
        title: parsedArgs.title,
        error,
      })
      toolResult = {
        stage: "generation",
        content: `execute_step 执行异常: ${message}`,
      }
      callStep.status = "error"
      callStep.content = message
    }
  } else if (toolCall.name === "probe_step" && page) {
    // 探针：一次性代码在当前实时页面上执行，不进累积脚本。可能改动页面状态 → 标脏，
    // 下一次 execute_step 会重置浏览器重放已验证前缀（探针失败不设 needsRecovery——
    // 累积脚本本身没坏，只是实验没成）。
    liveStateDirty = true
    try {
      const probeResult = await executeStepTool(
        { ...(parsedArgs as { title: string; code: string; timeoutMs?: number }), probe: true },
        {
          page,
          project: effectiveProject,
          agentSessionId,
          artifactsDir,
          lastVerifiedCode: "",
          analyzeImage: ctx.analyzeImage,
          requestHumanInput: ctx.requestHumanInput,
          generateText: async (prompt: string, systemPrompt?: string) => {
            return generateTextWithLlm({ prompt, systemPrompt, session, secrets, signal: ctx.signal })
          },
          forceReplayFromCheckpoint: false,
          // 探针永不重置浏览器：它就是要观察当前实时状态
          resetBrowser: async () => page!,
          // 用副本运行时上下文，避免探针里的 temp/outputs 污染已验证上下文
          runtimeContext: cloneRuntimeContext(verifiedRuntimeContext),
          contract: currentContract,
          dataTables: ctx.dataTables,
          knowledge: ctx.knowledge,
          onStep: ctx.onStep,
        },
      )
      toolResult = {
        stage: "page",
        content: probeResult.content,
        screenshotUrl: probeResult.screenshotUrl,
        url: probeResult.url,
      }
      callStep.status = probeResult.stepFailed ? "error" : "completed"
      callStep.content = probeResult.stepFailed ? `探针「${parsedArgs.title}」执行失败` : `探针「${parsedArgs.title}」完成`
      await appendAgentDebugLog(
        artifactsDir,
        agentSessionId,
        [
          `\n==== ${now()} probe_step「${String(parsedArgs.title)}」 → ${probeResult.stepFailed ? "FAIL" : "DONE"} ====`,
          `URL: ${probeResult.url ?? page?.url() ?? "?"}`,
          "--- 探针代码 ---",
          String(parsedArgs.code ?? "(无 code)"),
          "--- 探针结果 ---",
          truncate(probeResult.content, 4000),
        ].join("\n"),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (ctx.signal?.aborted) {
        throw new Error("Agent 已被用户取消。")
      }
      if (isBrowserGoneError(message)) {
        log.error("agent.browser_gone", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          title: parsedArgs.title,
          error,
        })
        throw new BrowserGoneError(
          `浏览器在探针「${String(parsedArgs.title)}」执行时已关闭/崩溃，无法恢复，已中止本次运行。原始错误: ${message}`,
        )
      }
      toolResult = {
        stage: "page",
        content: `probe_step 执行异常: ${message}`,
      }
      callStep.status = "error"
      callStep.content = message
    }
  } else {
    const mutatesLiveState =
      pageMutatingTools.has(toolCall.name) ||
      (toolCall.name === "inspect_page" && Boolean((parsedArgs as { url?: string }).url))
    if (mutatesLiveState) {
      liveStateDirty = true
    }
    try {
      toolResult = await executeTool(toolCall.name, toolCall.arguments, {
        page,
        project: effectiveProject,
        agentSessionId,
        artifactsDir,
        runDir: ctx.runDir,
        generateText: ctx.generateText,
        hasWorkspace: ctx.hasWorkspace,
        listWorkspaceTree: ctx.listWorkspaceTree,
        globWorkspacePaths: ctx.globWorkspacePaths,
        searchWorkspaceCode: ctx.searchWorkspaceCode,
        readWorkspaceFile: ctx.readWorkspaceFile,
        analyzeImage: ctx.analyzeImage,
        defineContract: ctx.defineContract,
        dataTables: ctx.dataTables,
        knowledge: ctx.knowledge,
        signal: ctx.signal,
      })
      callStep.status = "completed"
      callStep.content = `${title} 完成`

      // define_contract 声明后，把契约线程化更新，后续 execute_step 据此注入占位入参。
      if (toolCall.name === "define_contract" && toolResult.payloadJson) {
        try {
          const parsed = JSON.parse(toolResult.payloadJson) as { contract?: CaseContract }
          if (parsed.contract) {
            currentContract = parsed.contract
          }
        } catch {
          // payloadJson 解析失败不影响主流程
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (ctx.signal?.aborted) {
        throw new Error("Agent 已被用户取消。")
      }
      if (isBrowserGoneError(message)) {
        log.error("agent.browser_gone", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          toolName: toolCall.name,
          error,
        })
        throw new BrowserGoneError(
          `浏览器在执行工具「${title}」时已关闭/崩溃，无法恢复，已中止本次运行。原始错误: ${message}`,
        )
      }
      toolResult = {
        stage: "page",
        content: `工具执行失败: ${message}`,
        payloadJson: JSON.stringify(parsedArgs, null, 2),
      }
      callStep.status = "error"
      callStep.content = message
    }
  }

  onStep(callStep)

  onStep({
    id: stepId(),
    type: "tool_result",
    stage: toolResult.stage ?? "page",
    title: `${title} 结果`,
    content: truncate(toolResult.content, 1600),
    detail: toolResult.detail,
    status: callStep.status === "error" ? "error" : "completed",
    toolName: toolCall.name,
    timestamp: now(),
    payloadJson: toolResult.payloadJson,
    screenshotUrl: toolResult.screenshotUrl,
    url: toolResult.url,
    fileName: toolResult.fileName,
    selector: toolResult.selector,
  })

  return {
    state: {
      page,
      browserContext,
      recoveryStorageState,
      lastVerifiedCode,
      verifiedRuntimeContext,
      needsRecovery,
      liveStateDirty,
      lastExecuteStepFailed,
      currentContract,
      maxStepTimeoutMs,
    },
    toolMessageContent: toolResult.content,
  }
}