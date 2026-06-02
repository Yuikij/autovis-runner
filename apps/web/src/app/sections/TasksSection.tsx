import { useCallback, useEffect, useMemo, useState } from "react"
import type { ScheduleTrigger, TaskItem, TaskModeConfig, TaskRun } from "@autovis/shared"

import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card"
import { EmptyState } from "../components/empty-state"
import { PageHeader } from "../components/page-header"
import { Field, inputClassName } from "../components/ui/field"
import { apiRoutes } from "../apiRoutes"
import { request } from "../api"
import { formatDateTime, translateStatus } from "../utils"
import type { ReadyWorkspaceController } from "../useWorkspaceController"

type TasksSectionProps = {
  controller: ReadyWorkspaceController
}

const toDatetimeLocalValue = (iso?: string) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const describeTaskMode = (mode?: TaskModeConfig) => {
  if (!mode || mode.kind === "oneshot") return "oneshot · 跑一次"
  if (mode.kind === "polling") return `polling · 每 ${(mode.intervalMs / 1000).toFixed(1)}s 重试，最多 ${mode.maxAttempts} 次（${mode.stopOn ?? "success"}）`
  return `deadline · 目标 ${formatDateTime(mode.at)}（提前 ${(mode.prewarmMs ?? 0) / 1000}s 预热）`
}

const describeTriggerKind = (trigger: ScheduleTrigger) => {
  if (trigger.kind === "at") return `at · ${trigger.atTime ? formatDateTime(trigger.atTime) : "未设置"}`
  return `cron · ${trigger.cronExpr ?? ""}`
}

type TriggerFormState = {
  kind: "at" | "cron"
  name: string
  atTime: string
  cronExpr: string
}

const emptyTriggerForm = (): TriggerFormState => ({ kind: "at", name: "", atTime: "", cronExpr: "0 9 * * *" })

