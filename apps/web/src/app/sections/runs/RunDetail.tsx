import type { ExecutionRun, ExecutionStep, PersistedTaskControlCommand, Task, TaskKind, TaskRun, TestCase } from "@autovis/shared"

import { BrowserFrame } from "../../components/browser-frame"
import { EmptyState } from "../../components/empty-state"
import { LogPanel } from "../../components/log-panel"
import { TaskControlBar } from "../../components/TaskControlBar"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { inputClassName } from "../../components/ui/field"
import { formatDateTime, formatDuration, resolveUrl, translateStatus } from "../../utils"
import { RunArtifacts } from "./RunArtifacts"

type RunStepGroup = {
  parent: ExecutionStep
  children: ExecutionStep[]
}

type RunDetailProps = {
  activeControlTarget: { kind: TaskKind; id: string } | null
  activeTaskRun: TaskRun | null
  awaitingHumanRun: ExecutionRun | null
  busy: boolean
  controlCommands: PersistedTaskControlCommand[]
  controlCommandsError: string | null
  controlCommandsLoading: boolean
  currentCase: TestCase | null
  currentTaskRuns: ExecutionRun[]
  detailTab: "steps" | "logs" | "meta" | "control"
  executionActiveRun: ExecutionRun | null
  executionReplayVideo?: string
  groupedSteps: RunStepGroup[]
  humanInputValue: string
  lightboxUrl: string | null
  onBack: () => void
  onControlSettled: () => void
  onHumanInputChange: (value: string) => void
  onOpenWorkbenchRepair: (runId: string) => void
  onSelectDetailTab: (tab: "steps" | "logs" | "meta" | "control") => void
  onSelectRun: (run: ExecutionRun) => void
  onSetLightboxUrl: (url: string | null) => void
  onSubmitHumanInput: () => Promise<void>
  runCaseMap: Map<string, TestCase>
  taskMap: Map<string, Task>
}

