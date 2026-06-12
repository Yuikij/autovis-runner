import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { launchReplayBrowser, shouldStealthReplay } from "./browser.js"
import { type AgentStep } from "@autovis/shared"
import { callLlmWithTools, type ChatMessage } from "./llm.js"
import { buildAgentSystemPrompt, buildAgentUserPrompt, buildDirectAgentSystemPrompt, buildDirectAgentUserPrompt } from "./agent/prompts.js"
import { buildToolSummary, recoverBlankSpaRoute, waitForPageContent } from "./agent/helpers.js"
import { AGENT_TOOLS } from "./agent/tools/index.js"
import { executeAgentToolCall } from "./agent/tool-execution.js"
import { type AgentContext, type ScriptRuntimeContext, type ToolExecutionResult } from "./agent/types.js"
import { log } from "./log.js"

const MAX_TURNS = 80
const MAX_CONSECUTIVE_TEXT_ONLY = 3
const now = () => new Date().toISOString()
const stepId = () => `step_${Math.random().toString(36).slice(2, 10)}`

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `\n... (truncated, ${text.length} chars total)`
}

function cloneRuntimeValue<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function cloneRuntimeContext(context: ScriptRuntimeContext): ScriptRuntimeContext {
  return {
    outputs: context.outputs.map((output) => ({
      ...output,
      value: cloneRuntimeValue(output.value),
      meta: output.meta ? cloneRuntimeValue(output.meta) : output.meta,
    })),
    tempValues: new Map([...context.tempValues.entries()].map(([key, value]) => [key, cloneRuntimeValue(value)])),
    producer: context.producer ? { ...context.producer } : undefined,
  }
}

