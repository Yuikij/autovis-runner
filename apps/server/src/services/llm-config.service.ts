import { AutoVisDatabase } from "../db.js"
import { createId, now } from "./common.js"
import { CopilotSessionError, type CopilotSecretState } from "../copilot.js"
import {
  disconnectLlmSession,
  fetchModelsForConfig,
  pollCopilotDeviceFlowForConfig,
  startCopilotDeviceFlowForConfig,
  type LlmSecretState,
} from "../llm.js"
import { type UpsertLlmConfigRequest, type LlmSessionConfig, type LlmState } from "@autovis/shared"

export class LlmConfigService {
  constructor(private readonly db: AutoVisDatabase) {}

  public applyCopilotSessionError(
    state: {
      session: LlmSessionConfig
      secrets: CopilotSecretState
    },
    message: string,
    options?: {
      clearPending?: boolean
      disconnect?: boolean
      clearSecrets?: boolean
    },
  ) {
    state.session = {
      ...state.session,
      signedIn: options?.disconnect ? false : state.session.signedIn,
      connectionStatus: options?.disconnect ? "disconnected" : "error",
      pendingDeviceAuth: options?.clearPending ? undefined : state.session.pendingDeviceAuth,
      lastError: message,
      lastSyncedAt: now(),
    }

    if (options?.clearSecrets) {
      state.secrets = {}
    }
  }

  public getLlmConfigState() {
    return this.db.getLlmConfigState()
  }

  public saveLlmConfigState(state: ReturnType<AutoVisDatabase["getLlmConfigState"]>) {
    this.db.saveLlmConfigState(state)
  }

  public getActiveLlmConfigBundle(configId?: string) {
    const state = this.getLlmConfigState()
    const targetId = configId ?? state.activeConfigId ?? state.configs[0]?.session.id
    const current = state.configs.find((item) => item.session.id === targetId)
    if (!current) {
      throw new Error("未找到指定的 AI 配置。")
    }
    return { state, current }
  }

  public getActiveVisionLlmConfigBundle(configId?: string) {
    if (configId) {
      return this.getActiveLlmConfigBundle(configId)
    }
    const state = this.getLlmConfigState()
    const activeVisionId = state.activeVisionConfigId
    if (activeVisionId) {
      const current = state.configs.find((item) => item.session.id === activeVisionId)
      if (current && (current.session.connectionStatus === "connected" || current.secrets.apiKey)) {
        return { state, current }
      }
    }
    return this.getActiveLlmConfigBundle()
  }

  private createLlmConfigFromInput(input: UpsertLlmConfigRequest, current?: LlmSessionConfig): { session: LlmSessionConfig; secrets: LlmSecretState } {
    const nowTime = now()
    const provider = input.provider
    const isCopilot = provider === "copilot-proxy"
    const baseDefaults =
      current ??
      (isCopilot
        ? {
            id: input.id ?? createId("llm"),
            name: "GitHub Copilot",
            provider,
            proxyEndpoint: "/api/llm/copilot/device/start",
            model: process.env.GITHUB_COPILOT_MODEL ?? "gpt-4o",
            signedIn: false,
            connectionStatus: "disconnected" as const,
            baseUrl: process.env.GITHUB_COPILOT_BASE_URL ?? "https://api.githubcopilot.com",
            loginMode: "device-flow" as const,
            featureFlags: {
              realSessionPrototype: true,
              realScriptGeneration: true,
            },
          }
        : {
            id: input.id ?? createId("llm"),
            name: "",
            provider,
            proxyEndpoint: "",
            model: "",
            signedIn: false,
            connectionStatus: "disconnected" as const,
            baseUrl: "",
            loginMode: "manual-token" as const,
            featureFlags: {
              realSessionPrototype: true,
              realScriptGeneration: true,
            },
          })

    const session: LlmSessionConfig = {
      ...baseDefaults,
      id: current?.id ?? input.id ?? baseDefaults.id,
      name: input.name.trim(),
      provider,
      proxyEndpoint: isCopilot ? "/api/llm/copilot/device/start" : "",
      model: input.model.trim(),
      baseUrl: input.baseUrl.trim(),
      loginMode: isCopilot ? "device-flow" : "manual-token",
      apiKeyConfigured: provider === "copilot-proxy" ? false : Boolean(input.apiKey?.trim()),
      lastSyncedAt: nowTime,
      lastError: undefined,
      pendingDeviceAuth: provider === "copilot-proxy" ? current?.pendingDeviceAuth : undefined,
      signedIn: provider === "copilot-proxy" ? current?.signedIn ?? false : Boolean(input.apiKey?.trim()),
      connectionStatus:
        provider === "copilot-proxy"
          ? current?.connectionStatus ?? "disconnected"
          : input.apiKey?.trim()
          ? "connected"
          : "disconnected",
    }

    const secrets: LlmSecretState = provider === "copilot-proxy"
      ? { copilot: undefined }
      : { apiKey: input.apiKey?.trim() || undefined }

    return { session, secrets }
  }

