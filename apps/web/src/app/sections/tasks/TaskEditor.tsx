import type { Dispatch, SetStateAction } from "react"

import type { TargetUrl, TaskItem, TaskModeConfig, TestCase, UpsertTaskRequest } from "@autovis/shared"

import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { Field, inputClassName } from "../../components/ui/field"
import { describeTaskMode, toDatetimeLocalValue } from "./shared"

type TaskEditorProps = {
  addItem: () => void
  busy: boolean
  deleteTask: (taskId: string) => void
  mode: TaskModeConfig
  moveItem: (index: number, direction: -1 | 1) => void
  projectCases: TestCase[]
  removeItem: (index: number) => void
  saveTask: () => void
  savedTaskId: string | null
  selectedTaskName?: string
  setMode: (next: TaskModeConfig) => void
  setTaskForm: Dispatch<SetStateAction<Omit<UpsertTaskRequest, "projectId">>>
  startTaskRun: (taskId: string) => void
  targetUrls: TargetUrl[]
  taskForm: Omit<UpsertTaskRequest, "projectId">
  updateItem: (index: number, patch: Partial<TaskItem>) => void
}

export function TaskEditor({
  addItem,
  busy,
  deleteTask,
  mode,
  moveItem,
  projectCases,
  removeItem,
  saveTask,
  savedTaskId,
  selectedTaskName,
  setMode,
  setTaskForm,
  startTaskRun,
  targetUrls,
  taskForm,
  updateItem,
}: TaskEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{savedTaskId ? `编辑任务 · ${selectedTaskName ?? ""}` : "新建任务"}</CardTitle>
        <CardDescription>配置任务的基本信息，对测试用例进行顺序编排并设置运行时的触发模式。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="任务名称" description="该任务在项目中的唯一识别标识">
            <input className={inputClassName} value={taskForm.name} onChange={(event) => setTaskForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：每日冒烟回归" />
          </Field>
          <Field label="描述（选填）" description="简述此任务的用途与回归范围">
            <input className={inputClassName} value={taskForm.description ?? ""} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder="例如：运行核心微博模块评论回归用例" />
          </Field>
        </div>

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
                      <Button aria-label="上移" className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground" disabled={index === 0} onClick={() => moveItem(index, -1)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">arrow_upward</span></Button>
                      <Button aria-label="下移" className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground" disabled={index === taskForm.items.length - 1} onClick={() => moveItem(index, 1)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">arrow_downward</span></Button>
                      <Button aria-label="移除" className="h-7 w-7 rounded-lg hover:bg-rose-500/10 border border-border/60 text-rose-600 dark:text-rose-400" onClick={() => removeItem(index)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">delete</span></Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">选择执行用例</span>
                      <select className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`} value={item.caseId} onChange={(event) => updateItem(index, { caseId: event.target.value })}>
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
                      <select className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`} value={item.targetUrlId ?? ""} onChange={(event) => updateItem(index, { targetUrlId: event.target.value || undefined })}>
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

              <button onClick={addItem} disabled={projectCases.length === 0} type="button" className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 hover:border-primary/50 hover:bg-primary/5 py-3 text-xs text-muted-foreground hover:text-primary transition-all duration-300 hover:shadow-sm">
                <span className="material-symbols-outlined text-sm">add_circle</span>
                添加下一个用例步骤
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4 pt-2 border-t border-border/40">
          <div>
            <span className="text-sm font-medium text-foreground block">执行模式配置</span>
            <span className="text-xs text-muted-foreground">配置该任务在被触发或调度时的真实执行模式</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => setMode({ kind: "oneshot" })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "oneshot" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "oneshot" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">bolt</span></div>{mode.kind === "oneshot" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">即时单次 (Oneshot)</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">任务运行且按编排顺序仅执行一次，适用于普通流水线回归或单次环境校验。</p>
            </button>

            <button type="button" onClick={() => setMode({ kind: "polling", intervalMs: 5000, maxAttempts: 30, stopOn: "success", attemptTimeoutMs: 5 * 60 * 1000 })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "polling" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "polling" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">sync</span></div>{mode.kind === "polling" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">循环轮询 (Polling)</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">脚本失败后自动间隔重试，直至通过或满上限。适用于抢占动作或等待特定就绪条件。</p>
            </button>

            <button type="button" onClick={() => setMode({ kind: "deadline", at: "", prewarmMs: 5 * 60 * 1000, extraTimeoutMs: 10 * 60 * 1000 })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "deadline" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "deadline" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">schedule</span></div>{mode.kind === "deadline" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">定时预热 (Deadline)</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">指定最终截止时间，自动提前完成浏览器实例化、登录及资源预热，争取瞬时精准运行。</p>
            </button>
          </div>

          {mode.kind === "polling" ? (
            <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 grid gap-4 sm:grid-cols-2 animate-fade-in">
              <Field label="重试间隔 (毫秒)" description="每次运行结束到下一次开始的等待时间"><input className={inputClassName} type="number" min={0} value={mode.intervalMs} onChange={(event) => setMode({ ...mode, intervalMs: Number(event.target.value) })} /></Field>
              <Field label="最大尝试次数" description="重试达到该上限后停止"><input className={inputClassName} type="number" min={1} value={mode.maxAttempts} onChange={(event) => setMode({ ...mode, maxAttempts: Number(event.target.value) })} /></Field>
              <Field label="终止条件" description="何种状态下提前终止轮询"><select className={inputClassName} value={mode.stopOn ?? "success"} onChange={(event) => setMode({ ...mode, stopOn: event.target.value as "success" | "exhausted" })}><option value="success">出现任何一次运行通过时停止</option><option value="exhausted">不管成败，全部跑满最大次数</option></select></Field>
              <Field label="单次运行超时 (毫秒)" description="单次脚本的最长运行期限，超时自动中断重试"><input className={inputClassName} type="number" min={1000} value={mode.attemptTimeoutMs ?? 0} onChange={(event) => setMode({ ...mode, attemptTimeoutMs: Number(event.target.value) || undefined })} /></Field>
            </div>
          ) : null}

          {mode.kind === "deadline" ? (
            <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 grid gap-4 sm:grid-cols-3 animate-fade-in">
              <Field label="目标时刻" description="需要精准触发执行的目标时刻"><input className={inputClassName} type="datetime-local" value={toDatetimeLocalValue(mode.at)} onChange={(event) => setMode({ ...mode, at: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></Field>
              <Field label="预热提前量 (毫秒)" description="提前多久开沙盒、做预登录和预热"><input className={inputClassName} type="number" min={0} value={mode.prewarmMs ?? 0} onChange={(event) => setMode({ ...mode, prewarmMs: Number(event.target.value) || undefined })} /></Field>
              <Field label="额外超时缓冲 (毫秒)" description="目标时刻后的最大缓冲执行容灾窗口"><input className={inputClassName} type="number" min={0} value={mode.extraTimeoutMs ?? 0} onChange={(event) => setMode({ ...mode, extraTimeoutMs: Number(event.target.value) || undefined })} /></Field>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3 pt-5 border-t border-border/40 mt-6">
          <div>
            {savedTaskId ? (
              <Button variant="ghost" className="h-10 px-4 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:border-rose-500/30 hover:bg-rose-500/10 rounded-xl" disabled={busy} onClick={() => deleteTask(savedTaskId)}>
                <span className="material-symbols-outlined text-base">delete</span>
                删除任务
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {savedTaskId ? (
              <Button variant="secondary" className="h-10 px-5 font-semibold border border-border/60 hover:bg-secondary/80 rounded-xl" disabled={busy} onClick={() => startTaskRun(savedTaskId)}>
                <span className="material-symbols-outlined text-base text-primary">play_arrow</span>
                立即执行
              </Button>
            ) : null}

            <Button disabled={busy} onClick={() => saveTask()} className="h-10 px-5 font-semibold bg-primary text-primary-foreground hover:opacity-90 rounded-xl shadow-md shadow-primary/10 flex items-center gap-2">
              {busy ? <span className="h-4 w-4 border-2 border-primary-foreground border-t-transparent animate-spin rounded-full" /> : <span className="material-symbols-outlined text-base">save</span>}
              保存任务
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}