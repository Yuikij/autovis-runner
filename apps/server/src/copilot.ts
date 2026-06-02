import type { GenerateScriptRequest, LlmSessionConfig, Project, TestCase, AgentStep } from "@autovis/shared"

const GITHUB_OAUTH_BASE = "https://github.com/login"
const GITHUB_API_BASE = "https://api.github.com"
const DEFAULT_GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98"

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface AccessTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
  error_uri?: string
}

interface CopilotTokenResponse {
  token: string
  expires_at: number
  refresh_in: number
  endpoints?: {
    api?: string
  }
}

export class CopilotSessionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = "CopilotSessionError"
    this.statusCode = statusCode
  }
}

export interface CopilotSecretState {
  githubAccessToken?: string
  copilotAccessToken?: string
  copilotTokenExpiresAt?: string
  deviceCode?: string
}

export interface AnalyzeImageWithCopilotInput {
  prompt: string
  mimeType: string
  dataUrl: string
  session: LlmSessionConfig
  secrets: CopilotSecretState
}

interface CopilotChatContentPartText {
  type: "text"
  text: string
}

interface CopilotChatContentPartImage {
  type: "image_url"
  image_url: {
    url: string
  }
}

export interface ScriptGenerationContext {
  request: GenerateScriptRequest
  project: Project
  testCase: TestCase
  session: LlmSessionConfig
  secrets: CopilotSecretState
}

const resolveClientId = () => process.env.GITHUB_COPILOT_CLIENT_ID || DEFAULT_GITHUB_COPILOT_CLIENT_ID

export const parseContent = async <T>(response: Response) => {
  const contentType = response.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    return (await response.json()) as T
  }

  return JSON.parse(await response.text()) as T
}

const extractErrorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") {
    return fallback
  }

  const record = payload as Record<string, unknown>
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message
  }

  const error = typeof record.error === "string" ? record.error : undefined
  const description = typeof record.error_description === "string" ? record.error_description : undefined
  if (error && description) {
    return `${error}: ${description}`
  }

  if (description) {
    return description
  }

  if (error) {
    return error
  }

  return fallback
}

const buildSessionPatch = (session: LlmSessionConfig, patch: Partial<LlmSessionConfig>): LlmSessionConfig => ({
  ...session,
  ...patch,
})

const buildSystemPrompt = () =>
  [
    "You are GitHub Copilot generating runnable Playwright TypeScript logic for a Chinese enterprise admin web application.",
    "Return only runnable TypeScript code.",
    "Do not import or declare test, human, ai, chromium, or browser fixtures.",
    "Assume page, expect, human, ai, and test are already available at runtime.",
    "Write only the body that runs inside an existing async Playwright context, although using await test.step(...) is allowed.",
    "Prefer robust role/label/text locators.",
    "Keep comments minimal.",
    "Do not wrap the answer in markdown fences unless necessary.",
    "The page is ALREADY navigated to the Project base URL. Do NOT call page.goto() with absolute URLs or declare baseUrl variables.",
    "When a flow requires captcha, OTP, or other human-only input, do not attempt to bypass it.",
    "For readable image text such as simple numeric captchas, use a retry loop (up to 3 times): analyze image -> fill -> click submit -> check success -> break if success, otherwise wait for a new captcha.",
    "If the captcha retry loop fails all attempts, or if image analysis is unsuitable, fall back to await human.input({ reason: 'captcha_failed', instruction: '...', imageSelector }).",
    "Do not assert framework root containers such as #root, #app, or similar shell nodes are visible, because they may exist while the page is still hidden or transitioning. Instead, wait for real user-facing form fields, buttons, text, or success-state elements.",
    "Prerequisite suites are already verified by the system; do not implement setup flows from preconditions.",
    "IMPORTANT: Do NOT declare const baseUrl or call page.goto(baseUrl). The runner has already navigated to the target URL.",
    "For captchas, remember to implement a retry loop (max 3 times) and fallback to await human.input(...) if all retries fail.",
    "Do not add brittle checks like await expect(page.locator('#root')).toBeVisible(). Prefer waiting for concrete login fields, captcha images, submit buttons, and post-login page signals.",
    "Generate runnable Playwright logic for the described admin UI without wrapping it in test(...) or importing @playwright/test.",
  ].join(" ")