  public async testLlmConfig(input: UpsertLlmConfigRequest) {
    const state = this.getLlmConfigState()
    const existing = input.id ? state.configs.find((item) => item.session.id === input.id) : undefined
    const { session, secrets } = this.createLlmConfigFromInput(input)
    if (session.provider === "copilot-proxy") {
      throw new Error("Copilot 暂不支持在线表单连通性测试。")
    }
    if (existing && !secrets.apiKey) {
      secrets.apiKey = existing.secrets.apiKey
    }
    const models = await fetchModelsForConfig(session, secrets)
    return models
  }

  public async getLlmSession() {
    return (await this.getLlmState()).session
  }

  public async getLlmState(): Promise<LlmState> {
    const state = this.getLlmConfigState()
    const active = state.configs.find((item) => item.session.id === state.activeConfigId) ?? state.configs[0]

    if (!active) {
      throw new Error("AI 配置为空。")
    }

    if (active.session.provider !== "copilot-proxy" && active.secrets.apiKey) {
      active.session.signedIn = true
      active.session.connectionStatus = "connected"
      active.session.apiKeyConfigured = true
    }

    this.saveLlmConfigState(state)

    return {
      activeConfigId: active.session.id,
      activeVisionConfigId: state.activeVisionConfigId,
      configs: state.configs.map((item) => item.session),
      session: active.session,
      visionSession: state.activeVisionConfigId ? state.configs.find((item) => item.session.id === state.activeVisionConfigId)?.session : undefined,
    }
  }

  public async saveLlmConfig(input: UpsertLlmConfigRequest) {
    const state = this.getLlmConfigState()
    const existing = input.id ? state.configs.find((item) => item.session.id === input.id) : undefined
    const next = this.createLlmConfigFromInput(input, existing?.session)

    if (existing) {
      existing.session = {
        ...existing.session,
        ...next.session,
        apiKeyConfigured: input.provider === "copilot-proxy" ? false : Boolean(input.apiKey?.trim() || existing.secrets.apiKey),
        signedIn: input.provider === "copilot-proxy" ? existing.session.signedIn : Boolean(input.apiKey?.trim() || existing.secrets.apiKey),
        connectionStatus: input.provider === "copilot-proxy" ? existing.session.connectionStatus : (input.apiKey?.trim() || existing.secrets.apiKey) ? "connected" : "disconnected",
      }
      existing.secrets = input.provider === "copilot-proxy"
        ? { ...existing.secrets, apiKey: undefined }
        : { ...existing.secrets, apiKey: input.apiKey?.trim() || existing.secrets.apiKey }
    } else {
      state.configs.push({ session: next.session, secrets: next.secrets })
      if (!state.activeConfigId) {
        state.activeConfigId = next.session.id
      }
    }

    this.saveLlmConfigState(state)
    return await this.getLlmState()
  }

  public async activateLlmConfig(configId: string) {
    const state = this.getLlmConfigState()
    if (!state.configs.some((item) => item.session.id === configId)) {
      throw new Error("未找到要启用的 AI 配置。")
    }
    state.activeConfigId = configId
    this.saveLlmConfigState(state)
    return await this.getLlmState()
  }

  public async activateVisionConfig(configId: string | null) {
    const state = this.getLlmConfigState()
    if (configId !== null && !state.configs.some((item) => item.session.id === configId)) {
      throw new Error("未找到要启用的 AI 配置。")
    }
    state.activeVisionConfigId = configId ?? undefined
    this.saveLlmConfigState(state)
    return await this.getLlmState()
  }

