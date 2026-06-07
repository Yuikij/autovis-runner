import { createHash } from "node:crypto"

import { log } from "./log.js"
import { recordRelayConnected, recordRelayDisconnected, recordRelayHeartbeatFailure } from "./observability.js"

type CloudClientOptions = {
  cloudUrl: string
  deviceToken: string
  localOrigin: string
  name?: string
  runnerVersion?: string
}

type TunnelRequest = {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

type TunnelEnvelope =
  | { type: "request"; id: string; request: TunnelRequest }
  | { type: "ws-open"; id: string; path: string }
  | { type: "ws-message"; id: string; data?: string; binary?: boolean }
  | { type: "ws-close"; id: string }

const HEARTBEAT_INTERVAL_MS = 20_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000
// 应用层心跳：周期向中继发送 ping（中继用 setWebSocketAutoResponse 自动回 pong），
// 既能保活穿越 Cloudflare 边缘/NAT 的长连接，又能在超时未收到任何回应时尽快判死并重连，
// 避免半死连接长时间表现为 503。
const PING_INTERVAL_MS = 25_000
const PING_TIMEOUT_MS = 75_000
const PING_MESSAGE = JSON.stringify({ type: "ping" })
const PONG_MESSAGE = JSON.stringify({ type: "pong" })
// 文本响应单帧上限（字符数）。超过则改走分块流式回传，防止触发中继 2MB envelope 上限被判 1003 而整条连接被关。
const SAFE_TEXT_FRAME_CHARS = 1_500_000
// 二进制产物（如录制 webm）分块回传：单帧远低于 Cloudflare 32MiB 收帧上限与中继的 envelope 校验上限，
// 避免大文件被中继判定为超大帧而整条 agent 连接被关闭（导致视频等大产物在远程模式下完全无法访问）。
const RESPONSE_CHUNK_BYTES = 512 * 1024
const TEXT_CONTENT_TYPES = [
  "application/json",
  "application/javascript",
  "application/xml",
  "text/",
]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const trimSlash = (value: string) => value.replace(/\/+$/, "")
const isTextResponse = (contentType: string) =>
  TEXT_CONTENT_TYPES.some((item) => contentType.toLowerCase().includes(item))

const toWebSocketUrl = (cloudUrl: string, deviceToken: string) => {
  const url = new URL("/api/cloud/devices/connect", trimSlash(cloudUrl))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("token", deviceToken)
  return url.toString()
}

const toLocalHttpUrl = (localOrigin: string, path: string) =>
  new URL(path.startsWith("/") ? path : `/${path}`, trimSlash(localOrigin)).toString()

const toLocalWsUrl = (localOrigin: string, path: string) => {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, trimSlash(localOrigin))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

const filteredHeaders = (headers?: Record<string, string>) => {
  const result = new Headers(headers)
  for (const key of ["connection", "content-length", "host", "upgrade"]) {
    result.delete(key)
  }
  return result
}

const bufferToBase64 = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("base64")

const base64ToArrayBuffer = (data: string) => {
  const buffer = Buffer.from(data, "base64")
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

export const startCloudClient = (options: CloudClientOptions) => {
  const cloudUrl = trimSlash(options.cloudUrl)
  const localOrigin = trimSlash(options.localOrigin)
  const deviceToken = options.deviceToken
  const deviceId = createHash("sha256").update(deviceToken).digest("hex").slice(0, 12)
  const localSockets = new Map<string, WebSocket>()

  // 当 AUTOVIS_AUTH_ENABLED=true 时，runner 的 /api/* WS（如 LiveViewport 的 /live）也会被鉴权 preHandler 拦截。
  // HTTP 请求经中继时会携带浏览器 Cookie，但中继的 ws-open 不转发任何头，导致桥接到本地的 WS 因缺少 autovis_session
  // 被 401 关闭（浏览器侧只看到 101，但收不到任何帧 → LiveViewport 全程空白）。
  // 这里用本机管理员凭据换一个本地会话 Cookie，作为可信桥接的服务身份附加到本地 WS；用户在云端早已完成鉴权。
  let localAuthCookie: string | null = null
  const refreshLocalAuthCookie = async () => {
    const username = process.env.AUTOVIS_ADMIN_USER?.trim() || "admin"
    const password = process.env.AUTOVIS_ADMIN_PASSWORD?.trim()
    if (!password) {
      localAuthCookie = null
      return
    }
    try {
      const response = await fetch(`${localOrigin}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) return
      const headers = response.headers as Headers & { getSetCookie?: () => string[] }
      const rawCookie = headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie")
      if (rawCookie) localAuthCookie = rawCookie.split(";")[0] ?? null
    } catch {
      // 鉴权未开启或登录失败时保持 null，本地 WS 仍可无 Cookie 连接（未鉴权场景）。
    }
  }

  let stopped = false
  let hasConnectedOnce = false
  let reconnectDelay = RECONNECT_MIN_MS

  const heartbeat = async () => {
    try {
      const response = await fetch(`${cloudUrl}/api/cloud/devices/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: options.name ?? "AutoVis Runner",
          platform: `${process.platform}/${process.arch}`,
          runnerVersion: options.runnerVersion,
          publicBaseUrl: process.env.AUTOVIS_PUBLIC_BASE_URL,
        }),
      })
      if (!response.ok) {
        recordRelayHeartbeatFailure({
          deviceId,
          cloudUrl,
          statusCode: response.status,
          message: await response.text(),
        })
      }
    } catch (error) {
      recordRelayHeartbeatFailure({
        deviceId,
        cloudUrl,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const send = (socket: WebSocket, payload: unknown) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload))
    }
  }

  const proxyHttp = async (socket: WebSocket, id: string, request: TunnelRequest) => {
    try {
      const response = await fetch(toLocalHttpUrl(localOrigin, request.path), {
        method: request.method,
        headers: filteredHeaders(request.headers),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      })
      const bodyBuffer = await response.arrayBuffer()
      const headers = Object.fromEntries(response.headers.entries())
      const contentType = response.headers.get("content-type") ?? ""
      const text = isTextResponse(contentType)

      if (text) {
        const decoded = new TextDecoder().decode(bodyBuffer)
        if (decoded.length <= SAFE_TEXT_FRAME_CHARS) {
          send(socket, {
            type: "response",
            id,
            response: {
              status: response.status,
              headers,
              body: decoded,
              binary: false,
            },
          })
          return
        }
        // 超大文本响应改走分块路径，避免触发中继 envelope 上限（该极端场景下不做远程 URL 重写）。
        log.warn("relay.text_response_too_large", { path: request.path, chars: decoded.length })
      }

      // 二进制响应分块流式回传：start → chunk* → end，避免单帧过大被中继拒收并关闭连接。
      send(socket, {
        type: "response-start",
        id,
        response: { status: response.status, headers },
      })
      const buffer = Buffer.from(bodyBuffer)
      for (let offset = 0; offset < buffer.length; offset += RESPONSE_CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, offset + RESPONSE_CHUNK_BYTES)
        send(socket, { type: "response-chunk", id, data: chunk.toString("base64") })
      }
      send(socket, { type: "response-end", id })
    } catch (error) {
      send(socket, {
        type: "response",
        id,
        response: {
          status: 502,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  const openLocalSocket = (agentSocket: WebSocket, id: string, path: string) => {
    // 带上服务身份 Cookie 才能通过鉴权 preHandler（见 refreshLocalAuthCookie）。
    const wsOptions = localAuthCookie ? { headers: { Cookie: localAuthCookie } } : undefined
    const localSocket = new WebSocket(toLocalWsUrl(localOrigin, path), wsOptions as never)
    // Node 的全局 WebSocket(undici) 默认 binaryType="blob"，二进制帧会回传 Blob，
    // 而 Buffer.from(Blob) 会抛 ERR_INVALID_ARG_TYPE —— 监听器内异常导致每一帧被静默丢弃，
    // 表现为云端中继下 LiveViewport(WS-JPEG) 全程黑屏。强制 arraybuffer 才能正确转 base64。
    localSocket.binaryType = "arraybuffer"
    localSockets.set(id, localSocket)

    localSocket.addEventListener("message", (event) => {
      const binary = typeof event.data !== "string"
      send(agentSocket, {
        type: "ws-message",
        id,
        binary,
        data: binary ? bufferToBase64(event.data as ArrayBuffer) : event.data,
      })
    })

    const close = () => {
      localSockets.delete(id)
      send(agentSocket, { type: "ws-close", id })
    }
    localSocket.addEventListener("close", close)
    localSocket.addEventListener("error", close)
  }

  const handleMessage = (socket: WebSocket, raw: MessageEvent["data"]) => {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer)
    const envelope = JSON.parse(text) as TunnelEnvelope
    if (envelope.type === "request") {
      void proxyHttp(socket, envelope.id, envelope.request)
      return
    }
    if (envelope.type === "ws-open") {
      openLocalSocket(socket, envelope.id, envelope.path)
      return
    }
    if (envelope.type === "ws-message") {
      const localSocket = localSockets.get(envelope.id)
      if (localSocket?.readyState === WebSocket.OPEN && envelope.data !== undefined) {
        localSocket.send(envelope.binary ? base64ToArrayBuffer(envelope.data) : envelope.data)
      }
      return
    }
    if (envelope.type === "ws-close") {
      const localSocket = localSockets.get(envelope.id)
      localSockets.delete(envelope.id)
      localSocket?.close()
    }
  }

  const connect = async () => {
    while (!stopped) {
      try {
        const socket = new WebSocket(toWebSocketUrl(cloudUrl, deviceToken))
        let openedThisCycle = false
        let disconnectSource: "close" | "error" = "close"
        let disconnectCode: number | undefined
        let disconnectReason: string | undefined
        let lastPongAt = Date.now()
        let pingTimer: ReturnType<typeof setInterval> | undefined
        const stopKeepalive = () => {
          if (pingTimer) {
            clearInterval(pingTimer)
            pingTimer = undefined
          }
        }
        socket.addEventListener("open", () => {
          openedThisCycle = true
          reconnectDelay = RECONNECT_MIN_MS
          recordRelayConnected({ deviceId, cloudUrl, reconnected: hasConnectedOnce })
          hasConnectedOnce = true
          lastPongAt = Date.now()
          stopKeepalive()
          pingTimer = setInterval(() => {
            if (socket.readyState !== WebSocket.OPEN) return
            if (Date.now() - lastPongAt > PING_TIMEOUT_MS) {
              log.warn("relay.keepalive_timeout", { deviceId, cloudUrl })
              try {
                socket.close(4000, "keepalive timeout")
              } catch {
                // 忽略关闭异常：close 监听器会触发重连。
              }
              return
            }
            try {
              socket.send(PING_MESSAGE)
            } catch {
              // 发送失败时静默：连接异常会由 close/error 监听器接管。
            }
          }, PING_INTERVAL_MS)
          void heartbeat()
          void refreshLocalAuthCookie()
        })
        socket.addEventListener("message", (event) => {
          try {
            if (typeof event.data === "string" && (event.data === PONG_MESSAGE || event.data === PING_MESSAGE)) {
              lastPongAt = Date.now()
              return
            }
            lastPongAt = Date.now()
            handleMessage(socket, event.data)
          } catch (error) {
            log.warn("relay.message_handling_failed", {
              deviceId,
              cloudUrl,
              error,
            })
          }
        })
        await new Promise<void>((resolve) => {
          socket.addEventListener("close", (event) => {
            disconnectSource = "close"
            disconnectCode = event.code
            disconnectReason = event.reason || undefined
            resolve()
          }, { once: true })
          socket.addEventListener("error", () => {
            disconnectSource = "error"
            disconnectReason = "WebSocket error"
            resolve()
          }, { once: true })
        })
        stopKeepalive()
        if (openedThisCycle) {
          recordRelayDisconnected({
            deviceId,
            cloudUrl,
            source: disconnectSource,
            code: disconnectCode,
            reason: disconnectReason,
          })
        }
        for (const localSocket of localSockets.values()) localSocket.close()
        localSockets.clear()
      } catch (error) {
        log.warn("relay.connection_failed", {
          deviceId,
          cloudUrl,
          reconnectDelayMs: reconnectDelay,
          error,
        })
      }
      await sleep(reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    }
  }

  const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS)
  void heartbeat()
  void refreshLocalAuthCookie()
  void connect()

  return () => {
    stopped = true
    clearInterval(heartbeatTimer)
    for (const socket of localSockets.values()) socket.close()
    localSockets.clear()
  }
}
