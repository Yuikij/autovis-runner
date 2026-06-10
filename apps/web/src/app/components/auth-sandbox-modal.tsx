import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AuthLoginSandboxSession,
  AuthProfileState,
  RecorderInteractionRequest,
  SaveAuthLoginSandboxResponse,
} from "@autovis/shared"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import { resolveWebSocketUrl } from "../utils"
import { Button } from "./ui/button"

// 服务端用 viewport:null（跟随真实窗口）启动反检测浏览器，真实 CSS 视口尺寸由
// session.liveViewport.width/height 下发；这里只在尚未拿到时用作兜底。
const FALLBACK_WIDTH = 1440
const FALLBACK_HEIGHT = 960
const POINTER_MOVE_MIN_INTERVAL_MS = 25

// 这些按键作为"命名键"转发（keyboard.press）；其余可打印单字符走 input（keyboard.type）。
const NAMED_KEYS = new Set([
  "Enter",
  "Backspace",
  "Tab",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

type AuthSandboxModalProps = {
  projectId: string
  authProfileId: string
  targetUrlId: string
  targetLabel: string
  onClose: () => void
  onSaved: (state: AuthProfileState) => void
}

export function AuthSandboxModal({
  projectId,
  authProfileId,
  targetUrlId,
  targetLabel,
  onClose,
  onSaved,
}: AuthSandboxModalProps) {
  const [session, setSession] = useState<AuthLoginSandboxSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [navInput, setNavInput] = useState("")

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const savedRef = useRef(false)
  const socketRef = useRef<WebSocket | null>(null)
  const controlSocketRef = useRef<WebSocket | null>(null)
  const draggingPointerIdRef = useRef<number | null>(null)
  const lastPointerMoveAtRef = useRef(0)
  const interactionQueueRef = useRef(Promise.resolve())

  // 启动会话
  useEffect(() => {
    let cancelled = false
    request<AuthLoginSandboxSession>(apiRoutes.authLoginSandbox.create(), {
      method: "POST",
      body: JSON.stringify({ projectId, authProfileId, targetUrlId }),
    })
      .then((res) => {
        if (cancelled) {
          // 组件已卸载：直接收尾，避免泄漏服务端浏览器
          void request(apiRoutes.authLoginSandbox.cancel(res.data.id), { method: "POST" }).catch(() => undefined)
          return
        }
        sessionIdRef.current = res.data.id
        setSession(res.data)
        setNavInput(res.data.currentUrl ?? res.data.targetUrl)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, authProfileId, targetUrlId])

  // 连 WS-JPEG 实时画面
  useEffect(() => {
    const liveUrl = resolveWebSocketUrl(session?.liveViewport?.url)
    if (!liveUrl) return undefined

    let disposed = false
    const socket = new WebSocket(liveUrl)
    socket.binaryType = "arraybuffer"
    socketRef.current = socket
    socket.onmessage = (event) => {
      if (disposed || !(event.data instanceof ArrayBuffer) || !canvasRef.current) return
      const blob = new Blob([event.data], { type: session?.liveViewport?.mimeType ?? "image/jpeg" })
      const frameUrl = URL.createObjectURL(blob)
      const image = new Image()
      image.onload = () => {
        const canvas = canvasRef.current
        const context = canvas?.getContext("2d")
        if (!canvas || !context) {
          URL.revokeObjectURL(frameUrl)
          return
        }
        canvas.width = image.width
        canvas.height = image.height
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(frameUrl)
      }
      image.src = frameUrl
    }
    return () => {
      disposed = true
      socketRef.current = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [session?.liveViewport?.url, session?.liveViewport?.mimeType])

  useEffect(() => {
    const id = session?.id
    if (!id) return undefined

    let disposed = false
    const socket = new WebSocket(resolveWebSocketUrl(apiRoutes.authLoginSandbox.control(id)))
    controlSocketRef.current = socket
    socket.onmessage = (event) => {
      if (disposed || typeof event.data !== "string") return
      try {
        const payload = JSON.parse(event.data) as
          | { type: "session"; data: AuthLoginSandboxSession }
          | { type: "error"; message?: string }
        if (payload.type === "session") {
          setSession((current) => (current ? { ...current, ...payload.data } : payload.data))
        } else if (payload.type === "error" && payload.message) {
          setError(payload.message)
        }
      } catch {
        // Ignore malformed control-channel messages.
      }
    }
    socket.onclose = () => {
      if (controlSocketRef.current === socket) {
        controlSocketRef.current = null
      }
    }
    socket.onerror = () => {
      if (!disposed && controlSocketRef.current === socket) {
        controlSocketRef.current = null
      }
    }
    return () => {
      disposed = true
      if (controlSocketRef.current === socket) {
        controlSocketRef.current = null
      }
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [session?.id])

  // 卸载时若未保存，收尾关闭服务端浏览器
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current
      if (id && !savedRef.current) {
        void request(apiRoutes.authLoginSandbox.cancel(id), { method: "POST" }).catch(() => undefined)
      }
    }
  }, [])

  const sendInteraction = useCallback((interaction: RecorderInteractionRequest) => {
    const id = sessionIdRef.current
    if (!id) return
    const controlSocket = controlSocketRef.current
    if (controlSocket?.readyState === WebSocket.OPEN) {
      controlSocket.send(JSON.stringify(interaction))
      return
    }
    interactionQueueRef.current = interactionQueueRef.current
      .catch(() => undefined)
      .then(() =>
        request<AuthLoginSandboxSession>(apiRoutes.authLoginSandbox.interactions(id), {
          method: "POST",
          body: JSON.stringify(interaction),
        }),
      )
      .then((res) => {
        setSession((current) => (current ? { ...current, ...res.data } : res.data))
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const getCanvasCoordinates = useCallback((canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const logicalW = session?.liveViewport?.width ?? FALLBACK_WIDTH
    const logicalH = session?.liveViewport?.height ?? FALLBACK_HEIGHT
    const x = Math.round(((clientX - rect.left) / rect.width) * logicalW)
    const y = Math.round(((clientY - rect.top) / rect.height) * logicalH)
    return { x: Math.max(0, Math.min(logicalW, x)), y: Math.max(0, Math.min(logicalH, y)) }
  }, [session?.liveViewport?.width, session?.liveViewport?.height])

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const coords = getCanvasCoordinates(e.currentTarget, e.clientX, e.clientY)
    if (!coords) return
    e.preventDefault()
    e.currentTarget.focus()
    draggingPointerIdRef.current = e.pointerId
    lastPointerMoveAtRef.current = 0
    e.currentTarget.setPointerCapture(e.pointerId)
    sendInteraction({ type: "pointerdown", ...coords })
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingPointerIdRef.current !== e.pointerId) return
    const coords = getCanvasCoordinates(e.currentTarget, e.clientX, e.clientY)
    if (!coords) return
    e.preventDefault()
    if (e.timeStamp - lastPointerMoveAtRef.current < POINTER_MOVE_MIN_INTERVAL_MS) return
    lastPointerMoveAtRef.current = e.timeStamp
    sendInteraction({ type: "pointermove", ...coords })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingPointerIdRef.current !== e.pointerId) return
    const coords = getCanvasCoordinates(e.currentTarget, e.clientX, e.clientY)
    draggingPointerIdRef.current = null
    e.preventDefault()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    sendInteraction({ type: "pointerup", ...(coords ?? {}) })
  }

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingPointerIdRef.current !== e.pointerId) return
    const coords = getCanvasCoordinates(e.currentTarget, e.clientX, e.clientY)
    draggingPointerIdRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    sendInteraction({ type: "pointerup", ...(coords ?? {}) })
  }

  // 滚轮需要 passive:false 才能 preventDefault，用原生监听器挂载
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      sendInteraction({ type: "scroll", deltaY: Math.round(e.deltaY) })
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [sendInteraction, session?.id])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      sendInteraction({ type: "input", value: e.key })
    } else if (NAMED_KEYS.has(e.key)) {
      e.preventDefault()
      sendInteraction({ type: "keydown", key: e.key })
    }
  }

  const handleNavigate = () => {
    const url = navInput.trim()
    if (url) sendInteraction({ type: "navigate", url })
  }

  const handleSave = async () => {
    const id = sessionIdRef.current
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      const res = await request<SaveAuthLoginSandboxResponse>(apiRoutes.authLoginSandbox.save(id), { method: "POST" })
      savedRef.current = true
      onSaved(res.data.state)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const starting = !session && !error
  const summary = session?.savedSummary

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-background/95 dark:bg-slate-950/95 backdrop-blur-md p-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-border/40 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="material-symbols-outlined text-primary text-xl">login</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">登录沙盒 · {targetLabel}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate max-w-xl">{session?.currentUrl ?? session?.targetUrl ?? "--"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!session || saving || session.status !== "live"}
            className="h-8 px-3 text-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm mr-1">save</span>
            {saving ? "保存中…" : "我已登录成功，保存登录态"}
          </Button>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center size-8 rounded-full bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
            title="关闭（不保存）"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <input
          value={navInput}
          onChange={(e) => setNavInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleNavigate()
          }}
          placeholder="https://..."
          className="flex-1 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-mono outline-none focus:border-primary"
        />
        <Button size="sm" variant="ghost" onClick={handleNavigate} disabled={!session} className="h-8 px-3 text-xs border border-border/60 cursor-pointer">
          前往
        </Button>
      </div>

      {/* Tips */}
      <p className="text-[11px] text-muted-foreground mb-3 shrink-0">
        在下方画面里像本地浏览器一样操作完成登录：滑块直接拖、点选直接点、短信验证码看手机输、扫码掏手机扫。登录成功后点右上角"保存登录态"。点击画面后可直接用键盘输入。
      </p>

      {/* Canvas area */}
      <div
        className="flex-1 flex items-center justify-center overflow-auto min-h-0 relative p-4 bg-slate-100/50 dark:bg-slate-900/30 rounded-2xl border border-border/40"
        tabIndex={-1}
      >
        {starting ? (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <span className="material-symbols-outlined text-4xl animate-spin">progress_activity</span>
            <p className="text-sm">正在启动反检测浏览器并打开目标站点…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 text-rose-500 max-w-lg text-center">
            <span className="material-symbols-outlined text-4xl">error</span>
            <p className="text-sm break-words">{error}</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => e.preventDefault()}
            className="max-h-full max-w-full object-contain rounded-xl border border-border/60 outline-none cursor-crosshair touch-none select-none focus:ring-2 focus:ring-primary/60"
          />
        )}
      </div>

      {summary ? (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-3 shrink-0">
          已保存：{summary.cookieCount} 个 cookie · {summary.originCount} 个 origin
        </p>
      ) : null}
    </div>
  )
}
