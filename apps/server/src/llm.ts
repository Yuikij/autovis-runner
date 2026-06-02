import type {
  GenerateScriptRequest,
  LlmSessionConfig,
  Project,
  TestCase,
} from "@autovis/shared"
import {
  analyzeImageWithCopilot,
  callCopilotWithTools,
  CopilotSessionError,
  copilotHeaders,
  disconnectCopilotSession,
  ensureCopilotToken,
  fetchCopilotModels,
  generateScriptWithCopilot,
  parseContent,
  type AnalyzeImageWithCopilotInput,
  type ChatMessage,
  type CopilotSecretState,
  type CopilotToolCallResult,
  type ScriptGenerationContext,
  type ToolDefinition,
} from "./copilot.js"

export interface LlmSecretState {
  apiKey?: string
  copilot?: CopilotSecretState
}

const OPENAI_USER_AGENT = "AutoVis/0.1"
const ANTHROPIC_VERSION = "2023-06-01"

const requireApiKey = (secrets: LlmSecretState) => {
  if (!secrets.apiKey?.trim()) {
    throw new Error("当前 API 配置未填写 API Key。")
  }

  return secrets.apiKey.trim()
}

const buildScriptSystemPrompt = () =>
  [
    "You are generating runnable Playwright TypeScript logic for a Chinese enterprise admin web application.",
    "Return only runnable TypeScript code.",
    "Do not import or declare test, human, ai, chromium, or browser fixtures.",
    "Assume page, expect, human, ai, and test are already available at runtime.",
    "Write only the body that runs inside an existing async Playwright context, although using await test.step(...) is allowed.",
    "Prefer robust role/label/text locators.",
    "Keep comments minimal.",
    "Do not wrap the answer in markdown fences unless necessary.",
    "Always include robust assertions (using expect) based on the test case's expected results to verify page states, notifications, navigation changes, or visible elements.",
    "Do NOT call page.screenshot() manually to capture execution screenshots, as the runner automatically captures screenshots for each step.",
    "The page is ALREADY navigated to the Project base URL. Do NOT call page.goto() with absolute URLs or declare baseUrl variables.",
    "When a flow requires captcha, use a retry loop (up to 3 times): analyze image -> fill -> click submit -> check success -> break if success, otherwise wait for a new captcha.",
    "If the captcha retry loop fails all attempts, use await human.input(...) as a fallback.",
    "Generate runnable Playwright logic for the described admin UI without wrapping it in test(...) or importing @playwright/test.",
    "IMPORTANT: Do NOT declare const baseUrl or call page.goto(baseUrl). The runner has already navigated to the target URL.",
    "For captchas, remember to implement a retry loop (max 3 times) and fallback to await human.input({ reason: 'captcha_failed', instruction: '请手动输入验证码' })."
  ].join(" ")