const buildUserPrompt = ({ request, project, testCase }: ScriptGenerationContext) =>
  [
    `Project base URL: ${project.testBaseUrl || "/"}`,
    `Test case code: ${testCase.caseCode}`,
    `Module: ${testCase.moduleName}`,
    `Purpose: ${testCase.purpose}`,
    `Expected result: ${testCase.expectedResult}`,
    `Steps:\n${testCase.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    `Natural language instruction:\n${request.prompt}`
  ].join("\n\n")

const extractAssistantText = (payload: unknown): string => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Copilot response payload is empty")
  }

  const record = payload as Record<string, unknown>
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text
  }

  const choices = Array.isArray(record.choices) ? record.choices : []
  const firstChoice = choices[0] as Record<string, unknown> | undefined
  const message = firstChoice?.message as Record<string, unknown> | undefined
  const content = message?.content

  if (typeof content === "string" && content.trim()) {
    return content
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") {
          return part
        }
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
          return (part as Record<string, unknown>).text as string
        }
        return ""
      })
      .join("\n")
      .trim()

    if (joined) {
      return joined
    }
  }

  throw new Error("Unable to extract script content from Copilot response")
}

const extractCodeBlock = (text: string) => {
  const fencedMatch = text.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i)
  return (fencedMatch?.[1] ?? text).trim()
}

export const startCopilotDeviceFlow = async (session: LlmSessionConfig) => {
  const clientId = resolveClientId()
  const response = await fetch(`${GITHUB_OAUTH_BASE}/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: "read:user",
    }),
  })

  const payload = await parseContent<DeviceCodeResponse>(response)
  if (!response.ok) {
    throw new CopilotSessionError(extractErrorMessage(payload, "Failed to start GitHub device authorization flow"), 502)
  }

  return {
    session: buildSessionPatch(session, {
      connectionStatus: "authorizing",
      signedIn: false,
      loginMode: "device-flow",
      lastError: undefined,
      pendingDeviceAuth: {
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
        expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
        intervalSeconds: payload.interval,
      },
      lastSyncedAt: new Date().toISOString(),
    }),
    secrets: {
      deviceCode: payload.device_code,
    } satisfies CopilotSecretState,
  }
}

export const disconnectCopilotSession = (session: LlmSessionConfig) => ({
  session: buildSessionPatch(session, {
    signedIn: false,
    connectionStatus: "disconnected",
    lastError: undefined,
    pendingDeviceAuth: undefined,
    lastSyncedAt: new Date().toISOString(),
  }),
  secrets: {} satisfies CopilotSecretState,
})

const exchangeGitHubTokenForCopilotToken = async (githubAccessToken: string) => {
  const response = await fetch(`${GITHUB_API_BASE}/copilot_internal/v2/token`, {
    headers: {
      Accept: "application/json",
      Authorization: `token ${githubAccessToken}`,
      "User-Agent": "AutoVis/0.1",
    },
  })

  const payload = await parseContent<CopilotTokenResponse>(response)
  if (!response.ok || !payload.token) {
    throw new CopilotSessionError(
      extractErrorMessage(payload, "GitHub token is valid but Copilot session exchange failed. Confirm that the account has Copilot access."),
      response.status === 401 || response.status === 403 ? 401 : 502,
    )
  }

  return payload
}

export const fetchCopilotModels = async (session: LlmSessionConfig, secrets: CopilotSecretState) => {
  if (!secrets.githubAccessToken) {
    throw new CopilotSessionError("Copilot session is not connected", 400)
  }

  let accessToken = secrets.copilotAccessToken
  const expiresAt = secrets.copilotTokenExpiresAt ? new Date(secrets.copilotTokenExpiresAt).getTime() : 0
  if (!accessToken || (expiresAt && expiresAt <= Date.now() + 60_000)) {
    const refreshed = await exchangeGitHubTokenForCopilotToken(secrets.githubAccessToken)
    accessToken = refreshed.token
    secrets.copilotAccessToken = refreshed.token
    secrets.copilotTokenExpiresAt = new Date(refreshed.expires_at * 1000).toISOString()
    session.baseUrl = refreshed.endpoints?.api ?? session.baseUrl
  }

  const response = await fetch(`${session.baseUrl}/models`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "AutoVis/0.1",
      "editor-version": "vscode/1.99.0",
      "editor-plugin-version": "copilot-chat/0.26.0",
      "copilot-integration-id": "vscode-chat",
    },
  })

  const payload = await parseContent<any>(response)
  if (!response.ok) {
    throw new CopilotSessionError(
      extractErrorMessage(payload, `Failed to fetch Copilot models with status ${response.status}`),
      response.status === 401 || response.status === 403 ? 401 : 502,
    )
  }

  const modelsList = Array.isArray(payload.data) ? payload.data : []
  return modelsList
    .filter((m: any) => m.model_picker_enabled)
    .map((m: any) => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
    }))
}

