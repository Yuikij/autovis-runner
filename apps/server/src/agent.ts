import { type Browser, type BrowserContext, type Page } from "@playwright/test"
import { launchReplayBrowser, shouldStealthReplay } from "./browser.js"
import { type AgentStep } from "@autovis/shared"
import { callLlmWithTools, generateTextWithLlm, type ChatMessage } from "./llm.js"
import { buildAgentSystemPrompt, buildAgentUserPrompt, buildDirectAgentSystemPrompt, buildDirectAgentUserPrompt } from "./agent/prompts.js"
import { appendAgentDebugLog, buildToolSummary, buildToolTitle, getPageSnapshot } from "./agent/helpers.js"
import { AGENT_TOOLS, executeTool } from "./agent/tools/index.js"
import { executeStepTool } from "./agent/tools/execute-step.js"
import { type AgentContext, type ScriptRuntimeContext, type ToolExecutionResult } from "./agent/types.js"

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
  console.log(`[agent ${agentSessionId}] start: project=${project.name} case=${testCase.caseCode} effectiveBaseUrl=${effectiveBaseUrl || "(none)"}${effectiveBaseUrl !== project.testBaseUrl ? ` (overridden from project.testBaseUrl=${project.testBaseUrl})` : ""}`)

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
            storageState: ctx.authStorageStateJson ? JSON.parse(ctx.authStorageStateJson) : undefined,
          })
        } else if (browserContext) {
          ownedBrowser = browserContext.browser() ?? null
        } else {
          // 全新启动：注入了登录态就用反检测有头真 Chrome，指纹与采集时一致，避免被风控跳回登录。
          const stealth = shouldStealthReplay(ctx.authStorageStateJson)
          ownedBrowser = await launchReplayBrowser({ stealth, headless: true })
          browserContext = await ownedBrowser.newContext({
            viewport: stealth ? null : { width: 1440, height: 960 },
            storageState: ctx.authStorageStateJson ? JSON.parse(ctx.authStorageStateJson) : undefined,
          })
        }
        page = await browserContext.newPage()
        await page.goto(effectiveBaseUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
        await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined)
        initStep.status = "completed"
        initStep.content = `浏览器已就绪，已导航到 ${effectiveBaseUrl}`
        console.log(`[agent ${agentSessionId}] browser ready at ${effectiveBaseUrl}`)
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
    const recoveryStorageState = browserContext
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
        console.error(`[agent ${agentSessionId}] LLM 调用失败 (turn ${turn + 1}):`, error)
        
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

          const title = buildToolTitle(toolCall.name, parsedArgs)
          const summary = buildToolSummary(toolCall.name, parsedArgs)

          const callStep: AgentStep = {
            id: stepId(),
            type: "tool_call",
            stage: toolCall.name === "execute_step" ? "generation" : "page",
            title,
            content: summary,
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
                      await page!.goto(recoveryUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
                      await page!.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined)
                      return page!
                    }

                    await browserContext?.close().catch(() => undefined)
                    // 回放必须与生成时同一指纹，否则\u201c脚本写完了重放也不一定对\u201d：
                    // 初始 context 在 stealth 时用 viewport:null（见上方启动逻辑），这里保持一致。
                    const replayStealth = shouldStealthReplay(ctx.authStorageStateJson)
                    browserContext = await recoveryBrowser.newContext({
                      viewport: replayStealth ? null : { width: 1440, height: 960 },
                      storageState: recoveryStorageState,
                    })
                    page = await browserContext.newPage()
                    await page.goto(recoveryUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
                    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined)
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
                // 执行成功（增量或全量重放）后，live 页面 == 已验证脚本末态。
                liveStateDirty = false
                callStep.status = "completed"
                callStep.content = `步骤「${parsedArgs.title}」验证通过`
              } else {
                needsRecovery = true
                lastExecuteStepFailed = true
                callStep.status = "error"
                callStep.content = `步骤「${parsedArgs.title}」执行失败`
                console.warn(`[agent ${agentSessionId}] execute_step「${parsedArgs.title}」验证失败，等待 LLM 修复后重试。content=${truncate(stepResult.content, 600)}`)
              }

              // 详细调试：打印 LLM 实际生成的完整脚本（控制台），并把脚本 + 未截断的执行结果/页面快照
              // 落盘到 <DATA_DIR>/artifacts/<sessionId>/agent-debug.log，便于排查"为什么这步失败"。
              console.log(
                `[agent ${agentSessionId}] execute_step「${parsedArgs.title}」${stepPassed ? "PASS" : "FAIL"} · LLM 生成脚本 ↓↓↓\n${String(parsedArgs.code ?? "(无 code)")}\n[agent ${agentSessionId}] ↑↑↑`,
              )
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
                    pageDataCorpus = pageDataCorpus.length > 40_000 ? fresh : `${pageDataCorpus}\n${fresh}`
                  }
                } catch {
                  // 快照失败不影响主流程
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
              console.error(`[agent ${agentSessionId}] execute_step「${parsedArgs.title}」抛出异常:`, error)
              toolResult = {
                stage: "generation",
                content: `execute_step 执行异常: ${message}`,
              }
              callStep.status = "error"
              callStep.content = message
            }
          } else {
            // 交互探索工具改了页面 → 标记 live 状态已脏，下次 execute_step 会从干净态全量重放校验。
            const mutatesLiveState =
              PAGE_MUTATING_TOOLS.has(toolCall.name) ||
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

          const resultStep: AgentStep = {
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
          }
          onStep(resultStep)

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult.content,
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
        console.warn(`[agent ${agentSessionId}] LLM 连续 ${consecutiveTextOnly} 轮拒绝调用 execute_step（lastVerifiedCode=${lastVerifiedCode ? "有" : "无"}）。`)
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
