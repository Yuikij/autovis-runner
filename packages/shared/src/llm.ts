import type { Identifier } from "./core"

export type LlmProviderKind =
  | "copilot-proxy"
  | "openai-compatible"
  | "anthropic-compatible"
  | "manual-recorder"
  | "manual-editor"
export type LlmConnectionStatus = "disconnected" | "authorizing" | "connected" | "error"

export interface LlmSessionConfig {
  id: Identifier
  name: string
  provider: LlmProviderKind
  proxyEndpoint: string
  model: string
  signedIn: boolean
  connectionStatus: LlmConnectionStatus
  baseUrl: string
  loginMode: "device-flow" | "manual-token"
  apiKeyConfigured?: boolean
  lastSyncedAt?: string
  lastError?: string
  pendingDeviceAuth?: {
    userCode: string
    verificationUri: string
    expiresAt: string
    intervalSeconds: number
  }
  featureFlags: {
    realSessionPrototype: boolean
    realScriptGeneration: boolean
  }
}

export interface LlmState {
  activeConfigId?: Identifier
  activeVisionConfigId?: Identifier
  configs: LlmSessionConfig[]
  session: LlmSessionConfig
  visionSession?: LlmSessionConfig
}