export const pollCopilotDeviceFlow = async (session: LlmSessionConfig, secrets: CopilotSecretState) => {
  const clientId = resolveClientId()
  if (!secrets.deviceCode) {
    throw new CopilotSessionError("No pending GitHub device flow found", 400)
  }

  const response = await fetch(`${GITHUB_OAUTH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: secrets.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  })

  const payload = await parseContent<AccessTokenResponse>(response)
  if (!response.ok) {
    throw new CopilotSessionError(extractErrorMessage(payload, "Failed while polling GitHub device authorization flow"), 502)
  }

  if (payload.error === "authorization_pending" || payload.error === "slow_down") {
    return {
      session: buildSessionPatch(session, {
        connectionStatus: "authorizing",
        lastError: payload.error_description,
      }),
      secrets,
      completed: false,
    }
  }

  if (payload.error || !payload.access_token) {
    throw new CopilotSessionError(extractErrorMessage(payload, "GitHub device authorization failed"), 400)
  }

  const copilotToken = await exchangeGitHubTokenForCopilotToken(payload.access_token)
  return {
    session: buildSessionPatch(session, {
      signedIn: true,
      connectionStatus: "connected",
      loginMode: "device-flow",
      baseUrl: copilotToken.endpoints?.api ?? session.baseUrl,
      pendingDeviceAuth: undefined,
      lastError: undefined,
      lastSyncedAt: new Date().toISOString(),
    }),
    secrets: {
      githubAccessToken: payload.access_token,
      copilotAccessToken: copilotToken.token,
      copilotTokenExpiresAt: new Date(copilotToken.expires_at * 1000).toISOString(),
    } satisfies CopilotSecretState,
    completed: true,
  }
}

export const ensureCopilotToken = async (session: LlmSessionConfig, secrets: CopilotSecretState) => {
  if (!secrets.githubAccessToken) {
    throw new CopilotSessionError("Copilot session is not connected", 400)
  }

  let accessToken = secrets.copilotAccessToken
  const expiresAt = secrets.copilotTokenExpiresAt ? new Date(secrets.copilotTokenExpiresAt).getTime() : 0
  if (!accessToken || (expiresAt && expiresAt <= Date.now() + 60_000)) {
    const refreshed = await exchangeGitHubTokenForCopilotToken(secrets.githubAccessToken)
    accessToken = refreshed.token
    secrets.copilotAccessToken = refreshed.token
    secrets.copilotTokenExpiresAt = new Date(refreshed.expires_at * 1000).toISOString()
    session.baseUrl = refreshed.endpoints?.api ?? session.baseUrl
  }

  return accessToken
}

export const copilotHeaders = (accessToken: string) => ({
  Accept: "application/json",
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
  "User-Agent": "AutoVis/0.1",
  "editor-version": "vscode/1.99.0",
  "editor-plugin-version": "copilot-chat/0.26.0",
  "copilot-integration-id": "vscode-chat",
})

export const generateScriptWithCopilot = async (context: ScriptGenerationContext) => {
  const accessToken = await ensureCopilotToken(context.session, context.secrets)
  const url = `${context.session.baseUrl}/chat/completions`
  const headers = copilotHeaders(accessToken)
  const body = {
    model: context.session.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(context) },
    ],
  }

  try {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const curlCmd = `curl -X POST '${url}' \\\n` +
      Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}' \\\n`).join("") +
      `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`
    const outPath = path.join(process.cwd(), "last-llm-curl.sh")
    fs.writeFileSync(outPath, curlCmd)
    console.log(`[DEBUG] 完整的 LLM 请求 curl 命令已保存到: ${outPath}`)
  } catch (e) {
    console.warn("保存 curl 命令失败", e)
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const payload = await parseContent<unknown>(response)
  if (!response.ok) {
    throw new CopilotSessionError(
      extractErrorMessage(payload, `Copilot generation failed with status ${response.status}`),
      response.status === 401 || response.status === 403 ? 401 : 502,
    )
  }

  const text = extractAssistantText(payload)
  return extractCodeBlock(text)
}

