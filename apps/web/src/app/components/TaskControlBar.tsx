import { useState } from "react"
import type { TaskKind } from "@autovis/shared"
import { request } from "../api"
import { taskActionUrl } from "../apiRoutes"
import { Button } from "./ui/button"

interface TaskControlBarProps {
  kind: TaskKind
  id: string
  status: string
  onChange?: (nextStatus: string) => void
  className?: string
  size?: "default" | "sm"
}

const PAUSABLE: Record<TaskKind, ReadonlyArray<string>> = {
  "agent": ["running"],
  "run": ["running", "awaiting_human"],
  "task-run": ["running"],
  "recorder": ["running", "starting"],
}

const RESUMABLE: Record<TaskKind, ReadonlyArray<string>> = {
  "agent": ["paused"],
  "run": ["paused"],
  "task-run": ["paused"],
  "recorder": ["paused"],
}

const CANCELLABLE: Record<TaskKind, ReadonlyArray<string>> = {
  "agent": ["running", "paused"],
  "run": ["running", "paused", "awaiting_human", "queued"],
  "task-run": ["running", "paused", "queued"],
  "recorder": ["running", "paused", "starting"],
}

export function TaskControlBar({ kind, id, status, onChange, className, size = "sm" }: TaskControlBarProps) {
  const [busy, setBusy] = useState<null | "pause" | "resume" | "cancel">(null)
  const [error, setError] = useState<string | null>(null)

  const call = async (action: "pause" | "resume" | "cancel") => {
    if (busy) return
    setBusy(action)
    setError(null)
    try {
      const res = await request<{ kind: TaskKind; id: string; status: string }>(taskActionUrl(kind, id, action), {
        method: "POST",
      })
      onChange?.(res.data.status)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const canPause = PAUSABLE[kind].includes(status)
  const canResume = RESUMABLE[kind].includes(status)
  const canCancel = CANCELLABLE[kind].includes(status)

  if (!canPause && !canResume && !canCancel) {
    return null
  }

  return (
    <div className={className ?? "task-control-bar"} role="group" aria-label="任务控制">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {canPause && (
          <Button variant="ghost" size={size} disabled={busy !== null} onClick={() => call("pause")}>
            {busy === "pause" ? "暂停中…" : "暂停"}
          </Button>
        )}
        {canResume && (
          <Button variant="secondary" size={size} disabled={busy !== null} onClick={() => call("resume")}>
            {busy === "resume" ? "恢复中…" : "继续"}
          </Button>
        )}
        {canCancel && (
          <Button variant="danger" size={size} disabled={busy !== null} onClick={() => call("cancel")}>
            {busy === "cancel" ? "停止中…" : "停止"}
          </Button>
        )}
        {status === "cancelling" && <span style={{ fontSize: 12, color: "var(--muted-foreground, #888)" }}>等待安全停止…</span>}
        {status === "paused" && <span style={{ fontSize: 12, color: "var(--muted-foreground, #888)" }}>已暂停（将在下个检查点恢复）</span>}
        {error && <span style={{ fontSize: 12, color: "var(--destructive, #dc2626)" }}>{error}</span>}
      </div>
    </div>
  )
}
