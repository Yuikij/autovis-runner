import type { ExecutionRun, PersistedTaskControlCommand, Task, TaskRun, TestCase } from "@autovis/shared"

import { EmptyState } from "../../components/empty-state"
import { PageHeader } from "../../components/page-header"
import { TaskControlBar } from "../../components/TaskControlBar"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { formatDateTime, formatDuration, translateStatus } from "../../utils"
import { t } from "../../../i18n/index.js"

type TaskRunWithCurrentRun = {
  taskRun: TaskRun
  currentRun: ExecutionRun | null
}

type RunsListProps = {
  activeTaskRunId: string | null
  busy: boolean
  executionFailCount: number
  executionPassCount: number
  executionRuns: ExecutionRun[]
  filteredTaskRuns: TaskRunWithCurrentRun[]
  hasActiveExecution: boolean
  onClearRuns: () => void
  onDeleteTemporaryRun: (runId: string) => void
  onOpenTask: (taskRunId: string, run?: ExecutionRun | null) => void
  onOpenTemporaryRun: (run: ExecutionRun) => void
  temporaryRuns: ExecutionRun[]
  projectControlCommands: PersistedTaskControlCommand[]
  projectControlCommandsError: string | null
  projectControlCommandsLoading: boolean
  runCaseMap: Map<string, TestCase>
  statusFilter: "all" | "running" | "passed" | "failed"
  taskMap: Map<string, Task>
  taskRuns: TaskRun[]
  onStatusFilterChange: (next: "all" | "running" | "passed" | "failed") => void
}