export const analyzeImageWithCopilot = async ({ prompt, mimeType, dataUrl, session, secrets }: AnalyzeImageWithCopilotInput) => {
  const accessToken = await ensureCopilotToken(session, secrets)
  const url = `${session.baseUrl}/chat/completions`
  const headers = copilotHeaders(accessToken)
  const body = {
    model: session.model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt } satisfies CopilotChatContentPartText,
          { type: "image_url", image_url: { url: dataUrl } } satisfies CopilotChatContentPartImage,
        ],
      },
    ],
  }

  try {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const curlCmd = `curl -X POST '${url}' \\\n` +
      Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}' \\\n`).join("") +
      `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`
    const outPath = path.join(process.cwd(), "last-llm-curl.sh")
    fs.writeFileSync(outPath, curlCmd)
    console.log(`[DEBUG] 完整的 LLM 请求 curl 命令已保存到: ${outPath}`)
  } catch (e) {
    console.warn("保存 curl 命令失败", e)
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const payload = await parseContent<unknown>(response)
  if (!response.ok) {
    throw new CopilotSessionError(
      extractErrorMessage(payload, `Copilot image analysis failed with status ${response.status}`),
      response.status === 401 || response.status === 403 ? 401 : 502,
    )
  }

  const text = extractAssistantText(payload).trim()
  if (!text) {
    throw new CopilotSessionError("Copilot image analysis returned empty content", 502)
  }

  return {
    mimeType,
    text,
  }
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

export interface CopilotToolCallResult {
  finishReason: "stop" | "tool_calls" | "length" | string
  content: string | null
  toolCalls: Array<{
    id: string
    name: string
    arguments: string
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export const callCopilotWithTools = async (
  session: LlmSessionConfig,
  secrets: CopilotSecretState,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<CopilotToolCallResult> => {
  const accessToken = await ensureCopilotToken(session, secrets)

  const body: Record<string, unknown> = {
    model: session.model,
    temperature: 0.1,
    messages,
  }

  if (tools.length > 0) {
    body.tools = tools
    body.tool_choice = "auto"
  }

  const url = `${session.baseUrl}/chat/completions`
  const headers = copilotHeaders(accessToken)

  try {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const curlCmd = `curl -X POST '${url}' \\\n` +
      Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}' \\\n`).join("") +
      `  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`
    const outPath = path.join(process.cwd(), "last-llm-curl.sh")
    fs.writeFileSync(outPath, curlCmd)
    console.log(`[DEBUG] 完整的 LLM 请求 curl 命令已保存到: ${outPath}`)
  } catch (e) {
    console.warn("保存 curl 命令失败", e)
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  const payload = await parseContent<Record<string, unknown>>(response)
  if (!response.ok) {
    throw new CopilotSessionError(
      extractErrorMessage(payload, `Copilot agent call failed with status ${response.status}`),
      response.status === 401 || response.status === 403 ? 401 : 502,
    )
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const firstChoice = (choices[0] ?? {}) as Record<string, unknown>
  const finishReason = (firstChoice.finish_reason as string) ?? "stop"
  const message = (firstChoice.message ?? {}) as Record<string, unknown>
  const content = typeof message.content === "string" ? message.content : null

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const toolCalls = rawToolCalls.map((tc: Record<string, unknown>) => {
    const fn = (tc.function ?? {}) as Record<string, unknown>
    return {
      id: String(tc.id ?? ""),
      name: String(fn.name ?? ""),
      arguments: String(fn.arguments ?? "{}"),
    }
  })

  const rawUsage = payload.usage as Record<string, unknown> | undefined
  const usage = rawUsage
    ? {
        promptTokens: Number(rawUsage.prompt_tokens ?? 0),
        completionTokens: Number(rawUsage.completion_tokens ?? 0),
        totalTokens: Number(rawUsage.total_tokens ?? 0),
      }
    : undefined

  return { finishReason, content, toolCalls, usage }
}

export { extractCodeBlock }
