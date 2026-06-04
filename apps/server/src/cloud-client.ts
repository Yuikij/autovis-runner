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
  const localSockets = new Map<string, WebSocket>()

  let stopped = false
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
        console.warn(`[cloud] heartbeat failed: ${response.status} ${await response.text()}`)
      }
    } catch (error) {
      console.warn(`[cloud] heartbeat failed: ${error instanceof Error ? error.message : String(error)}`)
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

      send(socket, {
        type: "response",
        id,
        response: {
          status: response.status,
          headers,
          body: text ? new TextDecoder().decode(bodyBuffer) : undefined,
          bodyBase64: text ? undefined : bufferToBase64(bodyBuffer),
          binary: !text,
        },
      })
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
    const localSocket = new WebSocket(toLocalWsUrl(localOrigin, path))
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
        socket.addEventListener("open", () => {
          reconnectDelay = RECONNECT_MIN_MS
          console.log(`[cloud] connected to ${cloudUrl}`)
          void heartbeat()
        })
        socket.addEventListener("message", (event) => {
          try {
            handleMessage(socket, event.data)
          } catch (error) {
            console.warn(`[cloud] message handling failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
        await new Promise<void>((resolve) => {
          socket.addEventListener("close", () => resolve(), { once: true })
          socket.addEventListener("error", () => resolve(), { once: true })
        })
        for (const localSocket of localSockets.values()) localSocket.close()
        localSockets.clear()
      } catch (error) {
        console.warn(`[cloud] connection failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      await sleep(reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
    }
  }

  const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS)
  void heartbeat()
  void connect()

  return () => {
    stopped = true
    clearInterval(heartbeatTimer)
    for (const socket of localSockets.values()) socket.close()
    localSockets.clear()
  }
}
