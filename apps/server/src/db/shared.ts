import type { Identifier, LlmSessionConfig, LlmState, PersistedTaskControlCommand, TaskControlAction, TaskControlCommandStatus, TaskKind } from "@autovis/shared"
import type { LegacyProjectState, PersistedState } from "./types.js"
import type { CopilotSecretState } from "../copilot.js"

export type { PersistedTaskControlCommand, TaskControlCommandStatus } from "@autovis/shared"

export const now = () => new Date().toISOString()

export const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export interface LlmSecretState {
  apiKey?: string
  copilot?: CopilotSecretState
}

export interface PersistedLlmConfig {
  session: LlmSessionConfig
  secrets: LlmSecretState
}

export interface PersistedLlmState {
  activeConfigId?: Identifier
  activeVisionConfigId?: Identifier
  configs: PersistedLlmConfig[]
}

export const buildDefaultSession = (): LlmSessionConfig => ({
  id: "llm_cfg_copilot_default",
  name: "GitHub Copilot",
  provider: "copilot-proxy",
  proxyEndpoint: "/api/llm/copilot/device/start",
  model: process.env.GITHUB_COPILOT_MODEL ?? "gpt-4o",
  signedIn: false,
  connectionStatus: "disconnected",
  baseUrl: process.env.GITHUB_COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
  loginMode: "device-flow",
  apiKeyConfigured: false,
  featureFlags: {
    realSessionPrototype: true,
    realScriptGeneration: true,
  },
})

export const buildDefaultLlmState = (): PersistedLlmState => ({
  activeConfigId: buildDefaultSession().id,
  configs: [{ session: buildDefaultSession(), secrets: {} }],
})

export const sanitizeSessionConfig = (session: LlmSessionConfig, secrets: LlmSecretState): LlmSessionConfig => ({
  ...session,
  apiKeyConfigured: Boolean(secrets.apiKey),
})

export const toPublicLlmState = (state: PersistedLlmState): LlmState => {
  const configs = state.configs.map((item) => sanitizeSessionConfig(item.session, item.secrets))
  const session = configs.find((item) => item.id === state.activeConfigId) ?? configs[0] ?? sanitizeSessionConfig(buildDefaultSession(), {})
  const visionSession = configs.find((item) => item.id === state.activeVisionConfigId)
  return {
    activeConfigId: session.id,
    activeVisionConfigId: state.activeVisionConfigId,
    configs,
    session,
    visionSession,
  }
}

export const normalizePersistedLlmState = (state: PersistedLlmState): PersistedLlmState => {
  const fallback = buildDefaultLlmState()
  const configs = state.configs.length > 0 ? state.configs : fallback.configs
  const activeConfigId = configs.some((item) => item.session.id === state.activeConfigId)
    ? state.activeConfigId
    : configs[0]?.session.id

  return {
    activeConfigId,
    activeVisionConfigId: state.activeVisionConfigId,
    configs: configs.map((item) => ({
      session: {
        ...item.session,
        apiKeyConfigured: Boolean(item.secrets.apiKey),
      },
      secrets: item.secrets ?? {},
    })),
  }
}

export const buildLegacyLlmState = (session: LlmSessionConfig, secrets: CopilotSecretState): PersistedLlmState =>
  normalizePersistedLlmState({
    activeConfigId: session.id,
    configs: [
      {
        session,
        secrets: {
          copilot: secrets,
        },
      },
    ],
  })
