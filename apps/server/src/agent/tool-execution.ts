import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { generateTextWithLlm, type LlmSecretState } from "../llm.js"
import { log } from "../log.js"
import type { AgentStep, Project, TestCase } from "@autovis/shared"

import { shouldStealthReplay } from "../browser.js"
import { appendAgentDebugLog, buildToolTitle, getPageSnapshot, recoverBlankSpaRoute, waitForPageContent } from "./helpers.js"
import { executeTool } from "./tools/index.js"
import { executeStepTool } from "./tools/execute-step.js"
import { type AgentContext, type ScriptRuntimeContext, type ToolExecutionResult } from "./types.js"

type ToolCall = {
  id: string
  name: string
  arguments: string
}

type BrowserStorageState = Awaited<ReturnType<BrowserContext["storageState"]>>

export interface AgentToolExecutionState {
  page: Page | null
  browserContext: BrowserContext | null
  recoveryStorageState?: BrowserStorageState
  lastVerifiedCode: string
  verifiedRuntimeContext: ScriptRuntimeContext
  needsRecovery: boolean
  liveStateDirty: boolean
  lastExecuteStepFailed: boolean
  pageDataCorpus: string
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
  caseTextCorpus: string
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
    caseTextCorpus,
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
    pageDataCorpus,
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
    try {
      const stepResult = await executeStepTool(
        parsedArgs as { title: string; code: string },
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
            })
          },
          forceReplayFromCheckpoint: needsRecovery || liveStateDirty,
          resetBrowser: async () => {
            if (!recoveryUrl) {
              return page!
            }

            const recoveryBrowser = browserContext?.browser() ?? ownedBrowser ?? ctx.browser ?? null
            if (!recoveryBrowser || !recoveryStorageState) {
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
            const replayStealth = shouldStealthReplay(ctx.authStorageStateJson)
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
          dataGuard: { caseTextCorpus, pageDataCorpus },
          runtimeContext: attemptRuntimeContext,
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

      if (page) {
        try {
          const fresh = await getPageSnapshot(page)
          if (fresh) {
            pageDataCorpus = fresh
          }
        } catch {
          // snapshot errors should not stop the loop
        }
      }

      toolResult = {
        stage: stepResult.stage,
        content: stepResult.content,
        screenshotUrl: stepResult.screenshotUrl,
        url: stepResult.url,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
        hasWorkspace: ctx.hasWorkspace,
        listWorkspaceTree: ctx.listWorkspaceTree,
        globWorkspacePaths: ctx.globWorkspacePaths,
        searchWorkspaceCode: ctx.searchWorkspaceCode,
        readWorkspaceFile: ctx.readWorkspaceFile,
        analyzeImage: ctx.analyzeImage,
      })
      callStep.status = "completed"
      callStep.content = `${title} 完成`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
      pageDataCorpus,
    },
    toolMessageContent: toolResult.content,
  }
}