import { useEffect, useMemo, useRef, useState } from "react"
import { resolveUrl } from "../utils"
import type { LiveViewportState } from "@autovis/shared"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"

type BrowserFrameProps = {
  title: string
  url?: string
  viewport?: string
  replayVideoUrl?: string
  liveViewport?: LiveViewportState
  emptyText: string
  noCard?: boolean
  className?: string
  contentClassName?: string
  imageClassName?: string
  onImageClick?: (e: React.MouseEvent<HTMLImageElement>) => void
}

export function BrowserFrame({
  title,
  url,
  viewport,
  replayVideoUrl,
  liveViewport,
  emptyText,
  noCard = false,
  className = "",
  contentClassName = "",
  imageClassName = "",
  onImageClick
}: BrowserFrameProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!liveViewport?.url || liveViewport.status === "unavailable") {
      return undefined
    }

    let disposed = false
    const socket = new WebSocket(liveViewport.url)
    socket.binaryType = "arraybuffer"
    socket.onmessage = (event) => {
      if (disposed || !(event.data instanceof ArrayBuffer) || !canvasRef.current) {
        return
      }

      const blob = new Blob([event.data], { type: liveViewport.mimeType })
      const frameUrl = URL.createObjectURL(blob)
      const image = new Image()
      image.onload = () => {
        if (!canvasRef.current) {
          URL.revokeObjectURL(frameUrl)
          return
        }
        const canvas = canvasRef.current
        const context = canvas.getContext("2d")
        if (!context) {
          URL.revokeObjectURL(frameUrl)
          return
        }
        canvas.width = liveViewport.width ?? image.width
        canvas.height = liveViewport.height ?? image.height
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(frameUrl)
      }
      image.src = frameUrl
    }

    return () => {
      disposed = true
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      const canvas = canvasRef.current
      const context = canvas?.getContext("2d")
      if (canvas && context) {
        context.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [liveViewport?.url, liveViewport?.status, liveViewport?.mimeType, liveViewport?.width, liveViewport?.height])

  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isFullscreen])

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (onImageClick) {
      onImageClick(e)
    } else {
      setIsFullscreen(true)
    }
  }

  const hasLiveVideo = Boolean(liveViewport?.status === "live" || liveViewport?.status === "connecting")
  const hasReplayVideo = Boolean(replayVideoUrl)
  const hasViewportImage = Boolean(viewport)

  const content = (
    <div className={`overflow-hidden rounded-2xl border border-border/80 bg-background/80 ${className}`}>
      <div className="flex items-center gap-2 border-b border-border/80 px-4 py-3">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="size-3 rounded-full bg-red-400/70" />
          <span className="size-3 rounded-full bg-amber-400/70" />
          <span className="size-3 rounded-full bg-emerald-400/70" />
        </div>
        <div className="ml-3 flex-1 truncate rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{url || "--"}</div>
        <button
          type="button"
          onClick={() => setIsFullscreen(true)}
          className="ml-2 flex items-center justify-center size-6 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
          title="全屏查看"
        >
          <span className="material-symbols-outlined text-sm">fullscreen</span>
        </button>
      </div>
      <div className={`flex items-center justify-center bg-slate-100/80 dark:bg-slate-950/60 p-4 ${contentClassName || "min-h-[18rem]"}`}>
        {hasLiveVideo ? (
          <canvas
            ref={canvasRef}
            className={`rounded-xl border border-border transition-all duration-200 ${imageClassName || "max-h-[22rem] w-full object-contain"}`}
          />
        ) : hasReplayVideo ? (
          <video
            autoPlay
            controls
            playsInline
            className={`rounded-xl border border-border transition-all duration-200 ${imageClassName || "max-h-[22rem] w-full object-contain"}`}
            src={resolveUrl(replayVideoUrl)}
          />
        ) : hasViewportImage ? (
          <img
            alt={title}
            className={`rounded-xl border border-border transition-all duration-200 ${
              onImageClick ? "cursor-pointer" : "cursor-zoom-in hover:brightness-110 hover:shadow-md"
            } ${imageClassName || "max-h-[22rem] w-full object-cover"}`}
            src={resolveUrl(viewport)}
            onClick={handleImageClick}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
            <span className="material-symbols-outlined text-4xl">web_asset</span>
            <p className="text-sm">{emptyText}</p>
          </div>
        )}
      </div>
    </div>
  )

  if (noCard) {
    return (
      <>
        {content}
        {isFullscreen && (
          <div className="fixed inset-0 z-[100] flex flex-col bg-background/95 dark:bg-slate-950/95 backdrop-blur-md p-6 select-none animate-in fade-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border/40 mb-4 shrink-0">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-xl">desktop_windows</span>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{title} (全屏视图)</h3>
                  <p className="text-xs text-muted-foreground font-mono truncate max-w-xl">{url || "--"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="flex items-center justify-center size-8 rounded-full bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all cursor-pointer"
                  title="退出全屏 (Esc)"
                >
                  <span className="material-symbols-outlined text-lg">close</span>
                </button>
              </div>
            </div>
            
            {/* Content area: maximized view */}
            <div className="flex-1 flex items-center justify-center overflow-auto min-h-0 relative p-4 bg-slate-100/50 dark:bg-slate-900/30 rounded-2xl border border-border/40">
              {hasLiveVideo ? (
                <canvas
                  ref={canvasRef}
                  className="max-h-full max-w-full object-contain rounded-xl border border-border/60"
                />
              ) : hasReplayVideo ? (
                <video
                  autoPlay
                  controls
                  playsInline
                  className="max-h-full max-w-full object-contain rounded-xl border border-border/60"
                  src={resolveUrl(replayVideoUrl)}
                />
              ) : hasViewportImage ? (
                <img
                  alt={title}
                  className={`max-h-full max-w-full object-contain rounded-xl border border-border/60 ${
                    onImageClick ? "cursor-pointer" : "cursor-zoom-out"
                  }`}
                  src={resolveUrl(viewport)}
                  onClick={onImageClick ? handleImageClick : () => setIsFullscreen(false)}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <span className="material-symbols-outlined text-4xl">web_asset</span>
                  <p className="text-sm">{emptyText}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {content}
      </CardContent>
    </Card>
  )
}
