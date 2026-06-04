import type { LlmSessionConfig } from "@autovis/shared"
import type { ChatMessage, CopilotToolCallResult, ToolDefinition } from "../copilot.js"
import { log } from "../log.js"
import type { LlmSecretState } from "./types.js"

const OPENAI_USER_AGENT = "AutoVis/0.1"
const ANTHROPIC_VERSION = "2023-06-01"

export const requireApiKey = (secrets: LlmSecretState) => {
  if (!secrets.apiKey?.trim()) {
    throw new Error("当前 API 配置未填写 API Key。")
  }
  return secrets.apiKey.trim()
}

export const withPath = (baseUrl: string, path: string) => {
  const normalized = baseUrl.replace(/\/+$/, "")
  if (normalized.endsWith(`/${path}`)) return normalized
  return `${normalized}/${path}`
}

export const openAiHeaders = (apiKey: string) => ({
  Accept: "application/json",
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "User-Agent": OPENAI_USER_AGENT,
})

export const anthropicHeaders = (apiKey: string) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent": OPENAI_USER_AGENT,
  "x-api-key": apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
})

export const parseResponse = async (response: Response) => {
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

export const parseErrorMessage = (payload: any, fallback: string) => {
  if (typeof payload?.error?.message === "string") return payload.error.message
  if (typeof payload?.message === "string") return payload.message
  if (typeof payload?.error === "string") return payload.error
  return fallback
}

export const extractText = (payload: any): string => {
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
  if (anthropicText) return anthropicText

  throw new Error("LLM 返回内容为空。")
}

export const extractCodeBlock = (text: string) => {
  const fencedMatch = text.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/i)
  return (fencedMatch?.[1] ?? text).trim()
}

export const buildAnthropicMessages = (messages: ChatMessage[]) => {
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

      return { role: item.role, content: item.content ?? "" }
    })

  return { system, conversation }
}

export const callOpenAiCompatible = async (
  session: LlmSessionConfig,
  secrets: LlmSecretState,
  body: Record<string, unknown>,
) => {
  const url = withPath(session.baseUrl, "chat/completions")
  const headers = openAiHeaders(requireApiKey(secrets))

  log.debug("llm.openai_compatible.request", {
    provider: session.provider,
    url,
    model: body.model,
    messageCount: Array.isArray(body.messages) ? body.messages.length : undefined,
    bodyBytes: JSON.stringify(body).length,
  })

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, `调用 OpenAI 兼容接口失败: ${response.status}`))
  }
  return payload
}

export const callAnthropicCompatible = async (
  session: LlmSessionConfig,
  secrets: LlmSecretState,
  body: Record<string, unknown>,
) => {
  const url = withPath(session.baseUrl, "messages")
  const headers = anthropicHeaders(requireApiKey(secrets))

  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })
  const payload = await parseResponse(response)
  if (!response.ok) {
    throw new Error(parseErrorMessage(payload, `调用 Anthropic 兼容接口失败: ${response.status}`))
  }
  return payload
}

export const callOpenAiWithTools = async (
  session: LlmSessionConfig,
  secrets: LlmSecretState,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<CopilotToolCallResult> => {
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

export const callAnthropicWithTools = async (
  session: LlmSessionConfig,
  secrets: LlmSecretState,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<CopilotToolCallResult> => {
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
