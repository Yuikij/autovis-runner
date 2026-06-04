import { useCallback, useEffect, useMemo, useState } from "react"
import type { ScheduleTrigger, TaskItem, TaskModeConfig, TaskRun } from "@autovis/shared"

import { Button } from "../components/ui/button"
import { PageHeader } from "../components/page-header"
import { apiRoutes } from "../apiRoutes"
import { request } from "../api"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { TaskEditor } from "./tasks/TaskEditor"
import { TaskRunHistory } from "./tasks/TaskRunHistory"
import { TasksList } from "./tasks/TasksList"
import { TaskTriggers } from "./tasks/TaskTriggers"
import { emptyTriggerForm, type TriggerFormState } from "./tasks/shared"

type TasksSectionProps = {
  controller: ReadyWorkspaceController
}

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
    setActiveRun,
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
        <TasksList selectedTaskId={selectedTaskId} tasks={tasks} onSelectTask={setSelectedTaskId} />

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

          {activeTab === "orchestration" && (
            <TaskEditor
              addItem={addItem}
              busy={busy}
              deleteTask={deleteTask}
              mode={mode}
              moveItem={moveItem}
              projectCases={projectCases}
              removeItem={removeItem}
              saveTask={saveTask}
              savedTaskId={savedTaskId}
              selectedTaskName={selectedTask?.name}
              setMode={setMode}
              setTaskForm={setTaskForm}
              startTaskRun={startTaskRun}
              targetUrls={targetUrls}
              taskForm={taskForm}
              updateItem={updateItem}
            />
          )}

          {savedTaskId && activeTab === "triggers" && (
            <TaskTriggers
              busy={busy}
              deleteScheduleTrigger={deleteScheduleTrigger}
              fireScheduleTrigger={fireScheduleTrigger}
              handleSaveTrigger={handleSaveTrigger}
              refreshHistory={refreshHistory}
              refreshTriggers={refreshTriggers}
              setScheduleTriggerEnabled={setScheduleTriggerEnabled}
              setTriggerForm={setTriggerForm}
              triggerForm={triggerForm}
              triggers={triggers}
            />
          )}

          {savedTaskId && activeTab === "history" && (
            <TaskRunHistory
              history={history}
              onOpenTaskRun={(taskRunId) => {
                setActiveRun(null)
                setActiveTaskRunId(taskRunId)
                setActiveSection("runs")
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