const buildScriptUserPrompt = ({ request, project, testCase }: ScriptGenerationContext) => {
  const parts = [
    `Project base URL: ${project.testBaseUrl || "/"}`,
    `Test case code: ${testCase.caseCode}`,
    `Module: ${testCase.moduleName}`,
    `Purpose: ${testCase.purpose}`,
    `Expected result: ${testCase.expectedResult}`,
    `Steps:\n${testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
  ]
  if (request.prompt?.trim()) {
    parts.push(`Natural language instruction:\n${request.prompt.trim()}`)
  }
  return parts.join("\n\n")
}

const extractText = (payload: any): string => {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === "string" && content.trim()) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item === "string") return item
        if (typeof item?.text === "string") return item.text
        return ""
      })
      .join("\n")
      .trim()
    if (text) return text
  }

  const anthropicText = Array.isArray(payload?.content)
    ? payload.content
        .filter((item: any) => item?.type === "text" && typeof item.text === "string")
        .map((item: any) => item.text)
        .join("\n")
        .trim()
    : ""
  if (anthropicText) {
    return anthropicText
  }

  throw new Error("LLM 返回内容为空。")
}

const extractCodeBlock = (text: string) => {
  const fencedMatch = text.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i)
  return (fencedMatch?.[1] ?? text).trim()
}

const withPath = (baseUrl: string, path: string) => {
  const normalized = baseUrl.replace(/\/+$/, "")
  if (normalized.endsWith(`/${path}`)) {
    return normalized
  }
  return `${normalized}/${path}`
}

const openAiHeaders = (apiKey: string) => ({
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "User-Agent": OPENAI_USER_AGENT,
})

const anthropicHeaders = (apiKey: string) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": OPENAI_USER_AGENT,
  "x-api-key": apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
})

const parseResponse = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return await response.json()
  }
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

const parseErrorMessage = (payload: any, fallback: string) => {
  if (typeof payload?.error?.message === "string") return payload.error.message
  if (typeof payload?.message === "string") return payload.message
  if (typeof payload?.error === "string") return payload.error
  return fallback
}

const buildAnthropicMessages = (messages: ChatMessage[]) => {
  const system = messages
    .filter((item) => item.role === "system" && typeof item.content === "string")
    .map((item) => item.content)
    .join("\n\n")

  const conversation = messages
    .filter((item) => item.role !== "system")
    .map((item) => {
      if (item.role === "tool") {
        return {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: item.tool_call_id,
              content: item.content ?? "",
            },
          ],
        }
      }

      if (item.role === "assistant" && item.tool_calls?.length) {
        return {
          role: "assistant",
          content: [
            ...(item.content ? [{ type: "text", text: item.content }] : []),
            ...item.tool_calls.map((toolCall) => ({
              type: "tool_use",
              id: toolCall.id,
              name: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments || "{}"),
            })),
          ],
        }
      }

      return {
        role: item.role,
        content: item.content ?? "",
      }
    })

  return { system, conversation }
}

const callOpenAiCompatible = async (session: LlmSessionConfig, secrets: LlmSecretState, body: Record<string, unknown>) => {
  const url = withPath(session.baseUrl, "chat/completions")
  const headers = openAiHeaders(requireApiKey(secrets))

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, `调用 OpenAI 兼容接口失败: ${response.status}`))
  }
  return payload
}

const callAnthropicCompatible = async (session: LlmSessionConfig, secrets: LlmSecretState, body: Record<string, unknown>) => {
  const url = withPath(session.baseUrl, "messages")
  const headers = anthropicHeaders(requireApiKey(secrets))

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, `调用 Anthropic 兼容接口失败: ${response.status}`))
  }
  return payload
}

export const startCopilotDeviceFlowForConfig = async (session: LlmSessionConfig) => {
  const mod = await import("./copilot.js")
  return mod.startCopilotDeviceFlow(session)
}

export const pollCopilotDeviceFlowForConfig = async (session: LlmSessionConfig, secrets: CopilotSecretState) => {
  const mod = await import("./copilot.js")
  return mod.pollCopilotDeviceFlow(session, secrets)
}

export const disconnectLlmSession = (session: LlmSessionConfig) => {
  if (session.provider === "copilot-proxy") {
    return {
      session: disconnectCopilotSession(session).session,
      secrets: {} as LlmSecretState,
    }
  }

  return {
    session: {
      ...session,
      signedIn: false,
      connectionStatus: "disconnected" as const,
      lastError: undefined,
      pendingDeviceAuth: undefined,
      lastSyncedAt: new Date().toISOString(),
    },
    secrets: {} as LlmSecretState,
  }
}

export const fetchModelsForConfig = async (session: LlmSessionConfig, secrets: LlmSecretState) => {
  if (session.provider === "copilot-proxy") {
    return fetchCopilotModels(session, secrets.copilot ?? {})
  }

  if (session.provider === "openai-compatible") {
    const response = await fetch(withPath(session.baseUrl, "models"), {
      headers: openAiHeaders(requireApiKey(secrets)),
    })
    const payload = await parseResponse(response)
    if (!response.ok) {
      throw new Error(parseErrorMessage(payload, `获取模型列表失败: ${response.status}`))
    }
    return Array.isArray(payload?.data)
      ? payload.data.map((item: any) => ({
          id: String(item.id ?? ""),
          name: String(item.id ?? ""),
          vendor: "OpenAI-compatible",
        }))
      : []
  }

  const response = await fetch(withPath(session.baseUrl, "models"), {
    headers: anthropicHeaders(requireApiKey(secrets)),
  })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, `获取模型列表失败: ${response.status}`))
  }
  const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
  return items.map((item: any) => ({
    id: String(item.id ?? item.name ?? ""),
    name: String(item.display_name ?? item.id ?? item.name ?? ""),
    vendor: "Anthropic-compatible",
  }))
}

export const generateScriptWithLlm = async (context: ScriptGenerationContext & { secrets: LlmSecretState }) => {
  if (context.session.provider === "copilot-proxy") {
    return generateScriptWithCopilot({
      ...context,
      secrets: context.secrets.copilot ?? {},
    })
  }

  if (context.session.provider === "openai-compatible") {
    const payload = await callOpenAiCompatible(context.session, context.secrets, {
      model: context.session.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: buildScriptSystemPrompt() },
        { role: "user", content: buildScriptUserPrompt(context) },
      ],
    })
    return extractCodeBlock(extractText(payload))
  }

  const payload = await callAnthropicCompatible(context.session, context.secrets, {
    model: context.session.model,
    max_tokens: 4000,
    temperature: 0.1,
    system: buildScriptSystemPrompt(),
    messages: [{ role: "user", content: buildScriptUserPrompt(context) }],
  })
  return extractCodeBlock(extractText(payload))
}

/**
 * 双对照模式 (V2) 的额外上下文。SOP：
 *   1. 后端用同一 URL 分别开"带 storageState"和"匿名"两个浏览器
 *   2. 各自采集 DOM snapshot
 *   3. 把两份 snapshot 喂给模型，让它输出脚本
 *   4. 后端用脚本再回放两边：登录态必须通过、匿名必须失败
 *   5. 不达标则把失败原因回传，最多重试 N 轮
 */
export interface ValidationScriptDualContext {
  project: Project
  authProfileName: string
  authProfileDescription?: string
  loginUrl: string
  authedUrl: string
  anonUrl: string
  authedSnapshot: string
  anonSnapshot: string
  /** 当前是第几轮（1-based） */
  attempt: number
  /** 上轮失败的脚本和原因；首轮无 */
  previousAttempt?: { code: string; failureReason: string }
}

const buildValidationScriptSystemPrompt = () =>
  [
    "You are generating a lightweight Playwright TypeScript validation script that checks whether a browser auth session is still valid.",
    "OUTPUT RULES:",
    "  - Return ONLY runnable TypeScript code, no markdown fences, no commentary.",
    "  - No import statements. Assume `page` (Playwright Page) and `expect` (Playwright expect) are globally available.",
    "  - Do NOT use human.input, ai.analyzeImage, test.step, screenshot, or any runtime objects other than `page` and `expect`.",
    "BEHAVIOR REQUIREMENTS:",
    "  - The browser will already be at the target URL when your code runs. You MAY call page.waitForLoadState() / page.waitForSelector() but you do NOT need to navigate again.",
    "  - If the session appears valid, exit cleanly (no return value needed).",
    "  - If the session appears invalid, throw an Error with a descriptive message (e.g. throw new Error('未登录：检测到登录表单')).",
    "VERIFICATION TARGET:",
    "  - Your script will be replayed against TWO browser contexts: one WITH the stored auth state (must PASS), one WITHOUT (must THROW).",
    "  - So your assertions must distinguish 『已登录』 from 『匿名』 based on actual UI signals — not generic checks that both states satisfy.",
    "  - Prefer assertions on elements that ONLY appear when logged in: user avatar/menu, logout button, dashboard-only links, account name display, or assertions that the current URL is NOT a /login redirect.",
    "QUALITY:",
    "  - Use robust locators: prefer getByRole, getByText, getByLabel over fragile CSS selectors.",
    "  - Keep total runtime under 10 seconds. Avoid long arbitrary timeouts.",
    "  - Script must be self-contained and idempotent.",
  ].join("\n")

const truncateSnapshot = (snapshot: string, max = 6000): string => {
  if (snapshot.length <= max) return snapshot
  return snapshot.slice(0, max) + `\n... (truncated, ${snapshot.length} chars total)`
}

const buildValidationScriptUserPromptV2 = (ctx: ValidationScriptDualContext) => {
  const sections: string[] = [
    `# Target`,
    `Project base URL: ${ctx.project.testBaseUrl || "/"}`,
    `Login URL (same URL is used for both contexts): ${ctx.loginUrl}`,
    `Auth profile: ${ctx.authProfileName}${ctx.authProfileDescription ? ` — ${ctx.authProfileDescription}` : ""}`,
    "",
    `# Snapshot A · 「登录态」浏览器实际表现`,
    `Final URL after navigation: ${ctx.authedUrl}`,
    "DOM signals:",
    "```",
    truncateSnapshot(ctx.authedSnapshot),
    "```",
    "",
    `# Snapshot B · 「匿名」浏览器实际表现（对照组）`,
    `Final URL after navigation: ${ctx.anonUrl}`,
    "DOM signals:",
    "```",
    truncateSnapshot(ctx.anonSnapshot),
    "```",
    "",
    `# Task`,
    "Compare A vs B and emit a validation script whose assertions:",
    "  - PASS when run against snapshot A (the logged-in browser).",
    "  - THROW when run against snapshot B (the anonymous browser).",
    "Anchor your assertions to concrete elements/URL differences you can see above. Do NOT invent selectors that don't appear in either snapshot.",
  ]

  if (ctx.previousAttempt) {
    sections.push(
      "",
      `# Previous attempt (attempt ${ctx.attempt - 1}) failed`,
      "Last script:",
      "```ts",
      ctx.previousAttempt.code,
      "```",
      "",
      "Failure reason:",
      ctx.previousAttempt.failureReason,
      "",
      "Fix the issue above. Re-emit the FULL script, no diff.",
    )
  }

  sections.push(
    "",
    "Output the final TypeScript code only, no fences, no commentary.",
  )

  return sections.join("\n")
}