export function RunDetail({
  activeControlTarget,
  activeTaskRun,
  awaitingHumanRun,
  busy,
  controlCommands,
  controlCommandsError,
  controlCommandsLoading,
  currentCase,
  currentTaskRuns,
  detailTab,
  executionActiveRun,
  executionReplayVideo,
  groupedSteps,
  humanInputValue,
  lightboxUrl,
  onBack,
  onControlSettled,
  onHumanInputChange,
  onOpenWorkbenchRepair,
  onSelectDetailTab,
  onSelectRun,
  onSetLightboxUrl,
  onSubmitHumanInput,
  runCaseMap,
  taskMap,
}: RunDetailProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 border-b border-border/40 pb-4 md:flex-row md:items-center md:justify-between select-none">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="hover:text-foreground cursor-pointer transition-colors" onClick={onBack}>执行记录</span>
          <span className="material-symbols-outlined text-[10px] text-muted-foreground/60">chevron_right</span>
          <span className="font-mono bg-secondary/80 text-secondary-foreground px-2 py-0.5 rounded border border-border/40 font-semibold text-[10px]">
            任务 #{activeTaskRun?.id.slice(0, 8) || executionActiveRun?.id.slice(0, 8)}
          </span>
          {currentCase ? (
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
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {activeTaskRun ? <Badge>{taskMap.get(activeTaskRun.taskId)?.name ?? activeTaskRun.taskId.slice(0, 8)}</Badge> : null}
          {(() => {
            const run = executionActiveRun ?? activeTaskRun
            if (!run) return null
            return (
              <Badge tone={run.status === "passed" ? "success" : run.status === "failed" ? "danger" : "warning"}>
                {translateStatus(run.status)}
              </Badge>
            )
          })()}

          {activeTaskRun?.id ? (
            <TaskControlBar kind="task-run" id={activeTaskRun.id} status={activeTaskRun.status} onSettled={onControlSettled} />
          ) : executionActiveRun?.id ? (
            <TaskControlBar kind="run" id={executionActiveRun.id} status={executionActiveRun.status} onSettled={onControlSettled} />
          ) : null}

          <Button onClick={onBack} variant="ghost" className="h-8 rounded-lg text-xs flex items-center gap-1 cursor-pointer">
            <span className="material-symbols-outlined text-sm">arrow_back</span>
            返回任务列表
          </Button>
        </div>
      </div>

      {activeTaskRun ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <div className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4 rounded-xl border"><span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">总用例</span><strong className="text-xl font-bold text-foreground font-mono mt-0.5 block">{activeTaskRun.totalCount}</strong></div>
          <div className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4 rounded-xl border"><span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">已通过</span><strong className="text-xl font-bold text-emerald-600 dark:text-emerald-450 font-mono mt-0.5 block">{activeTaskRun.passedCount}</strong></div>
          <div className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4 rounded-xl border"><span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block">已失败</span><strong className="text-xl font-bold text-rose-600 dark:text-rose-405 font-mono mt-0.5 block">{activeTaskRun.failedCount}</strong></div>
          <div className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4 rounded-xl border"><span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">排队中</span><strong className="text-xl font-bold text-foreground font-mono mt-0.5 block">{activeTaskRun.queuedCount}</strong></div>
          <div className="border-border/40 bg-card/60 backdrop-blur-md py-3 px-4 rounded-xl border"><span className="text-[10px] font-bold text-primary uppercase tracking-wider block">当前运行</span><strong className="text-xs font-bold text-primary mt-1.5 block truncate max-w-[120px]" title={currentCase ? currentCase.caseCode : activeTaskRun.currentRunId ?? "--"}>{currentCase ? currentCase.caseCode : activeTaskRun.currentRunId ?? "--"}</strong></div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr] items-start">
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

                let statusIcon = "schedule"
                let pulseClass = ""

                if (runStatus === "passed") {
                  statusIcon = "check_circle"
                } else if (runStatus === "failed") {
                  statusIcon = "cancel"
                  pulseClass = "animate-pulse text-rose-500"
                } else if (runStatus === "running" || runStatus === "queued") {
                  statusIcon = "hourglass_top"
                  pulseClass = "animate-pulse text-primary"
                } else if (runStatus === "awaiting_human") {
                  statusIcon = "person"
                  pulseClass = "animate-bounce text-amber-500"
                }

                return (
                  <button
                    key={run.id}
                    onClick={() => onSelectRun(run)}
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

        <div className="flex flex-col border border-border bg-card/25 backdrop-blur-md rounded-2xl overflow-hidden shadow-sm">
          <div className="flex border-b border-border bg-secondary/10 px-4 py-2 justify-between items-center flex-wrap gap-3">
            <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-xl border border-border/40 select-none">
              <button className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "steps" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onSelectDetailTab("steps")} type="button">执行步骤</button>
              <button className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "logs" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onSelectDetailTab("logs")} type="button">系统日志</button>
              <button className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "meta" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onSelectDetailTab("meta")} type="button">产物与诊断</button>
              <button className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${detailTab === "control" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onSelectDetailTab("control")} type="button">控制命令</button>
            </div>
          </div>

          {awaitingHumanRun?.pendingHumanHandoff ? (
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

                  {(awaitingHumanRun.pendingHumanHandoff.imageUrl ?? awaitingHumanRun.currentViewport) ? (
                    <div className="overflow-hidden rounded-xl border border-border/60 max-w-md bg-slate-100 dark:bg-black/20">
                      <img
                        alt={awaitingHumanRun.pendingHumanHandoff.inputLabel ?? "人工输入参考图"}
                        className="max-h-56 w-full object-contain cursor-zoom-in hover:brightness-105 transition-all"
                        src={resolveUrl(awaitingHumanRun.pendingHumanHandoff.imageUrl ?? awaitingHumanRun.currentViewport)}
                        onClick={() => onSetLightboxUrl(resolveUrl(awaitingHumanRun.pendingHumanHandoff!.imageUrl ?? awaitingHumanRun.currentViewport))}
                      />
                    </div>
                  ) : null}

                  <div className="flex gap-2 max-w-md">
                    <input
                      className={`${inputClassName} text-xs flex-1 bg-background border-border/60 rounded-xl px-3 py-1.5 focus:border-amber-500 focus:ring-amber-500`}
                      onChange={(event) => onHumanInputChange(event.target.value)}
                      placeholder={awaitingHumanRun.pendingHumanHandoff.placeholder ?? awaitingHumanRun.pendingHumanHandoff.inputLabel ?? "请输入内容"}
                      value={humanInputValue}
                    />
                    <Button
                      className="cursor-pointer rounded-xl bg-amber-500 hover:bg-amber-600 text-white border-0 text-xs font-bold px-4 shrink-0 shadow-sm"
                      disabled={busy || !humanInputValue.trim()}
                      onClick={() => void onSubmitHumanInput()}
                    >
                      {awaitingHumanRun.pendingHumanHandoff.confirmText ?? "确定并继续"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] border-t border-border min-h-[38rem] bg-slate-100/30 dark:bg-slate-950/10">
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

            <div className="p-5 overflow-y-auto max-h-[42rem] custom-scrollbar flex flex-col space-y-4 bg-background/40 backdrop-blur-sm">
              {detailTab === "steps" ? (
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
                    <div className="space-y-4 pl-2 pr-1 pb-4 relative">
                      {groupedSteps.map(({ parent, children }, idx) => {
                        const isRunning = parent.status === "running"
                        const isPassed = parent.status === "passed"
                        const isFailed = parent.status === "failed"

                        let visuals = {
                          icon: <span className="material-symbols-outlined text-slate-400 text-xs">radio_button_checked</span>,
                          bg: "bg-secondary/20 border-border/40",
                          textClass: "text-foreground",
                          lineClass: "bg-border/40",
                          dotClass: "bg-slate-400",
                        }

                        if (isFailed) {
                          visuals = {
                            icon: <span className="material-symbols-outlined text-rose-500 text-sm drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]">cancel</span>,
                            bg: "bg-rose-500/10 border-rose-500/40 shadow-[0_0_15px_rgba(244,63,94,0.1)]",
                            textClass: "text-rose-500 font-semibold",
                            lineClass: "bg-rose-500/40",
                            dotClass: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]",
                          }
                        } else if (isRunning) {
                          visuals = {
                            icon: <span className="material-symbols-outlined text-indigo-400 text-sm animate-pulse drop-shadow-[0_0_8px_rgba(99,102,241,0.8)]">hourglass_top</span>,
                            bg: "bg-indigo-500/10 border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.15)]",
                            textClass: "text-indigo-400 font-semibold",
                            lineClass: "bg-indigo-500/50 animate-pulse",
                            dotClass: "bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)] animate-ping",
                          }
                        } else if (isPassed) {
                          visuals = {
                            icon: <span className="material-symbols-outlined text-emerald-500 text-sm drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">check_circle</span>,
                            bg: "bg-emerald-500/5 border-emerald-500/20",
                            textClass: "text-emerald-500 font-medium",
                            lineClass: "bg-emerald-500/30",
                            dotClass: "bg-emerald-500",
                          }
                        }

                        return (
                          <div key={parent.id} className="relative flex gap-4 group animate-in slide-in-from-bottom-2 fade-in duration-300">
                            {idx < groupedSteps.length - 1 ? (
                              <div className={`absolute left-[11px] top-6 bottom-[-16px] w-[2px] rounded-full ${visuals.lineClass}`} />
                            ) : null}

                            <div className="relative z-10 flex flex-col items-center mt-1">
                              <div className={`flex items-center justify-center size-6 rounded-full bg-background border-2 ${isRunning ? "border-indigo-500" : "border-border"}`}>
                                <div className={`size-2.5 rounded-full ${visuals.dotClass}`} />
                              </div>
                            </div>

                            <div className={`flex-1 rounded-2xl border p-4 transition-all duration-300 ${visuals.bg} backdrop-blur-md`}>
                              <div className="flex items-center justify-between gap-3 mb-1">
                                <div className="flex items-center gap-2">
                                  {visuals.icon}
                                  <span className={`text-sm tracking-wide ${visuals.textClass}`}>{parent.title}</span>
                                </div>
                                <Badge tone={parent.status === "passed" ? "success" : parent.status === "failed" ? "danger" : "warning"} className="scale-90 origin-top-right shadow-sm">
                                  {translateStatus(parent.status, true)}
                                </Badge>
                              </div>

                              {parent.log ? <p className="text-xs text-muted-foreground leading-relaxed font-sans mt-1">{parent.log}</p> : null}

                              {parent.screenshotUrl ? (
                                <div
                                  className="mt-3 relative rounded-lg overflow-hidden border border-border/50 group max-w-[200px] aspect-[16/10] bg-black/10 cursor-zoom-in shadow-sm hover:border-primary/50 transition-colors"
                                  onClick={() => onSetLightboxUrl(parent.screenshotUrl ?? null)}
                                >
                                  <img src={resolveUrl(parent.screenshotUrl)} alt={parent.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                                    <span className="material-symbols-outlined text-white text-base">zoom_in</span>
                                  </div>
                                </div>
                              ) : null}

                              {children.length > 0 ? (
                                <div className="mt-3 pl-3 border-l-2 border-border/50 space-y-3">
                                  {children.map((child) => {
                                    const cIsRunning = child.status === "running"
                                    const cIsPassed = child.status === "passed"
                                    const cIsFailed = child.status === "failed"
                                    return (
                                      <div key={child.id} className="relative flex items-start gap-2.5 p-1.5 -ml-1.5 rounded-lg transition-colors hover:bg-secondary/40">
                                        <div className={`mt-1.5 h-1.5 w-1.5 rounded-full flex-shrink-0 ${cIsRunning ? "bg-primary animate-ping" : cIsPassed ? "bg-emerald-500" : cIsFailed ? "bg-rose-500" : "bg-muted-foreground/30"}`} />
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-xs ${cIsRunning ? "text-primary font-medium" : "text-foreground"}`}>{child.title}</p>
                                          {child.log ? <p className="text-[10px] text-muted-foreground mt-0.5 font-sans opacity-80">{child.log}</p> : null}
                                          {child.screenshotUrl ? (
                                            <div
                                              className="mt-2 relative rounded overflow-hidden border border-border/50 group max-w-[120px] aspect-[16/10] bg-black/10 cursor-zoom-in shadow-sm hover:border-primary/50 transition-colors"
                                              onClick={() => onSetLightboxUrl(child.screenshotUrl ?? null)}
                                            >
                                              <img src={resolveUrl(child.screenshotUrl)} alt={child.title} className="w-full h-full object-cover" />
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <EmptyState description="开始执行后，这里会显示当前子运行的层级步骤和状态变化。" title="无步骤数据" />
                  )}
                </div>
              ) : null}

              {detailTab === "logs" ? (
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
              ) : null}

              {detailTab === "meta" ? <RunArtifacts executionActiveRun={executionActiveRun} onRepairRun={onOpenWorkbenchRepair} /> : null}

              {detailTab === "control" ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-border/40">
                    <span className="text-[10px] font-bold text-foreground tracking-wider uppercase">控制命令历史</span>
                    {activeControlTarget ? <Badge tone="default">{activeControlTarget.kind} · {activeControlTarget.id.slice(0, 8)}</Badge> : null}
                  </div>

                  {!activeControlTarget ? (
                    <EmptyState description="当前没有可控制的运行对象。" title="暂无命令历史" />
                  ) : controlCommandsLoading ? (
                    <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-5 text-sm text-muted-foreground">正在加载命令历史…</div>
                  ) : controlCommandsError ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-5 text-sm text-destructive">{controlCommandsError}</div>
                  ) : controlCommands.length === 0 ? (
                    <EmptyState description="在这里可以看到暂停、继续、停止等控制操作的请求与结果。" title="尚无控制命令" />
                  ) : (
                    <div className="space-y-3">
                      {controlCommands.map((command) => {
                        const statusTone = command.status === "applied" ? "success" : command.status === "rejected" ? "danger" : command.status === "orphaned" ? "warning" : "default"

                        return (
                          <div key={command.id} className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs text-foreground">#{command.id.slice(0, 8)}</span>
                                <Badge tone={statusTone}>{command.action}</Badge>
                                <Badge tone={statusTone}>{command.status}</Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground font-mono text-right">
                                <div>{formatDateTime(command.requestedAt)}</div>
                                <div>{command.resolvedAt ? `完成 ${formatDateTime(command.resolvedAt)}` : "等待处理"}</div>
                              </div>
                            </div>
                            {command.note ? <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{command.note}</p> : null}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {lightboxUrl ? (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200" onClick={() => onSetLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Screenshot detail view" className="max-w-full max-h-[95vh] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] object-contain border border-white/10" />
          <button className="absolute top-6 right-6 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 p-3 rounded-full cursor-pointer transition-all hover:scale-110" onClick={() => onSetLightboxUrl(null)}>
            <span className="material-symbols-outlined text-2xl drop-shadow-md">close</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}