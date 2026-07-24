import type { Dispatch, SetStateAction } from "react"

import type { TargetUrl, TaskItem, TaskModeConfig, TestCase, UpsertTaskRequest } from "@autovis/shared"

import { Button } from "../../components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card"
import { Field, inputClassName } from "../../components/ui/field"
import { t } from "../../../i18n/index.js"

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
        <CardTitle>{savedTaskId ? t("tasks.editTaskTitle", { name: selectedTaskName ?? "" }) : t("tasks.newTask")}</CardTitle>
        <CardDescription>{t("tasks.editorDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("tasks.nameLabel")} description={t("tasks.nameDescription")}>
            <input className={inputClassName} value={taskForm.name} onChange={(event) => setTaskForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("tasks.namePlaceholder")} />
          </Field>
          <Field label={t("tasks.descriptionLabel")} description={t("tasks.descriptionHint")}>
            <input className={inputClassName} value={taskForm.description ?? ""} onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("tasks.descriptionPlaceholder")} />
          </Field>
        </div>

        <div className="space-y-4 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-foreground block">{t("tasks.orchestrationTitle")}</span>
              <span className="text-xs text-muted-foreground">{t("tasks.orchestrationHint")}</span>
            </div>
            <span className="text-xs font-semibold bg-secondary px-2.5 py-1 rounded-full text-muted-foreground border border-border">
              {t("tasks.stepsTotal", { count: taskForm.items.length })}
            </span>
          </div>

          {taskForm.items.length === 0 ? (
            <div className="relative overflow-hidden rounded-xl border border-dashed border-border/80 bg-secondary/10 px-6 py-10 text-center flex flex-col items-center justify-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary border border-border/50 text-muted-foreground">
                <span className="material-symbols-outlined text-xl">playlist_add</span>
              </div>
              <strong className="text-xs text-foreground font-semibold">{t("tasks.noStepsTitle")}</strong>
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                {t("tasks.noStepsHint")}
              </p>
              <Button variant="secondary" size="sm" onClick={addItem} disabled={projectCases.length === 0} className="mt-1 shadow-sm">
                <span className="material-symbols-outlined text-sm">add</span>
                {t("tasks.addStep")}
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
                      <span className="text-xs text-muted-foreground">{t("tasks.stepHint")}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button aria-label={t("tasks.moveUp")} className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground" disabled={index === 0} onClick={() => moveItem(index, -1)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">arrow_upward</span></Button>
                      <Button aria-label={t("tasks.moveDown")} className="h-7 w-7 rounded-lg hover:bg-secondary/80 border border-border/60 text-muted-foreground hover:text-foreground" disabled={index === taskForm.items.length - 1} onClick={() => moveItem(index, 1)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">arrow_downward</span></Button>
                      <Button aria-label={t("tasks.remove")} className="h-7 w-7 rounded-lg hover:bg-rose-500/10 border border-border/60 text-rose-600 dark:text-rose-400" onClick={() => removeItem(index)} size="sm" type="button" variant="ghost"><span className="material-symbols-outlined text-sm">delete</span></Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">{t("tasks.selectCaseLabel")}</span>
                      <select className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`} value={item.caseId} onChange={(event) => updateItem(index, { caseId: event.target.value })}>
                        <option value="">{t("tasks.selectCasePlaceholder")}</option>
                        {projectCases.map((testCase) => (
                          <option key={testCase.id} value={testCase.id}>
                            {testCase.caseCode} {testCase.purpose ? `(${testCase.purpose})` : testCase.moduleName ? `[${testCase.moduleName}]` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">{t("tasks.targetUrlLabel")}</span>
                      <select className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`} value={item.targetUrlId ?? ""} onChange={(event) => updateItem(index, { targetUrlId: event.target.value || undefined })}>
                        <option value="">{t("tasks.targetUrlDefaultOption")}</option>
                        {targetUrls.map((url) => (
                          <option key={url.id} value={url.id}>
                            {url.label} · {url.url}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">{t("tasks.stealthLabel")}</span>
                      <select
                        className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`}
                        value={item.stealth === undefined ? "inherit" : item.stealth ? "on" : "off"}
                        onChange={(event) => {
                          const next = event.target.value
                          updateItem(index, { stealth: next === "inherit" ? undefined : next === "on" })
                        }}
                      >
                        <option value="inherit">{t("tasks.stealthInherit")}</option>
                        <option value="on">{t("tasks.stealthOn")}</option>
                        <option value="off">{t("tasks.stealthOff")}</option>
                      </select>
                      <span className="text-[10px] text-muted-foreground">{t("tasks.stealthHint")}</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">{t("tasks.onFailureLabel")}</span>
                      <select
                        className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`}
                        value={item.onFailure ?? "stop"}
                        onChange={(event) => updateItem(index, { onFailure: event.target.value === "continue" ? "continue" : undefined })}
                      >
                        <option value="stop">{t("tasks.onFailureStop")}</option>
                        <option value="continue">{t("tasks.onFailureContinue")}</option>
                      </select>
                      <span className="text-[10px] text-muted-foreground">
                        {t("tasks.onFailureHint")}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <span className="text-[11px] font-semibold text-muted-foreground">{t("tasks.sessionLabel")}</span>
                      <select
                        className={`${inputClassName} !h-9 text-xs bg-secondary/15 border-border/70`}
                        disabled={index === 0}
                        value={index > 0 && item.continueSession ? "continue" : "fresh"}
                        onChange={(event) => updateItem(index, { continueSession: event.target.value === "continue" || undefined })}
                      >
                        <option value="fresh">{t("tasks.sessionFresh")}</option>
                        <option value="continue">{t("tasks.sessionContinue")}</option>
                      </select>
                      {index === 0 ? (
                        <span className="text-[10px] text-muted-foreground">{t("tasks.sessionFirstHint")}</span>
                      ) : item.continueSession ? (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">{t("tasks.sessionContinueHint")}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={addItem} disabled={projectCases.length === 0} type="button" className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 hover:border-primary/50 hover:bg-primary/5 py-3 text-xs text-muted-foreground hover:text-primary transition-all duration-300 hover:shadow-sm">
                <span className="material-symbols-outlined text-sm">add_circle</span>
                {t("tasks.addNextStep")}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4 pt-2 border-t border-border/40">
          <div>
            <span className="text-sm font-medium text-foreground block">{t("tasks.modeTitle")}</span>
            <span className="text-xs text-muted-foreground">{t("tasks.modeHint")}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => setMode({ kind: "oneshot" })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "oneshot" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "oneshot" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">bolt</span></div>{mode.kind === "oneshot" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">{t("tasks.modeOneshot")}</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{t("tasks.modeOneshotHint")}</p>
            </button>

            <button type="button" onClick={() => setMode({ kind: "polling", intervalMs: 5000, maxAttempts: 30, stopOn: "success", attemptTimeoutMs: 5 * 60 * 1000 })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "polling" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "polling" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">sync</span></div>{mode.kind === "polling" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">{t("tasks.modePolling")}</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{t("tasks.modePollingHint")}</p>
            </button>

            <button type="button" onClick={() => setMode({ kind: "deadline" })} className={`flex flex-col text-left p-4 rounded-xl border transition-all duration-300 hover:scale-[1.01] ${mode.kind === "deadline" ? "border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm" : "border-border/80 bg-secondary/15 hover:bg-secondary/30 hover:border-border"}`}>
              <div className="flex items-center justify-between mb-2"><div className={`p-1.5 rounded-lg ${mode.kind === "deadline" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}><span className="material-symbols-outlined text-base">schedule</span></div>{mode.kind === "deadline" ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}</div>
              <strong className="text-xs font-semibold text-foreground">{t("tasks.modeDeadline")}</strong>
              <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">{t("tasks.modeDeadlineHint")}</p>
            </button>
          </div>

          {mode.kind === "polling" ? (
            <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 grid gap-4 sm:grid-cols-2 animate-fade-in">
              <Field label={t("tasks.pollingIntervalLabel")} description={t("tasks.pollingIntervalHint")}><input className={inputClassName} type="number" min={0} value={mode.intervalMs} onChange={(event) => setMode({ ...mode, intervalMs: Number(event.target.value) })} /></Field>
              <Field label={t("tasks.pollingMaxAttemptsLabel")} description={t("tasks.pollingMaxAttemptsHint")}><input className={inputClassName} type="number" min={1} value={mode.maxAttempts} onChange={(event) => setMode({ ...mode, maxAttempts: Number(event.target.value) })} /></Field>
              <Field label={t("tasks.pollingStopOnLabel")} description={t("tasks.pollingStopOnHint")}><select className={inputClassName} value={mode.stopOn ?? "success"} onChange={(event) => setMode({ ...mode, stopOn: event.target.value as "success" | "exhausted" })}><option value="success">{t("tasks.pollingStopOnSuccess")}</option><option value="exhausted">{t("tasks.pollingStopOnExhausted")}</option></select></Field>
              <Field label={t("tasks.pollingTimeoutLabel")} description={t("tasks.pollingTimeoutHint")}><input className={inputClassName} type="number" min={1000} value={mode.attemptTimeoutMs ?? 0} onChange={(event) => setMode({ ...mode, attemptTimeoutMs: Number(event.target.value) || undefined })} /></Field>
            </div>
          ) : null}

          {mode.kind === "deadline" ? (
            <div className="p-4 rounded-xl border border-border/80 bg-secondary/10 animate-fade-in">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t("tasks.deadlineNotePrefix")} <span className="font-medium text-foreground">{t("tasks.deadlineNoteTriggers")}</span> {t("tasks.deadlineNoteSuffix")}
                <br />
                <span className="text-[10px]">{t("tasks.deadlineNoteManual")}</span>
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-between items-center gap-3 pt-5 border-t border-border/40 mt-6">
          <div>
            {savedTaskId ? (
              <Button variant="ghost" className="h-10 px-4 text-rose-600 dark:text-rose-400 border border-rose-500/10 hover:border-rose-500/30 hover:bg-rose-500/10 rounded-xl" disabled={busy} onClick={() => deleteTask(savedTaskId)}>
                <span className="material-symbols-outlined text-base">delete</span>
                {t("tasks.deleteTask")}
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {savedTaskId ? (
              <Button variant="secondary" className="h-10 px-5 font-semibold border border-border/60 hover:bg-secondary/80 rounded-xl" disabled={busy} onClick={() => startTaskRun(savedTaskId)}>
                <span className="material-symbols-outlined text-base text-primary">play_arrow</span>
                {t("tasks.runNow")}
              </Button>
            ) : null}

            <Button disabled={busy} onClick={() => saveTask()} className="h-10 px-5 font-semibold bg-primary text-primary-foreground hover:opacity-90 rounded-xl shadow-md shadow-primary/10 flex items-center gap-2">
              {busy ? <span className="h-4 w-4 border-2 border-primary-foreground border-t-transparent animate-spin rounded-full" /> : <span className="material-symbols-outlined text-base">save</span>}
              {t("tasks.saveTask")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
