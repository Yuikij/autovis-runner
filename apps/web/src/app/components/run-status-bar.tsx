import { useEffect, useRef, useState } from "react"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { translateStatus } from "../utils"

type RunStatusBarProps = {
  /** 运行状态（如 running / passed / failed / awaiting_human）。 */
  status: string
  /** 当前步骤或任务标题。 */
  title: string
  /** 标题后面的补充说明（最近一条日志等）。 */
  subtitle?: string
  /** 展开后展示的完整日志文本。 */
  logs?: string
  /** 右侧控制区（如 TaskControlBar）。 */
  controls?: React.ReactNode
}

const LIVE_STATUSES = new Set(["queued", "running", "awaiting_human", "paused", "cancelling", "starting"])

/**
 * 全屏视图里悬浮在画面上方的可折叠状态栏：折叠时滚动展示当前状态与最新日志，
 * 展开后查看全部日志。样式与工作台沙盒的中间状态栏保持一致。
 */
export function RunStatusBar({ status, title, subtitle, logs, controls }: RunStatusBarProps) {
  const [expanded, setExpanded] = useState(false)
  const logRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    if (expanded && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [expanded, logs])

  const isLive = LIVE_STATUSES.has(status)
  const dotClass = status === "failed"
    ? "bg-rose-500"
    : status === "passed"
      ? "bg-emerald-500"
      : isLive
        ? "bg-primary animate-pulse"
        : "bg-slate-400"

  return (
    <div
      className={`pointer-events-auto bg-background/85 dark:bg-slate-900/85 backdrop-blur-xl border border-border/60 shadow-2xl rounded-2xl overflow-hidden transition-all duration-500 ease-in-out flex flex-col ${
        expanded ? "w-full max-w-3xl max-h-[60vh]" : "w-full max-w-2xl h-12 hover:bg-background/95 hover:border-primary/40 cursor-pointer"
      }`}
      onClick={() => { if (!expanded) setExpanded(true) }}
    >
      <div className="flex items-center justify-between gap-3 px-4 h-12 shrink-0 select-none">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className={`flex size-2 rounded-full shrink-0 ${dotClass}`} />
          <Badge tone={status === "passed" ? "success" : status === "failed" ? "danger" : "warning"}>
            {translateStatus(status)}
          </Badge>
          <span className="text-sm font-semibold text-foreground truncate max-w-[220px] shrink-0">{title}</span>
          {subtitle ? <span className="text-xs text-muted-foreground truncate hidden sm:block">{subtitle}</span> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(event) => event.stopPropagation()}>
          {controls}
          {expanded ? (
            <Button variant="ghost" size="sm" className="shrink-0 rounded-full size-8 p-0 hover:bg-muted" onClick={() => setExpanded(false)}>
              <span className="material-symbols-outlined text-base">expand_less</span>
            </Button>
          ) : (
            <span className="material-symbols-outlined text-muted-foreground shrink-0 text-sm">expand_more</span>
          )}
        </div>
      </div>

      {expanded ? (
        <pre
          ref={logRef}
          className="flex-1 min-h-[10rem] overflow-auto whitespace-pre-wrap border-t border-border/40 bg-secondary/30 px-4 py-3 text-xs leading-6 font-mono text-slate-800 dark:text-slate-200"
        >
          {logs?.trim() || "暂无日志输出。"}
        </pre>
      ) : null}
    </div>
  )
}