export function RunsList({
  activeTaskRunId,
  busy,
  executionFailCount,
  executionPassCount,
  executionRuns,
  filteredTaskRuns,
  hasActiveExecution,
  onClearRuns,
  onDeleteTemporaryRun,
  onOpenTask,
  onOpenTemporaryRun,
  temporaryRuns,
  projectControlCommands,
  projectControlCommandsError,
  projectControlCommandsLoading,
  runCaseMap,
  statusFilter,
  taskMap,
  taskRuns,
  onStatusFilterChange,
}: RunsListProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Execution Center"
        title={t("runs.title")}
        description={t("runs.pageDescription")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {taskRuns.length > 0 ? (
              <Button
                disabled={busy || hasActiveExecution}
                onClick={onClearRuns}
                variant="ghost"
                className="rounded-xl border border-border hover:bg-secondary/60 text-xs h-9 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">delete_sweep</span>
                {t("runs.clearCompletedHistory")}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-3 opacity-15 text-primary">
            <span className="material-symbols-outlined text-5xl">task</span>
          </div>
          <CardContent className="space-y-1 py-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("runs.statTaskRuns")}</p>
            <strong className="text-3xl font-bold text-foreground font-mono">{taskRuns.length}</strong>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-3 opacity-15 text-indigo-500">
            <span className="material-symbols-outlined text-5xl">deployed_code</span>
          </div>
          <CardContent className="space-y-1 py-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("runs.statSubRuns")}</p>
            <strong className="text-3xl font-bold text-foreground font-mono">{executionRuns.length}</strong>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-3 opacity-15 text-emerald-500">
            <span className="material-symbols-outlined text-5xl">check_circle</span>
          </div>
          <CardContent className="space-y-1 py-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("runs.statPassedSubRuns")}</p>
            <strong className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{executionPassCount}</strong>
          </CardContent>
        </Card>
        <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
          <div className="absolute top-0 right-0 p-3 opacity-15 text-rose-500">
            <span className="material-symbols-outlined text-5xl">cancel</span>
          </div>
          <CardContent className="space-y-1 py-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{t("runs.statFailedSubRuns")}</p>
            <strong className="text-3xl font-bold text-rose-600 dark:text-rose-450 font-mono">{executionFailCount}</strong>
          </CardContent>
        </Card>
      </div>

      {temporaryRuns.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/5 backdrop-blur-md shadow-sm overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-amber-500/20 bg-amber-500/5 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-amber-500">bolt</span>
                {t("runs.temporaryRuns")}
              </CardTitle>
              <CardDescription className="text-xs">{t("runs.temporaryRunsDescription")}</CardDescription>
            </div>
            <Badge tone="warning">{t("runs.itemCount", { count: temporaryRuns.length })}</Badge>
          </CardHeader>
          <CardContent className="p-6 space-y-3">
            {temporaryRuns.map((run) => {
              const caseObj = runCaseMap.get(run.testCaseId)
              const isLive = run.status === "queued" || run.status === "running" || run.status === "awaiting_human" || run.status === "paused" || run.status === "cancelling"
              return (
                <div
                  key={run.id}
                  className={`w-full rounded-2xl border p-4 flex flex-col gap-3 transition-all duration-300 ${
                    isLive ? "border-amber-500/40 bg-card/70 ring-1 ring-amber-500/20" : "border-border/60 bg-card/50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenTemporaryRun(run)}
                      className="flex items-center gap-2 flex-wrap text-left cursor-pointer group"
                    >
                      <strong className="font-mono text-sm tracking-wide text-foreground group-hover:text-primary transition-colors">
                        {caseObj?.caseCode ?? `#${run.id.slice(0, 8)}`}
                      </strong>
                      <Badge tone={run.status === "passed" ? "success" : run.status === "failed" ? "danger" : "warning"}>
                        {translateStatus(run.status)}
                      </Badge>
                      {run.status === "awaiting_human" ? <Badge tone="warning" className="animate-pulse">{t("runs.awaitingHumanInput")}</Badge> : null}
                      {isLive ? <span className="flex size-2 rounded-full bg-amber-500 animate-ping" /> : null}
                      <span className="text-xs text-muted-foreground truncate max-w-[260px]">{caseObj?.purpose ?? run.testCaseId}</span>
                    </button>
                    <div className="flex items-center gap-3 flex-wrap" onClick={(event) => event.stopPropagation()}>
                      <div className="text-right text-[11px] text-muted-foreground font-mono">
                        <p>{formatDateTime(run.startedAt)}</p>
                        <p className="mt-0.5 font-sans font-medium text-foreground/80">
                          {run.finishedAt ? t("runs.elapsed", { duration: formatDuration(run.startedAt, run.finishedAt) }) : t("runs.inProgress")}
                        </p>
                      </div>
                      <TaskControlBar kind="run" id={run.id} status={run.status} />
                      <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs cursor-pointer" onClick={() => onOpenTemporaryRun(run)}>
                        {t("runs.viewDetails")}
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Button>
                      {!isLive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          className="h-8 rounded-lg text-xs cursor-pointer text-destructive hover:bg-destructive/10"
                          onClick={() => onDeleteTemporaryRun(run.id)}
                          title={t("runs.deleteRunTooltip")}
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground opacity-90 line-clamp-1 italic font-mono bg-black/5 dark:bg-black/25 px-2 py-1 rounded border border-border/20">
                    {run.logs.at(-1) ?? t("runs.awaitingFeedback")}
                  </p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border bg-card/20 backdrop-blur-md shadow-sm overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-border bg-secondary/15 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold text-foreground">{t("runs.recentControlCommands")}</CardTitle>
            <CardDescription className="text-xs">{t("runs.recentControlCommandsDescription")}</CardDescription>
          </div>
          <Badge tone="default">{t("runs.recentCount", { count: projectControlCommands.length })}</Badge>
        </CardHeader>
        <CardContent className="p-6">
          {projectControlCommandsLoading ? (
            <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-5 text-sm text-muted-foreground">{t("runs.loadingControlCommands")}</div>
          ) : projectControlCommandsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-5 text-sm text-destructive">{projectControlCommandsError}</div>
          ) : projectControlCommands.length === 0 ? (
            <EmptyState description={t("runs.noProjectCommandsDescription")} title={t("runs.noProjectCommandsTitle")} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projectControlCommands.map((command) => {
                const statusTone = command.status === "applied" ? "success" : command.status === "rejected" ? "danger" : command.status === "orphaned" ? "warning" : "default"
                return (
                  <div key={command.id} className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-foreground">#{command.id.slice(0, 8)}</span>
                      <Badge tone={statusTone}>{command.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="default">{command.taskKind}</Badge>
                      <Badge tone={statusTone}>{command.action}</Badge>
                    </div>
                    <div className="mt-3 text-[11px] text-muted-foreground font-mono space-y-1">
                      <div>{t("runs.commandTarget", { id: command.taskId.slice(0, 8) })}</div>
                      <div>{formatDateTime(command.requestedAt)}</div>
                      <div>{command.resolvedAt ? t("runs.resolvedAt", { time: formatDateTime(command.resolvedAt) }) : t("runs.pendingResolution")}</div>
                    </div>
                    {command.note ? <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-3">{command.note}</p> : null}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card/20 backdrop-blur-md shadow-sm overflow-hidden rounded-2xl">
        <CardHeader className="border-b border-border bg-secondary/15 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold text-foreground">{t("runs.taskRunList")}</CardTitle>
            <CardDescription className="text-xs">{t("runs.taskRunListDescription")}</CardDescription>
          </div>

          <div className="flex bg-secondary/80 p-1 rounded-xl border border-border/40 select-none w-fit shrink-0">
            <button
              onClick={() => onStatusFilterChange("all")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("runs.filterAll")}
            </button>
            <button
              onClick={() => onStatusFilterChange("running")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "running" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("runs.filterRunning")}
            </button>
            <button
              onClick={() => onStatusFilterChange("passed")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "passed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("runs.filterPassed")}
            </button>
            <button
              onClick={() => onStatusFilterChange("failed")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "failed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("runs.filterFailed")}
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          {filteredTaskRuns.length === 0 ? (
            <EmptyState description={t("runs.noTaskRunsDescription")} title={t("runs.noTaskRunsTitle")} />
          ) : (
            filteredTaskRuns.map(({ taskRun, currentRun }) => {
              const currentCase = currentRun ? runCaseMap.get(currentRun.testCaseId) : null
              const task = taskMap.get(taskRun.taskId)
              const isAwaitingHuman = currentRun?.status === "awaiting_human"
              const isTaskRunning = taskRun.status === "running" || taskRun.status === "queued"
              const total = taskRun.totalCount || 1
              const passedPct = ((taskRun.passedCount || 0) / total) * 100
              const failedPct = ((taskRun.failedCount || 0) / total) * 100
              const runningPct = ((taskRun.runningCount || 0) / total) * 100
              const queuedPct = ((taskRun.queuedCount || 0) / total) * 100

              return (
                <button
                  className={`w-full rounded-2xl border text-left p-5 transition-all duration-300 cursor-pointer flex flex-col space-y-4 ${
                    taskRun.id === activeTaskRunId
                      ? "border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.05)]"
                      : "border-border/60 bg-secondary/15 hover:bg-secondary/40 hover:-translate-y-0.5 hover:shadow-md"
                  } ${isTaskRunning ? "ring-1 ring-primary/20" : ""}`}
                  key={taskRun.id}
                  onClick={() => onOpenTask(taskRun.id, currentRun)}
                  type="button"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="font-mono text-sm tracking-wide text-foreground">#{taskRun.id.slice(0, 8)}</strong>
                        <Badge tone={taskRun.status === "passed" ? "success" : taskRun.status === "failed" ? "danger" : "warning"}>
                          {translateStatus(taskRun.status)}
                        </Badge>
                        {isAwaitingHuman ? (
                          <Badge tone="warning" className="animate-pulse">{t("runs.awaitingHumanInput")}</Badge>
                        ) : null}
                        {isTaskRunning ? (
                          <span className="flex size-2 rounded-full bg-primary animate-ping" />
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground font-semibold">
                        {task ? task.name : taskRun.taskId}
                      </p>
                    </div>

                    <div className="text-right text-[11px] text-muted-foreground font-mono">
                      <p>{formatDateTime(taskRun.startedAt)}</p>
                      <p className="mt-0.5 font-sans font-medium text-foreground/80">
                        {taskRun.finishedAt ? t("runs.elapsed", { duration: formatDuration(taskRun.startedAt, taskRun.finishedAt) }) : t("runs.inProgress")}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 w-full">
                    <div className="flex justify-between items-center text-xs font-semibold">
                      <span className="text-foreground">
                        {t("runs.casesPassedRatio", { passed: taskRun.passedCount, total: taskRun.totalCount })}
                      </span>
                      <span className="text-muted-foreground text-[11px]">
                        {t("runs.progressPercent", { percent: Math.round(((taskRun.passedCount + taskRun.failedCount) / total) * 100) })}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-secondary rounded-full overflow-hidden flex shadow-inner">
                      {taskRun.passedCount > 0 && <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${passedPct}%` }} title={t("runs.passedTooltip", { count: taskRun.passedCount })} />}
                      {taskRun.failedCount > 0 && <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${failedPct}%` }} title={t("runs.failedTooltip", { count: taskRun.failedCount })} />}
                      {taskRun.runningCount > 0 && <div className="bg-primary h-full animate-pulse transition-all duration-300" style={{ width: `${runningPct}%` }} title={t("runs.runningTooltip", { count: taskRun.runningCount })} />}
                      {taskRun.queuedCount > 0 && <div className="bg-muted-foreground/30 h-full transition-all duration-300" style={{ width: `${queuedPct}%` }} title={t("runs.queuedTooltip", { count: taskRun.queuedCount })} />}
                    </div>
                  </div>

                  <div className="w-full grid gap-3 md:grid-cols-[1fr_auto] items-end border-t border-border/30 pt-3">
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {currentCase ? (
                        <p className="text-foreground font-medium flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-primary">play_arrow</span>
                          {t("runs.currentRunLabel")}<span className="font-mono text-primary font-bold bg-primary/5 border border-primary/10 px-1.5 py-0.5 rounded">{currentCase.caseCode}</span>
                          <span className="truncate max-w-[200px] sm:max-w-[400px]">{t("runs.parenthesized", { text: currentCase.purpose })}</span>
                        </p>
                      ) : taskRun.currentRunId ? (
                        <p className="text-foreground">{t("runs.currentSubTask", { id: taskRun.currentRunId.slice(0, 8) })}</p>
                      ) : (
                        <p className="italic text-muted-foreground/80">{t("runs.noActiveSubRun")}</p>
                      )}
                      <p className="text-[11px] opacity-90 line-clamp-1 italic font-mono mt-1 bg-black/5 dark:bg-black/25 px-2 py-1 rounded border border-border/20">
                        {taskRun.logs.at(-1) ?? t("runs.awaitingFeedback")}
                      </p>
                    </div>

                    <div className="flex gap-2.5 text-[10px] font-mono text-muted-foreground/80 shrink-0">
                      <span className="bg-secondary/40 border border-border/20 px-2 py-0.5 rounded">{t("runs.queuedChip", { count: taskRun.queuedCount })}</span>
                      <span className="bg-primary/5 text-primary border border-primary/10 px-2 py-0.5 rounded">{t("runs.runningChip", { count: taskRun.runningCount })}</span>
                      <span className="bg-rose-500/5 text-rose-600 border border-rose-500/10 px-2 py-0.5 rounded">{t("runs.failedChip", { count: taskRun.failedCount })}</span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}