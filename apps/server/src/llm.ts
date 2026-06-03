import type { LlmSessionConfig } from "@autovis/shared"
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
import {
  buildScriptSystemPrompt,
  buildScriptUserPrompt,
  buildValidationScriptSystemPrompt,
  buildValidationScriptUserPromptV2,
  type ValidationScriptDualContext,
} from "./llm/prompts.js"
import {
  anthropicHeaders,
  callAnthropicCompatible,
  callAnthropicWithTools,
  callOpenAiCompatible,
  callOpenAiWithTools,
  extractCodeBlock,
  extractText,
  openAiHeaders,
  parseErrorMessage,
  parseResponse,
  requireApiKey,
  withPath,
} from "./llm/providers.js"
import { type LlmSecretState } from "./llm/types.js"

export type { LlmSecretState }

export type { ValidationScriptDualContext }

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

  if (session.provider === "anthropic-compatible") {
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

  throw new Error(`不支持的 LLM provider: ${session.provider}`)
}

export const generateScriptWithLlm = async (context: ScriptGenerationContext & { secrets: LlmSecretState }) => {
  if (context.session.provider === "copilot-proxy") {
    return generateScriptWithCopilot({ ...context, secrets: context.secrets.copilot ?? {} })
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

  if (context.session.provider === "anthropic-compatible") {
    const payload = await callAnthropicCompatible(context.session, context.secrets, {
      model: context.session.model,
      max_tokens: 4000,
      temperature: 0.1,
      system: buildScriptSystemPrompt(),
      messages: [{ role: "user", content: buildScriptUserPrompt(context) }],
    })
    return extractCodeBlock(extractText(payload))
  }

  throw new Error(`不支持的 LLM provider: ${context.session.provider}`)
}

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
    const text =
      typeof payload === "object" && payload !== null
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

  if (context.session.provider === "anthropic-compatible") {
    const payload = await callAnthropicCompatible(context.session, context.secrets, {
      model: context.session.model,
      max_tokens: 2000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })
    return extractCodeBlock(extractText(payload))
  }

  throw new Error(`不支持的 LLM provider: ${context.session.provider}`)
}

export const analyzeImageWithLlm = async (
  input: Omit<AnalyzeImageWithCopilotInput, "secrets"> & { session: LlmSessionConfig; secrets: LlmSecretState },
) => {
  if (input.session.provider === "copilot-proxy") {
    return analyzeImageWithCopilot({ ...input, secrets: input.secrets.copilot ?? {} })
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

  if (input.session.provider === "anthropic-compatible") {
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
              source: { type: "base64", media_type: input.mimeType, data: base64Data },
            },
          ],
        },
      ],
    })
    return { mimeType: input.mimeType, text: extractText(payload) }
  }

  throw new Error(`不支持的 LLM provider: ${input.session.provider}`)
}

export const generateTextWithLlm = async (input: {
  prompt: string
  systemPrompt?: string
  session: LlmSessionConfig
  secrets: LlmSecretState
}) => {
  const messages: ChatMessage[] = []
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt })
  }
  messages.push({ role: "user", content: input.prompt })

  const result = await callLlmWithTools(input.session, input.secrets, messages, [])
  return result.content || ""
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
    return callOpenAiWithTools(session, secrets, messages, tools)
  }

  if (session.provider === "anthropic-compatible") {
    return callAnthropicWithTools(session, secrets, messages, tools)
  }

  throw new Error(`不支持的 LLM provider: ${session.provider}`)
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
