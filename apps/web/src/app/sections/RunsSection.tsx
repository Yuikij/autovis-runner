import { useEffect, useMemo, useState } from "react"

import type { ExecutionStep, ExecutionRun } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { BrowserFrame } from "../components/browser-frame"
import { LogPanel } from "../components/log-panel"
import { PageHeader } from "../components/page-header"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { inputClassName } from "../components/ui/field"
import { EmptyState } from "../components/empty-state"
import { TaskControlBar } from "../components/TaskControlBar"
import { formatDateTime, formatDuration, resolveUrl, translateArtifactKind, translateStatus } from "../utils"

type RunsSectionProps = {
  controller: ReadyWorkspaceController
}

const translateRunPhase = (phase?: ExecutionRun["orchestrationPhase"]) => {
  if (phase === "preconditions") return "前置依赖中"
  if (phase === "target") return "目标脚本中"
  if (phase === "archive") return "归档中"
  return "未分阶段"
}

export function RunsSection({ controller }: RunsSectionProps) {
  const {
    busy,
    tasks,
    selectedProject,
    projectRuns,
    taskRuns,
    activeRun,
    activeTaskRun,
    allCases,
    submitRunHumanInput,
    setActiveRun,
    setActiveTaskRunId,
    clearRuns,
  } = controller

  const [viewMode, setViewMode] = useState<"list" | "detail">("list")
  const [humanInputValue, setHumanInputValue] = useState("")
  
  // Custom view states for RunsSection
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "passed" | "failed">("all")
  const [detailTab, setDetailTab] = useState<"steps" | "logs" | "meta">("steps")
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const runCaseMap = useMemo(() => new Map(allCases.map((item) => [item.id, item])), [allCases])
  const taskMap = useMemo(() => new Map(tasks.map((item) => [item.id, item])), [tasks])
  const executionRuns = useMemo(() => projectRuns.filter((run) => run.kind !== "verification"), [projectRuns])
  const taskRunsWithCurrentRun = useMemo(() => {
    return taskRuns.map((taskRun) => ({
      taskRun,
      currentRun: taskRun.currentRunId ? executionRuns.find((run) => run.id === taskRun.currentRunId) ?? null : null,
    }))
  }, [taskRuns, executionRuns])

  // Filter task runs based on selected status tab
  const filteredTaskRuns = useMemo(() => {
    return taskRunsWithCurrentRun.filter(({ taskRun }) => {
      if (statusFilter === "all") return true
      if (statusFilter === "running") return taskRun.status === "running" || taskRun.status === "queued"
      if (statusFilter === "passed") return taskRun.status === "passed"
      if (statusFilter === "failed") return taskRun.status === "failed"
      return true
    })
  }, [taskRunsWithCurrentRun, statusFilter])

  const currentTaskRuns = useMemo(() => {
    if (!activeTaskRun) {
      return activeRun ? [activeRun] : []
    }
    return executionRuns
      .filter((run) => run.taskRunId === activeTaskRun.id)
      .sort((left, right) => {
        const leftOrder = left.batchOrder ?? Number.MAX_SAFE_INTEGER
        const rightOrder = right.batchOrder ?? Number.MAX_SAFE_INTEGER
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder
        }
        return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
      })
  }, [executionRuns, activeRun, activeTaskRun])

  const executionActiveRun = useMemo(() => (activeRun?.kind === "execution" ? activeRun : activeRun?.kind === "temporary" ? activeRun : null), [activeRun])
  const executionReplayVideo = useMemo(
    () => executionActiveRun?.artifacts.find((artifact) => artifact.kind === "video")?.url,
    [executionActiveRun?.artifacts],
  )
  const executionPassCount = useMemo(() => executionRuns.filter((run) => run.status === "passed").length, [executionRuns])
  const executionFailCount = useMemo(() => executionRuns.filter((run) => run.status === "failed").length, [executionRuns])
  const hasActiveExecution = useMemo(
    () => executionRuns.some((run) => run.status === "queued" || run.status === "running" || run.status === "awaiting_human"),
    [executionRuns],
  )
  const awaitingHumanRun = useMemo(() => executionActiveRun?.status === "awaiting_human" ? executionActiveRun : null, [executionActiveRun])
  const currentCase = executionActiveRun ? runCaseMap.get(executionActiveRun.testCaseId) : null

  const [lastActiveRunId, setLastActiveRunId] = useState<string | null>(null)
  const [lastActiveTaskRunId, setLastActiveTaskRunId] = useState<string | null>(null)

  useEffect(() => {
    if (activeRun && activeRun.id !== lastActiveRunId) {
      setViewMode("detail")
      setLastActiveRunId(activeRun.id)
    }
    if (activeTaskRun && activeTaskRun.id !== lastActiveTaskRunId) {
      setViewMode("detail")
      setLastActiveTaskRunId(activeTaskRun.id)
    }
  }, [activeRun?.id, activeTaskRun?.id, lastActiveRunId, lastActiveTaskRunId])

  useEffect(() => {
    if (executionActiveRun?.status === "running" || executionActiveRun?.status === "queued" || executionActiveRun?.status === "awaiting_human" || activeTaskRun?.status === "running") {
      setViewMode("detail")
    }
  }, [executionActiveRun?.status, activeTaskRun?.status, executionActiveRun?.id, activeTaskRun?.id])

  useEffect(() => {
    setHumanInputValue("")
  }, [awaitingHumanRun?.id, awaitingHumanRun?.pendingHumanHandoff?.id])

  const handleOpenTask = (taskRunId: string, run?: ExecutionRun | null) => {
    setActiveTaskRunId(taskRunId)
    if (run) {
      setActiveRun(run)
    }
    setViewMode("detail")
  }

  const groupedSteps = useMemo(() => {
    if (!executionActiveRun?.steps) return []
    const groups: { parent: ExecutionStep, children: ExecutionStep[] }[] = []
    
    for (const step of executionActiveRun.steps) {
      if (step.kind === "business_step") {
        if (groups.length > 0) {
          groups[groups.length - 1].children.push(step)
        } else {
          groups.push({ parent: step, children: [] })
        }
      } else {
        groups.push({ parent: step, children: [] })
      }
    }
    return groups
  }, [executionActiveRun?.steps])

  if (viewMode === "list") {
    return (
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          eyebrow="Execution Center"
          title="执行记录"
          description="查看每个任务执行的当前进度、人工输入状态和子运行明细。任务可在「任务」页发起。"
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {taskRuns.length > 0 ? (
                <Button 
                  disabled={busy || hasActiveExecution} 
                  onClick={() => clearRuns(selectedProject.id)} 
                  variant="ghost"
                  className="rounded-xl border border-border hover:bg-secondary/60 text-xs h-9 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">delete_sweep</span>
                  清空已完成历史
                </Button>
              ) : null}
            </div>
          }
        />

        {/* Modern Statistics Section */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-15 text-primary">
              <span className="material-symbols-outlined text-5xl">task</span>
            </div>
            <CardContent className="space-y-1 py-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">执行任务数</p>
              <strong className="text-3xl font-bold text-foreground font-mono">{taskRuns.length}</strong>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-15 text-indigo-500">
              <span className="material-symbols-outlined text-5xl">deployed_code</span>
            </div>
            <CardContent className="space-y-1 py-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">子运行数</p>
              <strong className="text-3xl font-bold text-foreground font-mono">{executionRuns.length}</strong>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-15 text-emerald-500">
              <span className="material-symbols-outlined text-5xl">check_circle</span>
            </div>
            <CardContent className="space-y-1 py-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">成功子运行</p>
              <strong className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{executionPassCount}</strong>
            </CardContent>
          </Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-sm relative overflow-hidden group hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 right-0 p-3 opacity-15 text-rose-500">
              <span className="material-symbols-outlined text-5xl">cancel</span>
            </div>
            <CardContent className="space-y-1 py-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">失败子运行</p>
              <strong className="text-3xl font-bold text-rose-600 dark:text-rose-450 font-mono">{executionFailCount}</strong>
            </CardContent>
          </Card>
        </div>

        {/* Task List Workspace */}
        <Card className="border-border bg-card/20 backdrop-blur-md shadow-sm overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-border bg-secondary/15 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-foreground">执行任务列表</CardTitle>
              <CardDescription className="text-xs">每条记录代表一次完整的任务执行。</CardDescription>
            </div>
            
            {/* Status Segmented Filter */}
            <div className="flex bg-secondary/80 p-1 rounded-xl border border-border/40 select-none w-fit shrink-0">
              <button
                onClick={() => setStatusFilter("all")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                全部
              </button>
              <button
                onClick={() => setStatusFilter("running")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "running" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                运行中
              </button>
              <button
                onClick={() => setStatusFilter("passed")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "passed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                通过
              </button>
              <button
                onClick={() => setStatusFilter("failed")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${statusFilter === "failed" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                失败
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {filteredTaskRuns.length === 0 ? (
              <EmptyState description="未找到符合筛选条件的执行任务或暂无数据。" title="暂无任务记录" />
            ) : (
              filteredTaskRuns.map(({ taskRun, currentRun }) => {
                const currentCase = currentRun ? runCaseMap.get(currentRun.testCaseId) : null
                const task = taskMap.get(taskRun.taskId)
                const isAwaitingHuman = currentRun?.status === "awaiting_human"
                const isTaskRunning = taskRun.status === "running" || taskRun.status === "queued"
                
                // Calculating progress bar percentages
                const total = taskRun.totalCount || 1
                const passedPct = ((taskRun.passedCount || 0) / total) * 100
                const failedPct = ((taskRun.failedCount || 0) / total) * 100
                const runningPct = ((taskRun.runningCount || 0) / total) * 100
                const queuedPct = ((taskRun.queuedCount || 0) / total) * 100

                return (
                  <button
                    className={`w-full rounded-2xl border text-left p-5 transition-all duration-300 cursor-pointer flex flex-col space-y-4 ${
                      taskRun.id === activeTaskRun?.id
                        ? "border-primary/50 bg-primary/10 shadow-[0_0_15px_rgba(var(--primary),0.05)]"
                        : "border-border/60 bg-secondary/15 hover:bg-secondary/40 hover:-translate-y-0.5 hover:shadow-md"
                    } ${isTaskRunning ? "ring-1 ring-primary/20" : ""}`}
                    key={taskRun.id}
                    onClick={() => handleOpenTask(taskRun.id, currentRun)}
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
                            <Badge tone="warning" className="animate-pulse">等待人工输入</Badge>
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
                          {taskRun.finishedAt ? `耗时: ${formatDuration(taskRun.startedAt, taskRun.finishedAt)}` : "进行中…"}
                        </p>
                      </div>
                    </div>

                    {/* Highly Visual Case Status Bar */}
                    <div className="space-y-1.5 w-full">
                      <div className="flex justify-between items-center text-xs font-semibold">
                        <span className="text-foreground">
                          {taskRun.passedCount}/{taskRun.totalCount} 用例通过
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          进度: {Math.round(((taskRun.passedCount + taskRun.failedCount) / total) * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-secondary rounded-full overflow-hidden flex shadow-inner">
                        {taskRun.passedCount > 0 && <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${passedPct}%` }} title={`通过: ${taskRun.passedCount}`} />}
                        {taskRun.failedCount > 0 && <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${failedPct}%` }} title={`失败: ${taskRun.failedCount}`} />}
                        {taskRun.runningCount > 0 && <div className="bg-primary h-full animate-pulse transition-all duration-300" style={{ width: `${runningPct}%` }} title={`运行中: ${taskRun.runningCount}`} />}
                        {taskRun.queuedCount > 0 && <div className="bg-muted-foreground/30 h-full transition-all duration-300" style={{ width: `${queuedPct}%` }} title={`排队中: ${taskRun.queuedCount}`} />}
                      </div>
                    </div>

                    <div className="w-full grid gap-3 md:grid-cols-[1fr_auto] items-end border-t border-border/30 pt-3">
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {currentCase ? (
                          <p className="text-foreground font-medium flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px] text-primary">play_arrow</span>
                            当前运行：<span className="font-mono text-primary font-bold bg-primary/5 border border-primary/10 px-1.5 py-0.5 rounded">{currentCase.caseCode}</span>
                            <span className="truncate max-w-[200px] sm:max-w-[400px]">（{currentCase.purpose}）</span>
                          </p>
                        ) : taskRun.currentRunId ? (
                          <p className="text-foreground">当前运行子任务：{taskRun.currentRunId.slice(0, 8)}</p>
                        ) : (
                          <p className="italic text-muted-foreground/80">已结束或未开始子运行</p>
                        )}
                        <p className="text-[11px] opacity-90 line-clamp-1 italic font-mono mt-1 bg-black/5 dark:bg-black/25 px-2 py-1 rounded border border-border/20">
                          {taskRun.logs.at(-1) ?? "等待执行反馈。"}
                        </p>
                      </div>
                      
                      <div className="flex gap-2.5 text-[10px] font-mono text-muted-foreground/80 shrink-0">
                        <span className="bg-secondary/40 border border-border/20 px-2 py-0.5 rounded">排队 {taskRun.queuedCount}</span>
                        <span className="bg-primary/5 text-primary border border-primary/10 px-2 py-0.5 rounded">运行 {taskRun.runningCount}</span>
                        <span className="bg-rose-500/5 text-rose-600 border border-rose-500/10 px-2 py-0.5 rounded">失败 {taskRun.failedCount}</span>
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

  // viewMode === "detail" (AI Workbench style layout)
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top breadcrumbs and controls section */}
      <div className="flex flex-col gap-4 border-b border-border/40 pb-4 md:flex-row md:items-center md:justify-between select-none">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors" onClick={() => setViewMode("list")}>执行记录</span>
          <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
          <span className="font-mono bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/40 font-semibold text-[10px]">
            任务 #{activeTaskRun?.id.slice(0, 8) || activeRun?.id.slice(0, 8)}
          </span>
          {currentCase && (
            <>
              <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
              <span className="font-mono bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20 font-semibold text-[10px]">
                {currentCase.caseCode}
              </span>
              <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
              <span className="truncate text-foreground font-medium max-w-[200px] sm:max-w-[400px]">
                {currentCase.purpose}
              </span>
            </>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {activeTaskRun ? <Badge>{taskMap.get(activeTaskRun.taskId)?.name ?? activeTaskRun.taskId.slice(0, 8)}</Badge> : null}
          {activeTaskRun ? (
            <Badge tone={activeTaskRun.status === "passed" ? "success" : activeTaskRun.status === "failed" ? "danger" : "warning"}>
              {translateStatus(activeTaskRun.status)}
            </Badge>
          ) : null}
          {executionActiveRun ? (
            <Badge tone={executionActiveRun.status === "passed" ? "success" : executionActiveRun.status === "failed" ? "danger" : "warning"}>
              {translateStatus(executionActiveRun.status)}
            </Badge>
          ) : null}
          
          {activeTaskRun?.id ? (
            <TaskControlBar kind="task-run" id={activeTaskRun.id} status={activeTaskRun.status} />
          ) : executionActiveRun?.id ? (
            <TaskControlBar kind="run" id={executionActiveRun.id} status={executionActiveRun.status} />
          ) : null}
          
          <Button onClick={() => setViewMode("list")} variant="ghost" className="h-8 rounded-lg text-xs flex items-center gap-1 cursor-pointer">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            返回任务列表
          </Button>
        </div>
      </div>

      {/* Task Summary Cards (only visible in details view) */}
      {activeTaskRun ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <Card className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4"><span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">总用例</span><strong className="text-xl font-bold text-foreground font-mono mt-0.5 block">{activeTaskRun.totalCount}</strong></Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4"><span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">已通过</span><strong className="text-xl font-bold text-emerald-600 dark:text-emerald-450 font-mono mt-0.5 block">{activeTaskRun.passedCount}</strong></Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4"><span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">已失败</span><strong className="text-xl font-bold text-rose-600 dark:text-rose-405 font-mono mt-0.5 block">{activeTaskRun.failedCount}</strong></Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4"><span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">排队中</span><strong className="text-xl font-bold text-foreground font-mono mt-0.5 block">{activeTaskRun.queuedCount}</strong></Card>
          <Card className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4"><span className="text-[10px] font-bold text-primary uppercase tracking-wider block">当前运行</span><strong className="text-xs font-bold text-primary mt-1.5 block truncate max-w-[120px]" title={currentCase ? currentCase.caseCode : activeTaskRun.currentRunId ?? "--"}>{currentCase ? currentCase.caseCode : activeTaskRun.currentRunId ?? "--"}</strong></Card>
        </div>
      ) : null}

      {/* Main Dual Column Workbench Grid */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] items-start">
        {/* Left Column: Sub-runs Navigator */}
        <div className="flex flex-col border border-border bg-card/60 backdrop-blur-md rounded-2xl p-4 space-y-3 sticky top-4 max-h-[calc(100vh-14rem)] overflow-y-auto custom-scrollbar shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-border/40">
            <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">用例运行队列</span>
            <Badge tone="default">{currentTaskRuns.length} 个子运行</Badge>
          </div>
          
          {currentTaskRuns.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">暂无运行数据</p>
          ) : (
            <div className="space-y-2">
              {currentTaskRuns.map((run) => {
                const isSelected = run.id === executionActiveRun?.id
                const caseObj = runCaseMap.get(run.testCaseId)
                const runStatus = run.status
                
                let statusColor = "bg-slate-400"
                let statusIcon = "schedule"
                let pulseClass = ""
                
                if (runStatus === "passed") {
                  statusColor = "bg-emerald-500"
                  statusIcon = "check_circle"
                } else if (runStatus === "failed") {
                  statusColor = "bg-rose-500"
                  statusIcon = "cancel"
                  pulseClass = "animate-pulse text-rose-500"
                } else if (runStatus === "running" || runStatus === "queued") {
                  statusColor = "bg-primary"
                  statusIcon = "hourglass_top"
                  pulseClass = "animate-pulse text-primary"
                } else if (runStatus === "awaiting_human") {
                  statusColor = "bg-amber-500"
                  statusIcon = "person"
                  pulseClass = "animate-bounce text-amber-500"
                }

                return (
                  <button
                    key={run.id}
                    onClick={() => setActiveRun(run)}
                    type="button"
                    className={`w-full text-left rounded-xl p-3 border transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary),0.05)]"
                        : "border-border/60 bg-secondary/15 hover:bg-secondary/40 hover:border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-foreground">
                        {caseObj ? caseObj.caseCode : run.id.slice(0, 8)}
                      </span>
                      <span className={`material-symbols-outlined text-[16px] text-muted-foreground ${pulseClass} ${runStatus === "passed" ? "text-emerald-500" : runStatus === "failed" ? "text-rose-500" : runStatus === "running" ? "text-primary" : runStatus === "awaiting_human" ? "text-amber-500" : ""}`}>
                        {statusIcon}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2" title={caseObj ? caseObj.purpose : run.testCaseId}>
                      {caseObj ? caseObj.purpose : run.testCaseId}
                    </p>
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground/80 mt-2 border-t border-border/20 pt-1.5 font-mono">
                      <span>{formatDateTime(run.startedAt).slice(11, 19)}</span>
                      <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Detail Workspace */}
        <div className="flex flex-col border border-border bg-card/25 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm">
          {/* Workspace Tab Bar Selector */}
          <div className="flex border-b border-border bg-secondary/10 px-4 py-2 justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border/40 select-none">
              <button
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "steps" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setDetailTab("steps")}
                type="button"
              >
                执行步骤
              </button>
              <button
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "logs" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setDetailTab("logs")}
                type="button"
              >
                系统日志
              </button>
              <button
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "meta" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setDetailTab("meta")}
                type="button"
              >
                产物与诊断
              </button>
            </div>
          </div>

          {/* Interactive Handoff Notification overlay */}
          {awaitingHumanRun?.pendingHumanHandoff && (
            <div className="bg-amber-500/10 border-b border-amber-500/30 backdrop-blur-sm p-5 shadow-inner animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-start gap-4">
                <span className="material-symbols-outlined text-amber-500 text-3xl animate-bounce mt-0.5">smart_toy</span>
                <div className="flex-1 space-y-3">
                  <div>
                    <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400">等待人工介入 (Manual Interaction Needed)</h4>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {awaitingHumanRun.pendingHumanHandoff.scope === "precondition" ? "前置依赖执行中" : "目标脚本执行中"}：
                      <span className="text-foreground font-semibold ml-1">{awaitingHumanRun.pendingHumanHandoff.instruction}</span>
                    </p>
                  </div>
                  
                  {(awaitingHumanRun.pendingHumanHandoff.imageUrl ?? awaitingHumanRun.currentViewport) && (
                    <div className="overflow-hidden rounded-xl border border-border/60 max-w-md bg-slate-100 dark:bg-black/20">
                      <img
                        alt={awaitingHumanRun.pendingHumanHandoff.inputLabel ?? "人工输入参考图"}
                        className="max-h-56 w-full object-contain cursor-zoom-in hover:brightness-105 transition-all"
                        src={resolveUrl(awaitingHumanRun.pendingHumanHandoff.imageUrl ?? awaitingHumanRun.currentViewport)}
                        onClick={() => setLightboxUrl(resolveUrl(awaitingHumanRun.pendingHumanHandoff!.imageUrl ?? awaitingHumanRun.currentViewport))}
                      />
                    </div>
                  )}
                  
                  <div className="flex gap-2 max-w-md">
                    <input
                      className={`${inputClassName} text-xs flex-1 bg-background border-border/60 rounded-xl px-3 py-1.5 focus:border-amber-500 focus:ring-amber-500`}
                      onChange={(event) => setHumanInputValue(event.target.value)}
                      placeholder={awaitingHumanRun.pendingHumanHandoff.placeholder ?? awaitingHumanRun.pendingHumanHandoff.inputLabel ?? "请输入内容"}
                      value={humanInputValue}
                    />
                    <Button
                      className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-600 text-white border-0 text-xs font-bold px-4 shrink-0 shadow-sm"
                      disabled={busy || !humanInputValue.trim()}
                      onClick={async () => {
                        await submitRunHumanInput(awaitingHumanRun.id, awaitingHumanRun.pendingHumanHandoff!.id, humanInputValue)
                        setHumanInputValue("")
                      }}
                    >
                      {awaitingHumanRun.pendingHumanHandoff.confirmText ?? "确定并继续"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Workbench main workspace panel */}
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] border-t border-border min-h-[38rem] bg-slate-100/30 dark:bg-slate-950/10">
            
            {/* Left Screen Pane: Browser frame viewer */}
            <div className="p-4 border-r border-border/60 flex flex-col justify-between space-y-4">
              <BrowserFrame
                noCard
                emptyText="执行测试后，此窗口将实时展示 Playwright 画面。"
                title="实时浏览器回放"
                url={executionActiveRun?.testBaseUrl || activeTaskRun?.testBaseUrl || "--"}
                viewport={executionActiveRun?.currentViewport}
                replayVideoUrl={executionReplayVideo}
                liveViewport={executionActiveRun?.liveViewport}
                className="w-full h-full flex flex-col bg-transparent border-0 shadow-none"
                contentClassName="flex-1 min-h-[25rem] flex items-center justify-center p-0 bg-transparent"
                imageClassName="max-h-[28rem] w-full object-contain"
              />
            </div>

            {/* Right Screen Pane: Tab Content */}
            <div className="p-5 overflow-y-auto max-h-[42rem] custom-scrollbar flex flex-col space-y-4 bg-background/40 backdrop-blur-sm">
              
              {/* Timeline Steps View Tab */}
              {detailTab === "steps" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">流水线步骤明细</span>
                    {executionActiveRun ? (
                      <Badge tone={executionActiveRun.status === "passed" ? "success" : executionActiveRun.status === "failed" ? "danger" : "warning"}>
                        {translateStatus(executionActiveRun.status)}
                      </Badge>
                    ) : null}
                  </div>

                  {groupedSteps.length > 0 ? (
                    <div className="py-2 pr-2 relative">
                      {/* Vertical timeline track line */}
                      <div className="absolute left-[19px] top-6 bottom-6 w-px bg-border/80 dark:bg-white/10" />
                      
                      <div className="space-y-6 relative">
                        {groupedSteps.map(({ parent, children }) => {
                          const isRunning = parent.status === "running"
                          const isPassed = parent.status === "passed"
                          const isFailed = parent.status === "failed"
                          
                          let dotColor = "bg-muted border-border text-muted-foreground"
                          if (isRunning) dotColor = "bg-primary border-primary text-primary-foreground animate-pulse shadow-[0_0_10px_rgba(var(--primary),0.5)]"
                          if (isPassed) dotColor = "bg-emerald-500 border-emerald-500 text-white"
                          if (isFailed) dotColor = "bg-rose-500 border-rose-500 text-white"

                          return (
                            <div key={parent.id} className="relative pl-10 group">
                              {/* Step Dot */}
                              <div className={`absolute left-0 top-1.5 flex h-10 w-10 items-center justify-center rounded-full border-4 border-background z-10 transition-colors ${dotColor}`}>
                                <span className="material-symbols-outlined text-[16px]">
                                  {isRunning ? "hourglass_top" : isPassed ? "check" : isFailed ? "close" : "schedule"}
                                </span>
                              </div>
                              
                              {/* Card Content Box */}
                              <div className={`rounded-xl border p-4 transition-all duration-300 ${isRunning ? "border-primary/50 bg-primary/5 shadow-[0_0_15px_rgba(var(--primary),0.03)]" : "border-border/50 bg-card group-hover:border-border"}`}>
                                <div className="flex items-center justify-between gap-3 mb-1">
                                  <strong className={`text-xs ${isRunning ? "text-primary font-bold" : "text-foreground"}`}>{parent.title}</strong>
                                  <Badge tone={parent.status === "passed" ? "success" : parent.status === "failed" ? "danger" : "warning"} className="scale-90 origin-top-right">
                                    {translateStatus(parent.status)}
                                  </Badge>
                                </div>
                                
                                {parent.log && <p className="text-xs text-muted-foreground leading-relaxed font-sans mt-1">{parent.log}</p>}
                                
                                {/* Image thumbnail inside step, zoom on click */}
                                {parent.screenshotUrl && (
                                  <div 
                                    className="mt-3 relative rounded-lg overflow-hidden border border-border/50 group max-w-[200px] aspect-[16/10] bg-black/10 cursor-zoom-in shadow-sm hover:border-primary/50 transition-colors"
                                    onClick={() => setLightboxUrl(parent.screenshotUrl!)}
                                  >
                                    <img
                                      src={resolveUrl(parent.screenshotUrl)}
                                      alt={parent.title}
                                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                                      <span className="material-symbols-outlined text-white text-base">zoom_in</span>
                                    </div>
                                  </div>
                                )}

                                {children.length > 0 && (
                                  <div className="mt-3 pl-3 border-l-2 border-border/50 space-y-3">
                                    {children.map(child => {
                                      const cIsRunning = child.status === "running"
                                      const cIsPassed = child.status === "passed"
                                      const cIsFailed = child.status === "failed"
                                      return (
                                        <div key={child.id} className="relative flex items-start gap-2.5 p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-secondary/40">
                                          <div className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${cIsRunning ? "bg-primary animate-ping" : cIsPassed ? "bg-emerald-500" : cIsFailed ? "bg-rose-500" : "bg-muted-foreground/30"}`} />
                                          <div className="flex-1 min-w-0">
                                            <p className={`text-xs ${cIsRunning ? "text-primary font-medium" : "text-foreground"}`}>{child.title}</p>
                                            {child.log && <p className="text-[10px] text-muted-foreground mt-0.5 font-sans opacity-80">{child.log}</p>}
                                            {child.screenshotUrl && (
                                              <div 
                                                className="mt-2 relative rounded overflow-hidden border border-border/50 group max-w-[120px] aspect-[16/10] bg-black/10 cursor-zoom-in shadow-sm hover:border-primary/50 transition-colors"
                                                onClick={() => setLightboxUrl(child.screenshotUrl!)}
                                              >
                                                <img
                                                  src={resolveUrl(child.screenshotUrl)}
                                                  alt={child.title}
                                                  className="w-full h-full object-cover"
                                                />
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <EmptyState description="开始执行后，这里会显示当前子运行的层级步骤和状态变化。" title="无步骤数据" />
                  )}
                </div>
              )}

              {/* Console Logs Tab */}
              {detailTab === "logs" && (
                <div className="h-full flex flex-col space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">系统日志输出 (STDOUT)</span>
                  </div>
                  <LogPanel 
                    noCard 
                    content={executionActiveRun?.logs.join("\n") || activeTaskRun?.logs.join("\n") || "无输出日志"} 
                    title="日志输出"
                    className="h-[32rem] border border-border/80 bg-black/95 dark:bg-black/95 rounded-xl font-mono text-xs leading-relaxed text-emerald-400 p-4 shadow-inner"
                  />
                </div>
              )}

              {/* Diagnosis and Artifacts Download Tab */}
              {detailTab === "meta" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">运行诊断与产物</span>
                  </div>

                  {executionActiveRun ? (
                    <Card className="border-border bg-card/65 shadow-md rounded-xl overflow-hidden">
                      <CardHeader className="pb-3 border-b border-border/40 bg-secondary/10">
                        <CardTitle className="text-xs font-bold text-foreground">当前运行元数据</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4 text-xs space-y-3">
                        <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                          <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">开始时间</span><span className="font-semibold text-foreground mt-0.5">{formatDateTime(executionActiveRun.startedAt)}</span></div>
                          <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">运行时长</span><span className="font-semibold text-foreground mt-0.5">{formatDuration(executionActiveRun.startedAt, executionActiveRun.finishedAt)}</span></div>
                          <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">状态</span><span className="font-semibold text-foreground mt-0.5">{translateStatus(executionActiveRun.status)}</span></div>
                          <div className="flex flex-col"><span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">执行阶段</span><span className="font-semibold text-foreground mt-0.5">{translateRunPhase(executionActiveRun.orchestrationPhase)}</span></div>
                        </div>
                        {executionActiveRun.preconditionSummary?.length ? (
                          <div className="mt-2 pt-2 border-t border-border/30">
                            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide block mb-1">前置依赖</span>
                            <p className="text-foreground leading-relaxed font-medium">{executionActiveRun.preconditionSummary.join("、")}</p>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  ) : null}

                  {/* AI intelligent repair block */}
                  {executionActiveRun?.status === "failed" && (
                    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3 shadow-sm animate-fade-in">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-rose-500">auto_fix_high</span>
                        <strong className="text-xs font-semibold text-foreground">脚本执行失败！建议使用 AI 诊断与修复</strong>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed font-sans">
                        智能体可以在您的代码库中自动定位报错脚本、匹配报错日志、分析 DOM 快照，并修复异常的指令与 Selector 路径。
                      </p>
                      <Button
                        onClick={() => {
                          controller.repairScriptRun(executionActiveRun.id)
                          controller.setActiveSection("workbench")
                        }}
                        className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-750 hover:to-indigo-750 text-white shadow-md border-0 py-2.5 rounded-xl transition duration-200 cursor-pointer font-semibold text-xs"
                      >
                        <span className="material-symbols-outlined text-sm animate-pulse">auto_fix_high</span>
                        一键进行 AI 智能修复
                      </Button>
                    </div>
                  )}

                  {/* Download artifacts list */}
                  <div className="space-y-3">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">下载执行产物 ({executionActiveRun?.artifacts.length ?? 0})</div>
                    {executionActiveRun?.artifacts.length ? (
                      <div className="grid gap-2.5">
                        {executionActiveRun.artifacts.map((artifact) => {
                          let artifactIcon = "file_present"
                          if (artifact.kind === "video") artifactIcon = "videocam"
                          if (artifact.kind === "trace") artifactIcon = "analytics"
                          if (artifact.kind === "screenshot") artifactIcon = "image"
                          
                          return (
                            <a 
                              className="flex items-center justify-between rounded-xl border border-border/80 bg-card hover:bg-secondary/40 px-4 py-3 text-xs transition hover:shadow-sm" 
                              href={resolveUrl(artifact.url)} 
                              key={artifact.name} 
                              rel="noreferrer" 
                              target="_blank"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="material-symbols-outlined text-primary text-base shrink-0">{artifactIcon}</span>
                                <div className="truncate text-left">
                                  <p className="font-semibold text-foreground">{translateArtifactKind(artifact.kind)}</p>
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[200px] mt-0.5">{artifact.name}</p>
                                </div>
                              </div>
                              <span className="material-symbols-outlined text-muted-foreground text-sm shrink-0">download</span>
                            </a>
                          )
                        })}
                      </div>
                    ) : (
                      <EmptyState description="执行完成后，这里会显示 trace、video、截图等产物。" title="未产生任何产物" />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox full-screen modal overlay */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200"
          onClick={() => setLightboxUrl(null)}
        >
          <img 
            src={lightboxUrl} 
            alt="Screenshot detail view" 
            className="max-w-full max-h-[95vh] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] object-contain border border-white/10" 
          />
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-3 rounded-full cursor-pointer transition-all hover:scale-110"
            onClick={() => setLightboxUrl(null)}
          >
            <span className="material-symbols-outlined text-2xl drop-shadow-md">close</span>
          </button>
        </div>
      )}
    </div>
  )
}
