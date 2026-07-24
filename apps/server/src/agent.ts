import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { launchReplayBrowser, shouldStealthReplay } from "./browser.js"
import { type AgentStep, type CaseContract } from "@autovis/shared"
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

/**
 * 初始导航带重试。之前初始 `page.goto` 一超时/失败就把整个浏览器丢弃、agent 降级成"无页面只剩 workspace 工具"，
 * 一发瞬时网络抖动（如目标站首屏慢）就能废掉整个 direct 任务。改为重试几次；即便最终失败也**返回 false 而不抛错**，
 * 让调用方保留浏览器、由后续 `navigate_to` 再试（页面暂为空白不致命）。
 */
async function gotoWithRetry(page: Page, url: string, attempts = 3, timeoutMs = 20_000): Promise<boolean> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
      return true
    } catch (err) {
      // 被后续导航打断：页面其实已经在跳，等一下即可，视为成功。
      if (err instanceof Error && err.message.includes("interrupted by another navigation")) {
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined)
        return true
      }
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000 * i))
    }
  }
  return false
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
  // 本会话 execute_step 请求过的最大步骤超时（钳制后）；整段重放时作为超时下限。
  let maxStepTimeoutMs = 0
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
        // 初始导航失败不再丢弃浏览器：重试几次，仍失败也保留 page（空白），由后续 navigate_to 兜底。
        // 后续的 SPA 兜底 / 等内容都用 .catch 包住，避免任一抛错把整个浏览器连坐掉。
        const landed = await gotoWithRetry(page, effectiveBaseUrl, 3)
        if (landed) {
          await recoverBlankSpaRoute(page, effectiveBaseUrl, project.testBaseUrl).catch(() => undefined)
          await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => undefined)
          await waitForPageContent(page, 15_000).catch(() => undefined)
        }
        initStep.status = "completed"
        initStep.content = landed
          ? `浏览器已就绪，已导航到 ${effectiveBaseUrl}`
          : `浏览器已就绪，但初始导航到 ${effectiveBaseUrl} 未成功（页面暂为空白，将由后续 navigate_to 重试）。`
        if (!landed) {
          log.warn("agent.initial_goto_failed", {
            sessionId: agentSessionId,
            projectId: project.id,
            testCaseId: testCase.id,
            effectiveBaseUrl,
          })
        }
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

    // 取消时主动关闭浏览器上下文，让任何卡住的 Playwright 操作（page.goto / waitForSelector /
    // execute_step 等）立即以 "Target closed" 抛错中止，而不必等其自身超时。闭包读取的是
    // 变量的实时值，故工具执行过程中被重建的 context/browser 同样会被关闭。
    if (ctx.signal && !ctx.signal.aborted) {
      ctx.signal.addEventListener(
        "abort",
        () => {
          void page?.close().catch(() => undefined)
          void browserContext?.close().catch(() => undefined)
          void ownedBrowser?.close().catch(() => undefined)
        },
        { once: true },
      )
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

    // 线程化当前契约：固化阶段 define_contract 声明后更新，后续 execute_step 据此注入占位入参。
    let currentContract: CaseContract | undefined = ctx.testCase.contract

    // —— 多标签跟随 ——
    // 站点登录/发布链路常把目标页开到新标签（小红书点"发布"→creator.xiaohongshu.com 新标签）。
    // runner 的实时预览会把推流切到最新标签，但 LLM 操作/截快照用的 page 默认停在初始标签，
    // 导致"用户看到的画面"与"LLM 实际操作的页面"错位、agent 在旧标签上空转（见 53 轮空跑）。
    // 跟随最新打开且未关闭的标签，关闭时回退到仍存活的最后一个，使二者对齐。
    let activePage: Page | null = page
    const followPage = (candidate: Page) => {
      activePage = candidate
      candidate.once("close", () => {
        if (activePage !== candidate) return
        const survivors = browserContext?.pages().filter((p) => !p.isClosed()) ?? []
        activePage = survivors.length ? survivors[survivors.length - 1] : null
      })
    }
    let followedContext: BrowserContext | null = null
    const attachPageFollow = (context: BrowserContext | null) => {
      if (!context || context === followedContext) return
      followedContext = context
      context.on("page", (opened) => {
        void opened
          .waitForLoadState("domcontentloaded", { timeout: 15_000 })
          .catch(() => undefined)
          .then(() => followPage(opened))
      })
    }
    if (page) followPage(page)
    attachPageFollow(browserContext)

    const hasBrowser = Boolean(page)
    const tools = isDirect
      ? (hasBrowser
        // direct 模式没有"累积脚本"概念：execute_step / probe_step 都不暴露
        ? AGENT_TOOLS.filter((tool) => !["execute_step", "probe_step"].includes(tool.function.name))
        : AGENT_TOOLS.filter((tool) => ["list_workspace_tree", "glob_workspace_paths", "search_workspace_code", "read_workspace_file"].includes(tool.function.name)))
      : (hasBrowser
        ? AGENT_TOOLS.filter((tool) => !["save_report", "translate_document", "query_data_table", "save_data_table_row"].includes(tool.function.name))
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
        result = await callLlmWithTools(session, secrets, messages, tools, ctx.signal)
        consecutiveLlmErrors = 0
      } catch (error) {
        // 用户取消会让底层 fetch 以 AbortError 抛出：立即中止，不要当成网络错误去重试/延时。
        if (ctx.signal?.aborted) {
          throw new Error("Agent 已被用户取消。")
        }
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
          // 工具串行执行可能较长（execute_step / Playwright 等），每个工具前都检查取消，尽快中止。
          if (ctx.signal?.aborted) {
            throw new Error("Agent 已被用户取消。")
          }
          // 跟随到最新活动标签：保证工具操作和返回给 LLM 的页面快照与实时预览同一页。
          if (activePage && !activePage.isClosed() && activePage !== page) {
            page = activePage
          }
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
              currentContract,
              maxStepTimeoutMs,
            },
          })

          page = executed.state.page
          browserContext = executed.state.browserContext
          // execute_step 整段重放可能重建 context/page（非持久回放）：把跟随器接到新 context，
          // 并在当前没有有效活动页时以重建后的 page 兜底，避免跟丢。
          attachPageFollow(browserContext)
          if (page && (!activePage || activePage.isClosed())) {
            followPage(page)
          }
          recoveryStorageState = executed.state.recoveryStorageState
          lastVerifiedCode = executed.state.lastVerifiedCode
          verifiedRuntimeContext = executed.state.verifiedRuntimeContext
          needsRecovery = executed.state.needsRecovery
          liveStateDirty = executed.state.liveStateDirty
          lastExecuteStepFailed = executed.state.lastExecuteStepFailed
          currentContract = executed.state.currentContract
          maxStepTimeoutMs = executed.state.maxStepTimeoutMs

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