/**
 * V2: 双对照模式 — 上层会负责采集两份 snapshot 并执行回归测试。
 */
export const generateValidationScriptWithLlmV2 = async (
  context: ValidationScriptDualContext & { session: LlmSessionConfig; secrets: LlmSecretState },
) => {
  const systemPrompt = buildValidationScriptSystemPrompt()
  const userPrompt = buildValidationScriptUserPromptV2(context)

  if (context.session.provider === "copilot-proxy") {
    const accessToken = await ensureCopilotToken(context.session, context.secrets.copilot ?? {})
    const url = `${context.session.baseUrl}/chat/completions`
    const headers = copilotHeaders(accessToken)
    const body = {
      model: context.session.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
    const payload = await parseContent<unknown>(response)
    if (!response.ok) {
      throw new CopilotSessionError(
        typeof payload === "object" && payload !== null && "error" in payload
          ? String((payload as any).error?.message ?? payload)
          : `Copilot validation script generation failed with status ${response.status}`,
        response.status === 401 || response.status === 403 ? 401 : 502,
      )
    }
    const text = typeof payload === "object" && payload !== null
      ? ((payload as any).choices?.[0]?.message?.content ?? (payload as any).output_text ?? "")
      : ""
    return extractCodeBlock(typeof text === "string" ? text : "")
  }

  if (context.session.provider === "openai-compatible") {
    const payload = await callOpenAiCompatible(context.session, context.secrets, {
      model: context.session.model,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    })
    return extractCodeBlock(extractText(payload))
  }

  const payload = await callAnthropicCompatible(context.session, context.secrets, {
    model: context.session.model,
    max_tokens: 2000,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })
  return extractCodeBlock(extractText(payload))
}

export const analyzeImageWithLlm = async (
  input: Omit<AnalyzeImageWithCopilotInput, "secrets"> & { session: LlmSessionConfig; secrets: LlmSecretState },
) => {
  if (input.session.provider === "copilot-proxy") {
    return analyzeImageWithCopilot({
      ...input,
      secrets: input.secrets.copilot ?? {},
    })
  }

  if (input.session.provider === "openai-compatible") {
    const payload = await callOpenAiCompatible(input.session, input.secrets, {
      model: input.session.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            { type: "image_url", image_url: { url: input.dataUrl } },
          ],
        },
      ],
    })
    return { mimeType: input.mimeType, text: extractText(payload) }
  }

  const base64Data = input.dataUrl.split(",")[1] ?? ""
  const payload = await callAnthropicCompatible(input.session, input.secrets, {
    model: input.session.model,
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
  })
  return { mimeType: input.mimeType, text: extractText(payload) }
}