export function TasksSection({ controller }: TasksSectionProps) {
  const {
    selectedProject,
    tasks,
    selectedTask,
    selectedTaskId,
    setSelectedTaskId,
    taskForm,
    setTaskForm,
    allCases,
    busy,
    startNewTaskDraft,
    saveTask,
    deleteTask,
    startTaskRun,
    saveScheduleTrigger,
    deleteScheduleTrigger,
    setScheduleTriggerEnabled,
    fireScheduleTrigger,
    setActiveTaskRunId,
    setActiveSection,
  } = controller

  const targetUrls = selectedProject.targetUrls ?? []
  const projectCases = useMemo(() => allCases.filter((item) => item.projectId === selectedProject.id), [allCases, selectedProject.id])

  const [triggers, setTriggers] = useState<ScheduleTrigger[]>([])
  const [history, setHistory] = useState<TaskRun[]>([])
  const [triggerForm, setTriggerForm] = useState<TriggerFormState>(emptyTriggerForm)

  const [activeTab, setActiveTab] = useState<"orchestration" | "triggers" | "history">("orchestration")

  useEffect(() => {
    setActiveTab("orchestration")
  }, [selectedTaskId])

  const savedTaskId = selectedTask?.id ?? null

  const refreshTriggers = useCallback(async () => {
    if (!savedTaskId) {
      setTriggers([])
      return
    }
    try {
      const res = await request<ScheduleTrigger[]>(apiRoutes.scheduleTriggers.listForTask(savedTaskId))
      setTriggers(res.data)
    } catch {
      setTriggers([])
    }
  }, [savedTaskId])

  const refreshHistory = useCallback(async () => {
    if (!savedTaskId) {
      setHistory([])
      return
    }
    try {
      const res = await request<TaskRun[]>(apiRoutes.tasks.runs(savedTaskId))
      setHistory(res.data)
    } catch {
      setHistory([])
    }
  }, [savedTaskId])

  useEffect(() => {
    void refreshTriggers()
    void refreshHistory()
  }, [refreshTriggers, refreshHistory])

  const mode = taskForm.executionMode ?? { kind: "oneshot" }

  const setMode = (next: TaskModeConfig) => setTaskForm((current) => ({ ...current, executionMode: next }))

  const updateItem = (index: number, patch: Partial<TaskItem>) => {
    setTaskForm((current) => {
      const items = current.items.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
      return { ...current, items }
    })
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    setTaskForm((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.items.length) return current
      const items = [...current.items]
      const [item] = items.splice(index, 1)
      items.splice(nextIndex, 0, item)
      return { ...current, items }
    })
  }

  const removeItem = (index: number) => {
    setTaskForm((current) => ({ ...current, items: current.items.filter((_, idx) => idx !== index) }))
  }

  const addItem = () => {
    const firstCase = projectCases[0]
    setTaskForm((current) => ({
      ...current,
      items: [...current.items, { caseId: firstCase?.id ?? "" }],
    }))
  }

  const handleSaveTrigger = async () => {
    if (!savedTaskId) return
    if (triggerForm.kind === "at" && !triggerForm.atTime) return
    if (triggerForm.kind === "cron" && !triggerForm.cronExpr.trim()) return
    const ok = await saveScheduleTrigger({
      projectId: selectedProject.id,
      taskId: savedTaskId,
      name: triggerForm.name.trim() || undefined,
      kind: triggerForm.kind,
      atTime: triggerForm.kind === "at" ? new Date(triggerForm.atTime).toISOString() : undefined,
      cronExpr: triggerForm.kind === "cron" ? triggerForm.cronExpr.trim() : undefined,
      enabled: true,
    })
    if (ok) {
      setTriggerForm(emptyTriggerForm())
      await refreshTriggers()
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Tasks"
        title={`${selectedProject.name} · 任务`}
        description="编排有序用例、配置执行模式与调度触发器，并查看执行历史。"
        actions={
          <Button disabled={busy} onClick={startNewTaskDraft} className="rounded-xl shadow-sm">
            <span className="material-symbols-outlined text-base">add</span>
            新建任务
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left: task list */}
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
                    onClick={() => setSelectedTaskId(task.id)}
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
                          {translateStatus(task.lastStatus)}
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

        {/* Right: task editor, triggers & history tabs */}
        <div className="space-y-5">
          {savedTaskId ? (
            <div className="flex items-center gap-1 p-1 rounded-xl bg-secondary/40 border border-border/60 backdrop-blur w-fit">
              <button
                type="button"
                onClick={() => setActiveTab("orchestration")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  activeTab === "orchestration"
                    ? "bg-background text-foreground shadow-sm border border-border/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                }`}
              >
                <span className="material-symbols-outlined text-sm">tune</span>
                配置与编排
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("triggers")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  activeTab === "triggers"
                    ? "bg-background text-foreground shadow-sm border border-border/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                }`}
              >
                <span className="material-symbols-outlined text-sm">schedule</span>
                调度触发器
                {triggers.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[9px] font-bold text-primary border border-primary/20">
                    {triggers.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                  activeTab === "history"
                    ? "bg-background text-foreground shadow-sm border border-border/40"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                }`}
              >
                <span className="material-symbols-outlined text-sm">history</span>
                执行历史
                {history.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-muted-foreground/10 px-1 text-[9px] font-bold text-muted-foreground border border-border/40">
                    {history.length}
                  </span>
                )}
              </button>
            </div>
          ) : null}

          {/* Tab Contents */}
          {activeTab === "orchestration" && (
            <Card>
              <CardHeader>
                <CardTitle>{savedTaskId ? `编辑任务 · ${selectedTask?.name ?? ""}` : "新建任务"}</CardTitle>
                <CardDescription>配置任务的基本信息，对测试用例进行顺序编排并设置运行时的触发模式。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Basic Info */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="任务名称" description="该任务在项目中的唯一识别标识">
                    <input className={inputClassName} value={taskForm.name} onChange={(event) => setTaskForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：每日冒烟回归" />
                  </Field>
                  <Field label="描述（选填）" description="简述此任务的用途与回归范围">
                    <input className={inputClassName} value={taskForm.description ?? ""} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder="例如：运行核心微博模块评论回归用例" />
                  </Field>
                </div>

                {/* Steps Timeline Orchestration */}
                <div className="space-y-4 pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-foreground block">有序用例编排</span>
                      <span className="text-xs text-muted-foreground">任务运行将严格按照此顺序依次执行用例</span>
                    </div>
                    <span className="text-xs font-semibold bg-secondary px-2.5 py-1 rounded-full text-muted-foreground border border-border">
                      共 {taskForm.items.length} 个步骤
                    </span>
                  </div>

                  {taskForm.items.length === 0 ? (
                    <div className="relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-secondary/10 px-6 py-10 text-center flex flex-col items-center justify-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary border border-border/50 text-muted-foreground">
                        <span className="material-symbols-outlined text-xl">playlist_add</span>
                      </div>
                      <strong className="text-xs text-foreground font-semibold">暂无步骤</strong>
                      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                        当前任务尚未添加任何用例。您需要在此处编排至少一个测试用例，以便任务可保存并运行。
                      </p>
                      <Button variant="secondary" size="sm" onClick={addItem} disabled={projectCases.length === 0} className="mt-1 shadow-sm">
                        <span className="material-symbols-outlined text-sm">add</span>
                        添加用例步骤
                      </Button>
                    </div>
                  ) : (
                    <div className="relative pl-6 before:absolute before:left-[13px] before:top-2 before:bottom-6 before:w-[2px] before:bg-gradient-to-b before:from-primary/40 before:to-border/30 before:border-dashed before:border-l space-y-4">
                      {taskForm.items.map((item, index) => (
                        <div
                          key={index}
                          className="relative group flex flex-col gap-3.5 rounded-xl border border-border/80 bg-card p-4 hover:border-primary/20 hover:shadow-sm transition-all duration-300 animate-fade-in"
                        >
                          {/* Step Bubble */}
                          <div className="absolute -left-[27px] top-[18px] flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-[10px] font-bold text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary/20 transition-all duration-300 shadow-sm">
                            {index + 1}
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-primary tracking-wider uppercase">STEP {String(index + 1).padStart(2, "0")}</span>
                              <span className="h-1 w-1 rounded-full bg-border" />
                              <span className="text-xs text-muted-foreground">设置用例与覆盖域名</span>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                aria-label="上移"
                                className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground"
                                disabled={index === 0}
                                onClick={() => moveItem(index, -1)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <span className="material-symbols-outlined text-sm">arrow_upward</span>
                              </Button>
                              <Button
                                aria-label="下移"
                                className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground"
                                disabled={index === taskForm.items.length - 1}
                                onClick={() => moveItem(index, 1)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <span className="material-symbols-outlined text-sm">arrow_downward</span>
                              </Button>
                              <Button
                                aria-label="移除"
                                className="h-7 w-7 rounded-lg hover:bg-rose-500/10 border border-border/60 text-rose-600 dark:text-rose-400"
                                onClick={() => removeItem(index)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
                              </Button>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-semibold text-muted-foreground">选择执行用例</span>
                              <select
                                className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`}
                                value={item.caseId}
                                onChange={(event) => updateItem(index, { caseId: event.target.value })}
                              >
                                <option value="">选择用例...</option>
                                {projectCases.map((testCase) => (
                                  <option key={testCase.id} value={testCase.id}>
                                    {testCase.caseCode} {testCase.purpose ? `(${testCase.purpose})` : testCase.moduleName ? `[${testCase.moduleName}]` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <span className="text-[11px] font-semibold text-muted-foreground">指定初始 URL (可选覆盖)</span>
                              <select
                                className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`}
                                value={item.targetUrlId ?? ""}
                                onChange={(event) => updateItem(index, { targetUrlId: event.target.value || undefined })}
                              >
                                <option value="">使用项目默认主域名</option>
                                {targetUrls.map((url) => (
                                  <option key={url.id} value={url.id}>
                                    {url.label} · {url.url}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}

                      <button
                        onClick={addItem}
                        disabled={projectCases.length === 0}
                        type="button"
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 hover:border-primary/50 hover:bg-primary/5 py-3 text-xs text-muted-foreground hover:text-primary transition-all duration-300 hover:shadow-sm"
                      >
                        <span className="material-symbols-outlined text-sm">add_circle</span>
                        添加下一个用例步骤
                      </button>
                    </div>
                  )}
                </div>

                {/* Execution Mode Visual Cards */}
                <div className="space-y-4 pt-2 border-t border-border/40">
                  <div>
                    <span className="text-sm font-medium text-foreground block">执行模式配置</span>
                    <span className="text-xs text-muted-foreground">配置该任务在被触发或调度时的真实执行模式</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    {/* Oneshot Card */}
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "oneshot" })}
                      className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${
                        mode.kind === "oneshot"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm"
                          : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className={`p-1.5 rounded-lg ${mode.kind === "oneshot" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                          <span className="material-symbols-outlined text-base">bolt</span>
                        </div>
                        {mode.kind === "oneshot" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <strong className="text-xs font-semibold text-foreground">即时单次 (Oneshot)</strong>
                      <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                        任务运行且按编排顺序仅执行一次，适用于普通流水线回归或单次环境校验。
                      </p>
                    </button>

                    {/* Polling Card */}
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "polling", intervalMs: 5000, maxAttempts: 30, stopOn: "success", attemptTimeoutMs: 5 * 60 * 1000 })}
                      className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${
                        mode.kind === "polling"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm"
                          : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className={`p-1.5 rounded-lg ${mode.kind === "polling" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                          <span className="material-symbols-outlined text-base">sync</span>
                        </div>
                        {mode.kind === "polling" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <strong className="text-xs font-semibold text-foreground">循环轮询 (Polling)</strong>
                      <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                        脚本失败后自动间隔重试，直至通过或满上限。适用于抢占动作或等待特定就绪条件。
                      </p>
                    </button>

                    {/* Deadline Card */}
                    <button
                      type="button"
                      onClick={() => setMode({ kind: "deadline", at: "", prewarmMs: 5 * 60 * 1000, extraTimeoutMs: 10 * 60 * 1000 })}
                      className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${
                        mode.kind === "deadline"
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm"
                          : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className={`p-1.5 rounded-lg ${mode.kind === "deadline" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                          <span className="material-symbols-outlined text-base">schedule</span>
                        </div>
                        {mode.kind === "deadline" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        )}
                      </div>
                      <strong className="text-xs font-semibold text-foreground">定时预热 (Deadline)</strong>
                      <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
                        指定最终截止时间，自动提前完成浏览器实例化、登录及资源预热，争取瞬时精准运行。
                      </p>
                    </button>
                  </div>

                  {/* Sub config panels */}
                  {mode.kind === "polling" && (
                    <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 grid gap-4 sm:grid-cols-2 animate-fade-in">
                      <Field label="重试间隔 (毫秒)" description="每次运行结束到下一次开始的等待时间">
                        <input className={inputClassName} type="number" min={0} value={mode.intervalMs} onChange={(event) => setMode({ ...mode, intervalMs: Number(event.target.value) })} />
                      </Field>
                      <Field label="最大尝试次数" description="重试达到该上限后停止">
                        <input className={inputClassName} type="number" min={1} value={mode.maxAttempts} onChange={(event) => setMode({ ...mode, maxAttempts: Number(event.target.value) })} />
                      </Field>
                      <Field label="终止条件" description="何种状态下提前终止轮询">
                        <select className={inputClassName} value={mode.stopOn ?? "success"} onChange={(event) => setMode({ ...mode, stopOn: event.target.value as "success" | "exhausted" })}>
                          <option value="success">出现任何一次运行通过时停止</option>
                          <option value="exhausted">不管成败，全部跑满最大次数</option>
                        </select>
                      </Field>
                      <Field label="单次运行超时 (毫秒)" description="单次脚本的最长运行期限，超时自动中断重试">
                        <input className={inputClassName} type="number" min={1000} value={mode.attemptTimeoutMs ?? 0} onChange={(event) => setMode({ ...mode, attemptTimeoutMs: Number(event.target.value) || undefined })} />
                      </Field>
                    </div>
                  )}

                  {mode.kind === "deadline" && (
                    <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 grid gap-4 sm:grid-cols-3 animate-fade-in">
                      <Field label="目标时刻" description="需要精准触发执行的目标时刻">
                        <input className={inputClassName} type="datetime-local" value={toDatetimeLocalValue(mode.at)} onChange={(event) => setMode({ ...mode, at: event.target.value ? new Date(event.target.value).toISOString() : "" })} />
                      </Field>
                      <Field label="预热提前量 (毫秒)" description="提前多久开沙盒、做预登录和预热">
                        <input className={inputClassName} type="number" min={0} value={mode.prewarmMs ?? 0} onChange={(event) => setMode({ ...mode, prewarmMs: Number(event.target.value) || undefined })} />
                      </Field>
                      <Field label="额外超时缓冲 (毫秒)" description="目标时刻后的最大缓冲执行容灾窗口">
                        <input className={inputClassName} type="number" min={0} value={mode.extraTimeoutMs ?? 0} onChange={(event) => setMode({ ...mode, extraTimeoutMs: Number(event.target.value) || undefined })} />
                      </Field>
                    </div>
                  )}
                </div>

                {/* Action Toolbar */}
                <div className="flex flex-wrap justify-between items-center gap-3 pt-5 border-t border-border/40 mt-6">
                  <div>
                    {savedTaskId ? (
                      <Button
                        variant="ghost"
                        className="h-10 px-4 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:border-rose-500/30 hover:bg-rose-500/10 rounded-xl"
                        disabled={busy}
                        onClick={() => deleteTask(savedTaskId)}
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                        删除任务
                      </Button>
                    ) : null}
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {savedTaskId ? (
                      <Button
                        variant="secondary"
                        className="h-10 px-5 font-semibold border border-border/60 hover:bg-secondary/80 rounded-xl"
                        disabled={busy}
                        onClick={() => startTaskRun(savedTaskId)}
                      >
                        <span className="material-symbols-outlined text-base text-primary">play_arrow</span>
                        立即执行
                      </Button>
                    ) : null}
                    
                    <Button
                      disabled={busy}
                      onClick={() => saveTask()}
                      className="h-10 px-5 font-semibold bg-primary text-primary-foreground hover:opacity-90 rounded-xl shadow-md shadow-primary/10 flex items-center gap-2"
                    >
                      {busy ? (
                        <span className="h-4 w-4 border-2 border-primary-foreground border-t-transparent animate-spin rounded-full" />
                      ) : (
                        <span className="material-symbols-outlined text-base">save</span>
                      )}
                      保存任务
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {savedTaskId && activeTab === "triggers" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">schedule</span>
                  配置调度触发器
                </CardTitle>
                <CardDescription>支持为任务挂载一次性 (At) 或周期性 (Cron) 定时器。触发后会按上面设定的执行模式自动调起运行。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {triggers.length === 0 ? (
                  <div className="relative rounded-xl border border-dashed border-border/80 bg-secondary/5 px-4 py-8 text-center flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-muted-foreground/60 text-xl">event_busy</span>
                    <p className="text-xs text-muted-foreground">暂无活跃的触发器，请在下方新建。</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {triggers.map((trigger) => (
                      <div
                        key={trigger.id}
                        className="relative overflow-hidden flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:shadow-sm hover:border-primary/20 transition-all duration-200"
                      >
                        {/* Left Accent Color Indicator */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${trigger.enabled ? "bg-emerald-500" : "bg-amber-500/50"}`} />
                        
                        <div className="min-w-0 pl-2.5 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <strong className="text-sm text-foreground font-semibold">{trigger.name || "未命名触发器"}</strong>
                            <Badge tone={trigger.enabled ? "success" : "warning"}>
                              {trigger.enabled ? "已启用" : "已停用"}
                            </Badge>
                            <span className="inline-flex items-center gap-1 text-[10px] bg-secondary border border-border/80 px-2 py-0.5 rounded-full text-muted-foreground font-mono">
                              <span className="material-symbols-outlined text-[11px] text-muted-foreground/60">
                                {trigger.kind === "at" ? "calendar_today" : "autorenew"}
                              </span>
                              {describeTriggerKind(trigger)}
                            </span>
                          </div>
                          
                          <div className="flex gap-4 text-[10px] text-muted-foreground/80">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[11px]">arrow_forward</span>
                              下一次触发：<span className="font-mono">{trigger.nextFireAt ? formatDateTime(trigger.nextFireAt) : "—"}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[11px]">history</span>
                              上一次触发：<span className="font-mono">{trigger.lastFiredAt ? formatDateTime(trigger.lastFiredAt) : "—"}</span>
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 border border-border/60 hover:bg-secondary rounded-lg text-xs"
                            onClick={async () => { await fireScheduleTrigger(trigger.id); await refreshHistory() }}
                          >
                            <span className="material-symbols-outlined text-sm mr-1 text-primary">play_arrow</span>
                            测试触发
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 border border-border/60 hover:bg-secondary rounded-lg text-xs"
                            onClick={async () => { await setScheduleTriggerEnabled(trigger.id, !trigger.enabled); await refreshTriggers() }}
                          >
                            {trigger.enabled ? "停用" : "启用"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 px-0 border border-rose-500/20 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40 rounded-lg"
                            onClick={async () => { await deleteScheduleTrigger(trigger.id); await refreshTriggers() }}
                          >
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Create trigger form */}
                <div className="rounded-xl border border-border/80 bg-secondary/15 p-4 space-y-4">
                  <span className="text-xs font-semibold text-foreground block">新建触发器</span>
                  
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-foreground">触发方式</span>
                      <div className="grid grid-cols-2 p-1 rounded-lg bg-secondary border border-border/60">
                        <button
                          type="button"
                          onClick={() => setTriggerForm((current) => ({ ...current, kind: "at" }))}
                          className={`py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                            triggerForm.kind === "at" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          单次触发 (At)
                        </button>
                        <button
                          type="button"
                          onClick={() => setTriggerForm((current) => ({ ...current, kind: "cron" }))}
                          className={`py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                            triggerForm.kind === "cron" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          周期性触发 (Cron)
                        </button>
                      </div>
                    </div>

                    <Field label="名称（可选）">
                      <input className={inputClassName} value={triggerForm.name} onChange={(event) => setTriggerForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：每日 9 点跑早报" />
                    </Field>

                    {triggerForm.kind === "at" ? (
                      <Field label="触发时间">
                        <input className={inputClassName} type="datetime-local" value={triggerForm.atTime} onChange={(event) => setTriggerForm((current) => ({ ...current, atTime: event.target.value }))} />
                      </Field>
                    ) : (
                      <Field label="cron 表达式" description="标准 Linux 5 字段 cron: 分 时 日 月 周">
                        <input className={inputClassName} value={triggerForm.cronExpr} onChange={(event) => setTriggerForm((current) => ({ ...current, cronExpr: event.target.value }))} placeholder="0 9 * * *" />
                      </Field>
                    )}
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button size="sm" disabled={busy} onClick={handleSaveTrigger} className="rounded-lg shadow-sm">
                      <span className="material-symbols-outlined text-sm">add</span>
                      新建触发器
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {savedTaskId && activeTab === "history" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">history</span>
                  执行历史记录
                </CardTitle>
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
                          onClick={() => {
                            setActiveTaskRunId(taskRun.id)
                            setActiveSection("runs")
                          }}
                          className="relative overflow-hidden w-full flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-card p-4 text-left transition-all duration-300 hover:scale-[1.01] hover:border-primary/20 hover:shadow-sm group"
                        >
                          {/* Left accent bar matching status */}
                          <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                            isPassed ? "bg-emerald-500" : isFailed ? "bg-rose-500" : "bg-amber-500"
                          }`} />
                          
                          <div className="flex items-center gap-3.5 min-w-0 pl-1.5">
                            {/* Status Indicator */}
                            <div className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary">
                              {isRunning ? (
                                <span className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                              ) : (
                                <span className={`h-2.5 w-2.5 rounded-full ${
                                  isPassed ? "bg-emerald-500" : isFailed ? "bg-rose-500" : "bg-amber-500"
                                }`} />
                              )}
                            </div>
                            
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-semibold text-foreground tracking-wide">#{taskRun.id.slice(0, 8)}</span>
                                <Badge tone={isPassed ? "success" : isFailed ? "danger" : "warning"}>
                                  {translateStatus(taskRun.status)}
                                </Badge>
                              </div>
                              
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/80">
                                <span className="flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[13px] text-muted-foreground/60">playlist_add_check</span>
                                  通过率：{taskRun.passedCount}/{taskRun.totalCount}
                                </span>
                                {taskRun.failedCount > 0 && (
                                  <span className="flex items-center gap-1 text-rose-500 font-medium">
                                    <span className="material-symbols-outlined text-[13px]">error</span>
                                    失败 {taskRun.failedCount} 个
                                  </span>
                                )}
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
          )}
        </div>
      </div>
    </div>
  )
}
