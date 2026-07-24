import type { KeyboardEvent } from "react"
import type { Task } from "@autovis/shared"

import { EmptyState } from "../../components/empty-state"
import { Badge } from "../../components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { describeTaskMode } from "./shared"
import { t } from "../../../i18n/index.js"

type TasksListProps = {
  selectedTaskId: string | null
  tasks: Task[]
  onSelectTask: (taskId: string) => void
  onRunTask: (taskId: string) => void
  busy: boolean
}

export function TasksList({ selectedTaskId, tasks, onSelectTask, onRunTask, busy }: TasksListProps) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t("tasks.listTitle")}</CardTitle>
        <CardDescription>{t("tasks.taskCount", { count: tasks.length })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
        {tasks.length === 0 ? (
          <EmptyState description={t("tasks.listEmptyDescription")} title={t("tasks.listEmptyTitle")} />
        ) : (
          tasks.map((task) => {
            const isActive = task.id === selectedTaskId
            const lastStatus = task.lastStatus
            const isRunning = lastStatus === "running"
            const statusColor = lastStatus === "passed" ? "before:bg-emerald-500" : lastStatus === "failed" ? "before:bg-rose-500" : lastStatus ? "before:bg-amber-500" : "before:bg-muted-foreground/20"
            const handleSelect = () => onSelectTask(task.id)
            const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                handleSelect()
              }
            }
            const handleRun = () => {
              if (busy || isRunning) return
              onRunTask(task.id)
            }
            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={handleSelect}
                onKeyDown={handleKeyDown}
                className={`group relative overflow-hidden w-full rounded-xl pl-5 pr-4 py-4 text-left transition-all duration-300 block cursor-pointer hover:scale-[1.01] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[4px] ${statusColor} ${
                  isActive
                    ? "bg-primary/5 border border-primary/30 ring-1 ring-primary/10 shadow-sm"
                    : "bg-card border border-border/80 hover:bg-secondary/20 hover:border-border hover:shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm font-semibold text-foreground truncate">{task.name}</strong>
                  <div className="flex items-center gap-2 shrink-0">
                    {task.lastStatus ? (
                      <Badge tone={task.lastStatus === "passed" ? "success" : task.lastStatus === "failed" ? "danger" : "warning"}>
                        {task.lastStatus === "passed" ? t("tasks.statusPassed") : task.lastStatus === "failed" ? t("tasks.statusFailed") : t("tasks.statusRunning")}
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      aria-label={isRunning ? t("tasks.taskRunning") : t("tasks.runTaskNow")}
                      title={isRunning ? t("tasks.taskRunning") : t("tasks.runNow")}
                      disabled={busy || isRunning}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRun()
                      }}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isRunning
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-border/60 bg-background/60 text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-primary/10 hover:border-primary/30"
                      }`}
                    >
                      <span className={`material-symbols-outlined text-base ${isRunning ? "animate-pulse" : ""}`}>
                        {isRunning ? "sync" : "play_arrow"}
                      </span>
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                  <span className="material-symbols-outlined text-[13px] text-muted-foreground/60">task</span>
                  {t("tasks.stepsCount", { count: task.items.length })}
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                  <span className="material-symbols-outlined text-[13px] text-muted-foreground/60">run_circle</span>
                  {describeTaskMode(task.executionMode)}
                </p>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