export const generateTextWithLlm = async (
  input: { prompt: string; systemPrompt?: string; session: LlmSessionConfig; secrets: LlmSecretState }
) => {
  const messages: ChatMessage[] = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: input.prompt });

  const result = await callLlmWithTools(input.session, input.secrets, messages, []);
  return result.content || "";
}


export const callLlmWithTools = async (
  session: LlmSessionConfig,
  secrets: LlmSecretState,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<CopilotToolCallResult> => {
  if (session.provider === "copilot-proxy") {
    return callCopilotWithTools(session, secrets.copilot ?? {}, messages, tools)
  }

  if (session.provider === "openai-compatible") {
    const payload = await callOpenAiCompatible(session, secrets, {
      model: session.model,
      temperature: 0.1,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    })
    const choice = payload?.choices?.[0] ?? {}
    const toolCalls = Array.isArray(choice?.message?.tool_calls)
      ? choice.message.tool_calls.map((toolCall: any) => ({
          id: String(toolCall.id ?? ""),
          name: String(toolCall.function?.name ?? ""),
          arguments: String(toolCall.function?.arguments ?? "{}"),
        }))
      : []
    const rawUsage = payload?.usage
    const usage = rawUsage
      ? {
          promptTokens: Number(rawUsage.prompt_tokens ?? 0),
          completionTokens: Number(rawUsage.completion_tokens ?? 0),
          totalTokens: Number(rawUsage.total_tokens ?? 0),
        }
      : undefined
    return {
      finishReason: String(choice?.finish_reason ?? "stop"),
      content: typeof choice?.message?.content === "string" ? choice.message.content : null,
      toolCalls,
      usage,
    }
  }

  const anthropicTools = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))
  const { system, conversation } = buildAnthropicMessages(messages)
  const payload = await callAnthropicCompatible(session, secrets, {
    model: session.model,
    max_tokens: 4000,
    temperature: 0.1,
    system,
    messages: conversation,
    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
  })

  const toolCalls = Array.isArray(payload?.content)
    ? payload.content
        .filter((item: any) => item?.type === "tool_use")
        .map((item: any) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
          arguments: JSON.stringify(item.input ?? {}),
        }))
    : []

  const rawUsage = payload?.usage
  const usage = rawUsage
    ? {
        promptTokens: Number(rawUsage.input_tokens ?? 0),
        completionTokens: Number(rawUsage.output_tokens ?? 0),
        totalTokens: Number((rawUsage.input_tokens ?? 0) + (rawUsage.output_tokens ?? 0)),
      }
    : undefined

  return {
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    content: Array.isArray(payload?.content)
      ? payload.content
          .filter((item: any) => item?.type === "text")
          .map((item: any) => item.text)
          .join("\n")
          .trim() || null
      : null,
    toolCalls,
    usage,
  }
}

export const ensureLlmSessionConnected = async (session: LlmSessionConfig, secrets: LlmSecretState) => {
  if (session.provider === "copilot-proxy") {
    const accessToken = await ensureCopilotToken(session, secrets.copilot ?? {})
    return {
      session: {
        ...session,
        signedIn: true,
        connectionStatus: "connected" as const,
        apiKeyConfigured: false,
      },
      secrets: {
        ...secrets,
        copilot: {
          ...(secrets.copilot ?? {}),
          copilotAccessToken: accessToken,
        },
      },
    }
  }

  requireApiKey(secrets)
  return {
    session: {
      ...session,
      signedIn: true,
      connectionStatus: "connected" as const,
      apiKeyConfigured: true,
      lastError: undefined,
      lastSyncedAt: new Date().toISOString(),
    },
    secrets,
  }
}

export type { ChatMessage, ToolDefinition }
