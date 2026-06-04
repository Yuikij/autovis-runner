import type { Task } from "@autovis/shared"

import { EmptyState } from "../../components/empty-state"
import { Badge } from "../../components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { describeTaskMode } from "./shared"

type TasksListProps = {
  selectedTaskId: string | null
  tasks: Task[]
  onSelectTask: (taskId: string) => void
}

export function TasksList({ selectedTaskId, tasks, onSelectTask }: TasksListProps) {
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>任务列表</CardTitle>
        <CardDescription>{tasks.length} 个任务</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
        {tasks.length === 0 ? (
          <EmptyState description="当前项目下还没有任何任务，点击右上角新建任务。" title="暂无任务" />
        ) : (
          tasks.map((task) => {
            const isActive = task.id === selectedTaskId
            const lastStatus = task.lastStatus
            const statusColor = lastStatus === "passed" ? "before:bg-emerald-500" : lastStatus === "failed" ? "before:bg-rose-500" : lastStatus ? "before:bg-amber-500" : "before:bg-muted-foreground/20"
            return (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                type="button"
                className={`relative overflow-hidden w-full rounded-xl pl-5 pr-4 py-4 text-left transition-all duration-300 block hover:scale-[1.01] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[4px] ${statusColor} ${
                  isActive
                    ? "bg-primary/5 border border-primary/30 ring-1 ring-primary/10 shadow-sm"
                    : "bg-card border border-border/80 hover:bg-secondary/20 hover:border-border hover:shadow-sm"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-sm font-semibold text-foreground truncate">{task.name}</strong>
                  {task.lastStatus ? (
                    <Badge tone={task.lastStatus === "passed" ? "success" : task.lastStatus === "failed" ? "danger" : "warning"}>
                      {task.lastStatus === "passed" ? "通过" : task.lastStatus === "failed" ? "失败" : "运行中"}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                  <span className="material-symbols-outlined text-[13px] text-muted-foreground/60">task</span>
                  {task.items.length} 个步骤
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                  <span className="material-symbols-outlined text-[13px] text-muted-foreground/60">run_circle</span>
                  {describeTaskMode(task.executionMode)}
                </p>
              </button>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}