import type { FastifyRequest } from "fastify"

import { log } from "./log.js"

type ObservabilityState = {
  browserStartFailures: Map<string, number>
  llmFailures: Map<string, number>
  relayDisconnects: number
  relayReconnects: number
  relayConnected: number
  relayHeartbeatFailures: number
  sseActiveStreams: Map<string, number>
  sseReconnects: Map<string, number>
  sseErrors: Map<string, number>
  recentSseClosures: Map<string, number>
}

type PartialObservabilityState = Partial<ObservabilityState>

const OBSERVABILITY_KEY = "__autovisObservabilityState__"
const SSE_RECONNECT_WINDOW_MS = 30_000

const getState = (): ObservabilityState => {
  const globalState = globalThis as typeof globalThis & {
    [OBSERVABILITY_KEY]?: PartialObservabilityState
  }

  const state = globalState[OBSERVABILITY_KEY] ?? {}
  state.browserStartFailures ??= new Map<string, number>()
  state.llmFailures ??= new Map<string, number>()
  state.relayDisconnects ??= 0
  state.relayReconnects ??= 0
  state.relayConnected ??= 0
  state.relayHeartbeatFailures ??= 0
  state.sseActiveStreams ??= new Map<string, number>()
  state.sseReconnects ??= new Map<string, number>()
  state.sseErrors ??= new Map<string, number>()
  state.recentSseClosures ??= new Map<string, number>()
  globalState[OBSERVABILITY_KEY] = state
  return state as ObservabilityState
}

const incrementMap = (map: Map<string, number>, key: string, amount = 1) => {
  map.set(key, (map.get(key) ?? 0) + amount)
}

const addGauge = (map: Map<string, number>, key: string, amount: number) => {
  map.set(key, Math.max(0, (map.get(key) ?? 0) + amount))
}

const splitMapKey = (key: string) => {
  const [first = "unknown", second = "unknown"] = key.split("|", 2)
  return { first, second }
}

const escapeLabelValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')

const renderLabels = (labels: Record<string, string>) => {
  const entries = Object.entries(labels).filter(([, value]) => value.length > 0)
  if (entries.length === 0) {
    return ""
  }

  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(",")}}`
}

const renderMapSamples = (name: string, map: Map<string, number>, toLabels: (key: string) => Record<string, string>) =>
  [...map.entries()].map(([key, value]) => `${name}${renderLabels(toLabels(key))} ${value}`)

const resolveRemoteAddress = (request: FastifyRequest) => {
  const forwarded = request.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown"
  }
  return request.ip || request.socket.remoteAddress || "unknown"
}

const buildSseClientKey = (streamName: string, request: FastifyRequest) => `${streamName}|${resolveRemoteAddress(request)}`

export const recordBrowserStartFailure = (surface: string, error: unknown, fields?: Record<string, unknown>) => {
  incrementMap(getState().browserStartFailures, surface)
  log.warn("browser.start_failed", { surface, error, ...fields })
}

export const recordLlmFailure = (
  provider: string,
  operation: string,
  error: unknown,
  fields?: Record<string, unknown>,
) => {
  incrementMap(getState().llmFailures, `${provider}|${operation}`)
  log.warn("llm.request_failed", { provider, operation, error, ...fields })
}

export const recordRelayConnected = (input: { deviceId: string; cloudUrl: string; reconnected: boolean }) => {
  const state = getState()
  state.relayConnected = 1
  if (input.reconnected) {
    state.relayReconnects += 1
  }
  log.info(input.reconnected ? "relay.reconnected" : "relay.connected", input)
}

export const recordRelayDisconnected = (input: {
  deviceId: string
  cloudUrl: string
  source: "close" | "error"
  code?: number
  reason?: string
}) => {
  const state = getState()
  state.relayConnected = 0
  state.relayDisconnects += 1
  log.warn("relay.disconnected", input)
}

export const recordRelayHeartbeatFailure = (input: {
  deviceId: string
  cloudUrl: string
  statusCode?: number
  message: string
}) => {
  const state = getState()
  state.relayHeartbeatFailures += 1
  log.warn("relay.heartbeat_failed", input)
}

export const recordSseStreamOpened = (streamName: string, request: FastifyRequest) => {
  const state = getState()
  const clientKey = buildSseClientKey(streamName, request)
  addGauge(state.sseActiveStreams, streamName, 1)

  const lastClosedAt = state.recentSseClosures.get(clientKey)
  if (lastClosedAt && Date.now() - lastClosedAt <= SSE_RECONNECT_WINDOW_MS) {
    incrementMap(state.sseReconnects, streamName)
  }
}

export const recordSseStreamClosed = (streamName: string, request: FastifyRequest, failed: boolean) => {
  const state = getState()
  addGauge(state.sseActiveStreams, streamName, -1)
  state.recentSseClosures.set(buildSseClientKey(streamName, request), Date.now())
  if (failed) {
    incrementMap(state.sseErrors, streamName)
  }
}

export const renderObservabilityMetrics = () => {
  const state = getState()
  const lines = [
    "# HELP autovis_browser_start_failures_total Browser start failures grouped by launch surface.",
    "# TYPE autovis_browser_start_failures_total counter",
    ...renderMapSamples("autovis_browser_start_failures_total", state.browserStartFailures, (surface) => ({ surface })),
    "# HELP autovis_llm_failures_total LLM request failures grouped by provider and operation.",
    "# TYPE autovis_llm_failures_total counter",
    ...renderMapSamples("autovis_llm_failures_total", state.llmFailures, (key) => {
      const { first, second } = splitMapKey(key)
      return { provider: first, operation: second }
    }),
    "# HELP autovis_relay_disconnects_total Relay disconnect count.",
    "# TYPE autovis_relay_disconnects_total counter",
    `autovis_relay_disconnects_total ${state.relayDisconnects}`,
    "# HELP autovis_relay_reconnects_total Relay reconnect count after the first successful connection.",
    "# TYPE autovis_relay_reconnects_total counter",
    `autovis_relay_reconnects_total ${state.relayReconnects}`,
    "# HELP autovis_relay_connected Relay connection state.",
    "# TYPE autovis_relay_connected gauge",
    `autovis_relay_connected ${state.relayConnected}`,
    "# HELP autovis_relay_heartbeat_failures_total Relay heartbeat failures.",
    "# TYPE autovis_relay_heartbeat_failures_total counter",
    `autovis_relay_heartbeat_failures_total ${state.relayHeartbeatFailures}`,
    "# HELP autovis_sse_active_streams Active SSE stream count grouped by stream.",
    "# TYPE autovis_sse_active_streams gauge",
    ...renderMapSamples("autovis_sse_active_streams", state.sseActiveStreams, (stream) => ({ stream })),
    "# HELP autovis_sse_reconnects_total Estimated SSE reconnect count grouped by stream.",
    "# TYPE autovis_sse_reconnects_total counter",
    ...renderMapSamples("autovis_sse_reconnects_total", state.sseReconnects, (stream) => ({ stream })),
    "# HELP autovis_sse_errors_total SSE stream error count grouped by stream.",
    "# TYPE autovis_sse_errors_total counter",
    ...renderMapSamples("autovis_sse_errors_total", state.sseErrors, (stream) => ({ stream })),
  ]

  return lines.join("\n")
}