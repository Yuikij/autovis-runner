import type { TaskRun } from "@autovis/shared"

import { Badge } from "../../components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime, translateStatus } from "../../utils"

type TaskRunHistoryProps = {
  history: TaskRun[]
  onOpenTaskRun: (taskRunId: string) => void
}

export function TaskRunHistory({ history, onOpenTaskRun }: TaskRunHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><span className="material-symbols-outlined text-primary text-lg">history</span>执行历史记录</CardTitle>
        <CardDescription>该任务的所有历史运行状态和步骤明细。点击任意记录可跳转至详情控制台。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {history.length === 0 ? (
          <div className="relative rounded-xl border border-dashed border-border/80 bg-secondary/5 px-4 py-8 text-center flex flex-col items-center justify-center gap-2">
            <span className="material-symbols-outlined text-muted-foreground/60 text-xl">history_toggle_off</span>
            <p className="text-xs text-muted-foreground">该任务暂无历史运行记录。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((taskRun) => {
              const isPassed = taskRun.status === "passed"
              const isFailed = taskRun.status === "failed"
              const isRunning = taskRun.status === "running" || taskRun.status === "queued"

              return (
                <button
                  key={taskRun.id}
                  type="button"
                  onClick={() => onOpenTaskRun(taskRun.id)}
                  className="relative overflow-hidden w-full flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-card p-4 text-left transition-all duration-300 hover:scale-[1.01] hover:border-primary/20 hover:shadow-sm group"
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${isPassed ? "bg-emerald-500" : isFailed ? "bg-rose-500" : "bg-amber-500"}`} />

                  <div className="flex items-center gap-3.5 min-w-0 pl-1.5">
                    <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary">
                      {isRunning ? <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" /> : <span className={`h-2.5 w-2.5 rounded-full ${isPassed ? "bg-emerald-500" : isFailed ? "bg-rose-500" : "bg-amber-500"}`} />}
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-foreground tracking-wide">#{taskRun.id.slice(0, 8)}</span>
                        <Badge tone={isPassed ? "success" : isFailed ? "danger" : "warning"}>{translateStatus(taskRun.status)}</Badge>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/80">
                        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[13px] text-muted-foreground/60">playlist_add_check</span>通过率：{taskRun.passedCount}/{taskRun.totalCount}</span>
                        {taskRun.failedCount > 0 ? <span className="flex items-center gap-1 text-rose-500 font-medium"><span className="material-symbols-outlined text-[13px]">error</span>失败 {taskRun.failedCount} 个</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                    <span className="material-symbols-outlined text-[13px]">schedule</span>
                    {formatDateTime(taskRun.startedAt)}
                    <span className="material-symbols-outlined text-sm text-muted-foreground/45 group-hover:translate-x-0.5 transition-transform">chevron_right</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}