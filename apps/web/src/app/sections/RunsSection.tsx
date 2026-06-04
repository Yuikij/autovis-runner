import { useCallback, useEffect, useMemo, useState } from "react"

import type { ExecutionStep, ExecutionRun, PersistedTaskControlCommand, TaskKind } from "@autovis/shared"
import type { ReadyWorkspaceController } from "../useWorkspaceController"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import { RunDetail } from "./runs/RunDetail"
import { RunsList } from "./runs/RunsList"

type RunsSectionProps = {
  controller: ReadyWorkspaceController
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
  const [detailTab, setDetailTab] = useState<"steps" | "logs" | "meta" | "control">("steps")
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [controlCommands, setControlCommands] = useState<PersistedTaskControlCommand[]>([])
  const [controlCommandsLoading, setControlCommandsLoading] = useState(false)
  const [controlCommandsError, setControlCommandsError] = useState<string | null>(null)
  const [projectControlCommands, setProjectControlCommands] = useState<PersistedTaskControlCommand[]>([])
  const [projectControlCommandsLoading, setProjectControlCommandsLoading] = useState(false)
  const [projectControlCommandsError, setProjectControlCommandsError] = useState<string | null>(null)

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
  const activeControlTarget = useMemo<{ kind: TaskKind; id: string } | null>(() => {
    if (activeTaskRun?.id) {
      return { kind: "task-run", id: activeTaskRun.id }
    }
    if (executionActiveRun?.id) {
      return { kind: "run", id: executionActiveRun.id }
    }
    return null
  }, [activeTaskRun?.id, executionActiveRun?.id])

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

  const refreshControlCommands = useCallback(async () => {
    if (!activeControlTarget) {
      setControlCommands([])
      setControlCommandsError(null)
      setControlCommandsLoading(false)
      return
    }

    setControlCommandsLoading(true)
    setControlCommandsError(null)
    try {
      const response = await request<PersistedTaskControlCommand[]>(
        apiRoutes.taskControlCommands.list({
          taskKind: activeControlTarget.kind,
          taskId: activeControlTarget.id,
          limit: 20,
        }),
      )
      setControlCommands(response.data)
    } catch (error) {
      setControlCommandsError((error as Error).message)
    } finally {
      setControlCommandsLoading(false)
    }
  }, [activeControlTarget])

  useEffect(() => {
    void refreshControlCommands()
  }, [refreshControlCommands])

  const refreshProjectControlCommands = useCallback(async () => {
    if (!selectedProject?.id) {
      setProjectControlCommands([])
      setProjectControlCommandsError(null)
      setProjectControlCommandsLoading(false)
      return
    }

    setProjectControlCommandsLoading(true)
    setProjectControlCommandsError(null)
    try {
      const response = await request<PersistedTaskControlCommand[]>(
        apiRoutes.taskControlCommands.list({
          projectId: selectedProject.id,
          limit: 12,
        }),
      )
      setProjectControlCommands(response.data)
    } catch (error) {
      setProjectControlCommandsError((error as Error).message)
    } finally {
      setProjectControlCommandsLoading(false)
    }
  }, [selectedProject?.id])

  useEffect(() => {
    void refreshProjectControlCommands()
  }, [refreshProjectControlCommands])

  const handleControlSettled = useCallback(() => {
    void refreshControlCommands()
    void refreshProjectControlCommands()
  }, [refreshControlCommands, refreshProjectControlCommands])

  const handleOpenTask = (taskRunId: string, run?: ExecutionRun | null) => {
    setActiveTaskRunId(taskRunId)
    if (run) {
      setActiveRun(run)
    } else {
      setActiveRun(null)
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
      <RunsList
        activeTaskRunId={activeTaskRun?.id ?? null}
        busy={busy}
        executionFailCount={executionFailCount}
        executionPassCount={executionPassCount}
        executionRuns={executionRuns}
        filteredTaskRuns={filteredTaskRuns}
        hasActiveExecution={hasActiveExecution}
        onClearRuns={() => clearRuns(selectedProject.id)}
        onOpenTask={handleOpenTask}
        projectControlCommands={projectControlCommands}
        projectControlCommandsError={projectControlCommandsError}
        projectControlCommandsLoading={projectControlCommandsLoading}
        runCaseMap={runCaseMap}
        statusFilter={statusFilter}
        taskMap={taskMap}
        taskRuns={taskRuns}
        onStatusFilterChange={setStatusFilter}
      />
    )
  }

  return (
    <RunDetail
      activeControlTarget={activeControlTarget}
      activeTaskRun={activeTaskRun}
      awaitingHumanRun={awaitingHumanRun}
      busy={busy}
      controlCommands={controlCommands}
      controlCommandsError={controlCommandsError}
      controlCommandsLoading={controlCommandsLoading}
      currentCase={currentCase ?? null}
      currentTaskRuns={currentTaskRuns}
      detailTab={detailTab}
      executionActiveRun={executionActiveRun}
      executionReplayVideo={executionReplayVideo}
      groupedSteps={groupedSteps}
      humanInputValue={humanInputValue}
      lightboxUrl={lightboxUrl}
      onBack={() => setViewMode("list")}
      onControlSettled={handleControlSettled}
      onHumanInputChange={setHumanInputValue}
      onOpenWorkbenchRepair={(runId) => {
        controller.repairScriptRun(runId)
        controller.setActiveSection("workbench")
      }}
      onSelectDetailTab={setDetailTab}
      onSelectRun={setActiveRun}
      onSetLightboxUrl={setLightboxUrl}
      onSubmitHumanInput={async () => {
        if (!awaitingHumanRun?.pendingHumanHandoff) {
          return
        }
        await submitRunHumanInput(awaitingHumanRun.id, awaitingHumanRun.pendingHumanHandoff.id, humanInputValue)
        setHumanInputValue("")
      }}
      runCaseMap={runCaseMap}
      taskMap={taskMap}
    />
  )
}