  public async deleteLlmConfig(configId: string) {
    const state = this.getLlmConfigState()
    if (state.configs.length <= 1) {
      throw new Error("至少需要保留一个 AI 配置。")
    }
    state.configs = state.configs.filter((item) => item.session.id !== configId)
    if (!state.configs.some((item) => item.session.id === state.activeConfigId)) {
      state.activeConfigId = state.configs[0]?.session.id
    }
    if (state.activeVisionConfigId === configId) {
      state.activeVisionConfigId = undefined
    }
    this.saveLlmConfigState(state)
    return await this.getLlmState()
  }

  public async startCopilotDeviceSession(request: { model?: string; configId?: string }) {
    const { state, current } = this.getActiveLlmConfigBundle(request.configId)
    if (current.session.provider !== "copilot-proxy") {
      throw new Error("当前启用的配置不是 Copilot。")
    }
    if (request.model) {
      current.session.model = request.model
    }

    try {
      const next = await startCopilotDeviceFlowForConfig(current.session)
      current.session = next.session
      current.secrets = { ...current.secrets, copilot: next.secrets }
      this.saveLlmConfigState(state)
      return next.session
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start Copilot device flow"
      const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
      this.applyCopilotSessionError(bundle, message, { clearPending: true })
      current.session = bundle.session
      current.secrets = { ...current.secrets, copilot: bundle.secrets }
      this.saveLlmConfigState(state)
      throw error
    }
  }

  public async pollCopilotDeviceSession(request: { model?: string; configId?: string }) {
    const { state, current } = this.getActiveLlmConfigBundle(request.configId)
    if (current.session.provider !== "copilot-proxy") {
      throw new Error("当前启用的配置不是 Copilot。")
    }
    if (request.model) {
      current.session.model = request.model
    }

    const expiresAt = current.session.pendingDeviceAuth?.expiresAt ? new Date(current.session.pendingDeviceAuth.expiresAt).getTime() : 0
    if (expiresAt && expiresAt <= Date.now()) {
      const error = new CopilotSessionError("当前设备码已过期，请重新开始登录。", 400)
      const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
      this.applyCopilotSessionError(bundle, error.message, {
        clearPending: true,
        disconnect: true,
        clearSecrets: true,
      })
      current.session = bundle.session
      current.secrets = { ...current.secrets, copilot: bundle.secrets }
      this.saveLlmConfigState(state)
      throw error
    }

    try {
      const next = await pollCopilotDeviceFlowForConfig(current.session, current.secrets.copilot ?? {})
      current.session = next.session
      current.secrets = { ...current.secrets, copilot: next.secrets }
      this.saveLlmConfigState(state)
      return next.session
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete Copilot device flow"
      const shouldResetDeviceFlow = error instanceof CopilotSessionError && error.statusCode < 500
      const bundle = { session: current.session, secrets: current.secrets.copilot ?? {} }
      this.applyCopilotSessionError(bundle, message, {
        clearPending: shouldResetDeviceFlow,
        disconnect: shouldResetDeviceFlow,
        clearSecrets: shouldResetDeviceFlow,
      })
      current.session = bundle.session
      current.secrets = { ...current.secrets, copilot: bundle.secrets }
      this.saveLlmConfigState(state)
      throw error
    }
  }

  public async fetchLlmModels(configId?: string) {
    const { state, current } = this.getActiveLlmConfigBundle(configId)
    const result = await fetchModelsForConfig(current.session, current.secrets)
    current.session.lastSyncedAt = now()
    current.session.lastError = undefined
    this.saveLlmConfigState(state)
    return result
  }

  public async updateLlmModel(model: string, configId?: string) {
    const { state, current } = this.getActiveLlmConfigBundle(configId)
    current.session.model = model
    current.session.lastSyncedAt = now()
    this.saveLlmConfigState(state)
    return current.session
  }

  public async disconnectCopilotSession(configId?: string) {
    const { state, current } = this.getActiveLlmConfigBundle(configId)
    const next = disconnectLlmSession(current.session)
    current.session = next.session
    current.secrets = next.secrets
    this.saveLlmConfigState(state)
    return next.session
  }
}