export async function runAgentLoop(ctx: AgentContext): Promise<string> {
  const { project, testCase, session, secrets, onStep, artifactsDir, agentSessionId } = ctx
  const effectiveBaseUrl = ctx.effectiveBaseUrl?.trim() || project.testBaseUrl
  // 用克隆后的 project 视图覆盖 testBaseUrl，prompts / execute_step 看到的都是用户选的 URL
  const effectiveProject = effectiveBaseUrl !== project.testBaseUrl ? { ...project, testBaseUrl: effectiveBaseUrl } : project
  log.info("agent.loop_started", {
    sessionId: agentSessionId,
    projectId: project.id,
    projectName: project.name,
    testCaseId: testCase.id,
    testCaseCode: testCase.caseCode,
    effectiveBaseUrl: effectiveBaseUrl || null,
    projectBaseUrlOverridden: effectiveBaseUrl !== project.testBaseUrl,
  })

  const needsBrowser = Boolean(effectiveBaseUrl)
  let ownedBrowser: Browser | null = null
  let browserContext: BrowserContext | null = ctx.browserContext ?? null
  let page: Page | null = ctx.page ?? null

  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalTotalTokens = 0

  let lastVerifiedCode = ctx.lastVerifiedCode ?? ""
  let verifiedRuntimeContext = cloneRuntimeContext(ctx.runtimeContext ?? {
    outputs: [],
    tempValues: new Map<string, unknown>(),
    producer: { testCaseId: testCase.id, caseCode: testCase.caseCode, caseName: testCase.purpose },
  })
  let needsRecovery = false
  // live 浏览器状态是否已偏离"最近一次验证通过的脚本末态"。
  // 一旦用交互探索工具改过页面（探索阶段），下一次 execute_step 必须从干净态全量重放，
  // 否则会把"探索后停留的页面"当成脚本起点，导致回放不一致。
  let liveStateDirty = false
  // 会改变页面状态的探索工具（read-only 的 query/get_html/截图/识图/无 url 的 inspect_page 不算）。
  const PAGE_MUTATING_TOOLS = new Set(["click_element", "fill_input", "press_key", "navigate_to"])

  try {
    if (needsBrowser && !page) {
      const initStep: AgentStep = {
        id: stepId(),
        type: "thinking",
        stage: "page",
        title: "初始化浏览器",
        content: "正在启动 Playwright 浏览器...",
        status: "running",
        timestamp: now(),
      }
      onStep(initStep)
      try {
        if (ctx.browser) {
          // 复用调用方传入的浏览器（如预热阶段已起的会话）。
          ownedBrowser = ctx.browser
          browserContext = browserContext ?? await ownedBrowser.newContext({
            viewport: { width: 1440, height: 960 },
            ignoreHTTPSErrors: true,
            storageState: ctx.authStorageStateJson ? JSON.parse(ctx.authStorageStateJson) : undefined,
          })
        } else if (browserContext) {
          ownedBrowser = browserContext.browser() ?? null
        } else {
          // 全新启动：按站点/用例级配置决定是否走反检测有头真 Chrome（env 仍是最终钳制）。
          const stealth = shouldStealthReplay(ctx.authStorageStateJson, ctx.stealth)
          ownedBrowser = await launchReplayBrowser({ stealth, headless: true })
          browserContext = await ownedBrowser.newContext({
            viewport: stealth ? null : { width: 1440, height: 960 },
            ignoreHTTPSErrors: true,
            storageState: ctx.authStorageStateJson ? JSON.parse(ctx.authStorageStateJson) : undefined,
          })
        }
        page = await browserContext.newPage()
        try {
          await page.goto(effectiveBaseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
        } catch (navErr) {
          if (!(navErr instanceof Error && navErr.message.includes("interrupted by another navigation"))) {
            throw navErr
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined)
        }
        await recoverBlankSpaRoute(page, effectiveBaseUrl, project.testBaseUrl)
        await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
        await waitForPageContent(page, 15_000)
        initStep.status = "completed"
        initStep.content = `浏览器已就绪，已导航到 ${effectiveBaseUrl}`
        log.info("agent.browser_ready", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          effectiveBaseUrl,
        })
        onStep(initStep)
      } catch (launchError) {
        const launchMsg = launchError instanceof Error ? launchError.message : String(launchError)
        const isNotInstalled = launchMsg.includes("Executable doesn't exist") || launchMsg.includes("browserType.launch")
        initStep.status = isNotInstalled ? "completed" : "error"
        initStep.content = isNotInstalled
          ? "Playwright 浏览器未安装，将跳过页面探索，仅基于代码上下文与用例描述生成脚本。（可运行 npx playwright install chromium 安装）"
          : `浏览器启动失败: ${launchMsg}，将跳过页面探索。`
        onStep(initStep)
        ownedBrowser = null
        browserContext = null
        page = null
      }
    } else if (page) {
      onStep({
        id: stepId(),
        type: "thinking",
        stage: "page",
        title: "复用前置浏览器状态",
        content: "已复用前置条件准备好的浏览器页面。",
        status: "completed",
        timestamp: now(),
      })
    }

    const recoveryUrl = ctx.initialPageState?.url || effectiveBaseUrl
    let recoveryStorageState = browserContext
      ? await browserContext.storageState().catch(() => undefined)
      : undefined

    const isDirect = ctx.mode === "direct"

    const messages: ChatMessage[] = [
      { role: "system", content: isDirect ? buildDirectAgentSystemPrompt() : buildAgentSystemPrompt() },
      { role: "user", content: isDirect
        ? buildDirectAgentUserPrompt(effectiveProject, testCase, ctx.request.prompt, ctx.preconditionReport, ctx.initialPageState)
        : buildAgentUserPrompt(effectiveProject, testCase, ctx.request.prompt, ctx.preconditionReport, ctx.initialPageState)
      },
    ]

    const caseTextCorpus = [
      testCase.caseCode,
      testCase.moduleName,
      testCase.purpose ?? "",
      testCase.expectedResult ?? "",
      ...(testCase.steps ?? []),
      ctx.request.prompt ?? "",
    ].join("\n")
    let pageDataCorpus = ctx.initialPageState?.snapshot ?? ""

    const hasBrowser = Boolean(page)
    const tools = isDirect
      ? (hasBrowser
        ? AGENT_TOOLS.filter((tool) => tool.function.name !== "execute_step")
        : AGENT_TOOLS.filter((tool) => ["list_workspace_tree", "glob_workspace_paths", "search_workspace_code", "read_workspace_file"].includes(tool.function.name)))
      : (hasBrowser
        ? AGENT_TOOLS
        : AGENT_TOOLS.filter((tool) => ["list_workspace_tree", "glob_workspace_paths", "search_workspace_code", "read_workspace_file"].includes(tool.function.name)))

    let consecutiveTextOnly = 0
    let consecutiveLlmErrors = 0
    let lastExecuteStepFailed = false

    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      if (ctx.signal?.aborted) {
        throw new Error("Agent 已被用户取消。")
      }
      if (ctx.waitIfPaused) {
        await ctx.waitIfPaused()
      }

      const thinkStep: AgentStep = {
        id: stepId(),
        type: "thinking",
        stage: "generation",
        title: `分析中 (第 ${turn + 1} 轮)`,
        content: "正在调用 AI 模型分析当前代码与页面信息...",
        status: "running",
        timestamp: now(),
      }
      onStep(thinkStep)

      let result
      try {
        result = await callLlmWithTools(session, secrets, messages, tools)
        consecutiveLlmErrors = 0
      } catch (error) {
        consecutiveLlmErrors += 1
        thinkStep.status = "error"
        thinkStep.content = error instanceof Error ? error.message : "LLM 调用失败"
        onStep(thinkStep)
        log.warn("agent.llm_call_failed", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          turn: turn + 1,
          consecutiveFailures: consecutiveLlmErrors,
          error,
        })
        
        if (consecutiveLlmErrors >= 5) {
          throw new Error(`LLM 连续 ${consecutiveLlmErrors} 次调用失败: ${error instanceof Error ? error.message : String(error)}`)
        }
        
        onStep({
          id: stepId(),
          type: "error",
          stage: "generation",
          title: `LLM 调用出错，准备重试 (${consecutiveLlmErrors}/5)`,
          content: `网络或 API 错误，将延时 3 秒后自动重试: ${error instanceof Error ? error.message : String(error)}`,
          status: "error",
          timestamp: now(),
        })
        await new Promise((resolve) => setTimeout(resolve, 3000))
        continue
      }

      if (result.usage) {
        totalPromptTokens += result.usage.promptTokens || 0
        totalCompletionTokens += result.usage.completionTokens || 0
        totalTotalTokens += result.usage.totalTokens || 0
      }

      thinkStep.status = "completed"
      thinkStep.content = "分析完成。"
      onStep(thinkStep)

      if (result.toolCalls.length > 0) {
        consecutiveTextOnly = 0
        messages.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function" as const,
            function: { name: toolCall.name, arguments: toolCall.arguments },
          })),
        })

        for (const toolCall of result.toolCalls) {
          let parsedArgs: Record<string, unknown> = {}
          try {
            parsedArgs = JSON.parse(toolCall.arguments)
          } catch {
            parsedArgs = {}
          }

          const summary = buildToolSummary(toolCall.name, parsedArgs)
          const executed = await executeAgentToolCall({
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
            pageMutatingTools: PAGE_MUTATING_TOOLS,
            recoveryUrl,
            ownedBrowser,
            caseTextCorpus,
            onStep,
            stepId,
            now,
            truncate,
            cloneRuntimeContext,
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
          })

          page = executed.state.page
          browserContext = executed.state.browserContext
          recoveryStorageState = executed.state.recoveryStorageState
          lastVerifiedCode = executed.state.lastVerifiedCode
          verifiedRuntimeContext = executed.state.verifiedRuntimeContext
          needsRecovery = executed.state.needsRecovery
          liveStateDirty = executed.state.liveStateDirty
          lastExecuteStepFailed = executed.state.lastExecuteStepFailed
          pageDataCorpus = executed.state.pageDataCorpus

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: executed.toolMessageContent,
          })
        }
        continue
      }

      // LLM returned text without tool calls.
      // Direct mode: 纯文本 = 任务完成总结，直接接受。
      // Generate mode: 决定逻辑同原来。
      consecutiveTextOnly += 1
      const assistantContent = result.content || ""
      messages.push({ role: "assistant", content: assistantContent })

      if (isDirect) {
        // Direct 模式：LLM 返回纯文本 = 任务完成/总结
        onStep({
          id: stepId(),
          type: "thinking",
          stage: "generation",
          title: "Token 消耗统计",
          content: `本次直接执行累计消耗 Token:\n输入: ${totalPromptTokens}\n输出: ${totalCompletionTokens}\n总计: ${totalTotalTokens}`,
          status: "completed",
          timestamp: now(),
        })
        if (assistantContent) {
          onStep({
            id: stepId(),
            type: "generation",
            stage: "generation",
            title: "任务执行总结",
            content: truncate(assistantContent, 2000),
            status: "completed",
            timestamp: now(),
          })
        }
        return "" // direct 模式不产出脚本
      }

      // ---- Generate 模式原有逻辑 ----
      if (lastVerifiedCode && !lastExecuteStepFailed) {
        onStep({
          id: stepId(),
          type: "thinking",
          stage: "generation",
          title: "Token 消耗统计",
          content: `本次生成脚本累计消耗 Token:\n输入: ${totalPromptTokens}\n输出: ${totalCompletionTokens}\n总计: ${totalTotalTokens}`,
          status: "completed",
          timestamp: now(),
        })
        const genStep: AgentStep = {
          id: stepId(),
          type: "generation",
          stage: "generation",
          title: "脚本生成完成（已逐步验证）",
          content: truncate(lastVerifiedCode, 1200),
          status: "completed",
          timestamp: now(),
        }
        onStep(genStep)
        return lastVerifiedCode
      }

      const reason = lastExecuteStepFailed
        ? "上一次 execute_step 验证失败"
        : "你没有通过 execute_step 提交任何已验证代码"
      const nudgeTitle = lastExecuteStepFailed
        ? `验证失败后不要放弃（第 ${consecutiveTextOnly}/${MAX_CONSECUTIVE_TEXT_ONLY} 次提醒）`
        : `必须调用工具推进（第 ${consecutiveTextOnly}/${MAX_CONSECUTIVE_TEXT_ONLY} 次提醒）`
      onStep({
        id: stepId(),
        type: "error",
        stage: "generation",
        title: nudgeTitle,
        content: `${reason}。系统将忽略你刚才返回的纯文本，要求继续调用 execute_step 推进验证。`,
        status: "error",
        timestamp: now(),
      })

      if (consecutiveTextOnly >= MAX_CONSECUTIVE_TEXT_ONLY) {
        log.warn("agent.execute_step_refused", {
          sessionId: agentSessionId,
          projectId: project.id,
          testCaseId: testCase.id,
          consecutiveTextOnly,
          hasLastVerifiedCode: Boolean(lastVerifiedCode),
        })
        if (lastVerifiedCode) {
          onStep({
            id: stepId(),
            type: "generation",
            stage: "generation",
            title: "AI 多次拒绝继续验证，使用最近一次通过的代码",
            content: truncate(lastVerifiedCode, 1200),
            status: "completed",
            timestamp: now(),
          })
          return lastVerifiedCode
        }
        throw new Error("Agent 反复输出纯文本而拒绝调用 execute_step 验证。请检查模型/提示词后重试。")
      }

      const nudgeMessage = lastExecuteStepFailed
        ? "上一次 execute_step 报错了（错误信息和页面快照已在你刚才看到的 tool 结果里）。**继续调用 execute_step**，根据错误改代码，不要在这里停下；累计代码必须包含已通过部分 + 这次修复后的部分。"
        : "不要只返回纯文本停在这里，**必须调用工具推进**：阶段一就用交互工具（click_element / fill_input / navigate_to / query_elements ...）继续把任务在真实浏览器里做下去；任务已经在浏览器里走通了就用 `execute_step` 把脚本固化。禁止把脚本直接写在消息里返回，那样会被丢弃。"
      messages.push({ role: "user", content: nudgeMessage })
    }

    // Reached max turns
    if (isDirect) {
      // Direct 模式达到最大轮次，视为部分完成
      onStep({
        id: stepId(),
        type: "generation",
        stage: "generation",
        title: "已达最大轮次，直接执行结束",
        content: `Agent 达到最大循环次数（${MAX_TURNS} 轮），直接执行模式结束。`,
        status: "completed",
        timestamp: now(),
      })
      return ""
    }

    if (lastVerifiedCode) {
      onStep({
        id: stepId(),
        type: "generation",
        stage: "generation",
        title: "已达最大轮次，使用已验证脚本",
        content: `Agent 达到最大循环次数，但已有 ${lastVerifiedCode.split("\n").length} 行已验证代码。`,
        status: "completed",
        timestamp: now(),
      })
      return lastVerifiedCode
    }

    throw new Error("Agent 已达到最大循环次数，未能完成脚本生成。")
  } finally {
    if (ownedBrowser) {
      await ownedBrowser.close().catch(() => undefined)
    }
  }
}
