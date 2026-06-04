import { useEffect, useRef } from "react"

import type { TaskRun } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { connectRetryingEventSource } from "./eventSource"

type TaskRunStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeTaskRun"
  | "callbackRef"
  | "loadProjectResources"
  | "loadRun"
  | "projectRuns"
  | "selectedProjectId"
  | "setActiveRun"
  | "setTaskRuns"
  | "setTerminalTaskRunRefreshIds"
  | "terminalTaskRunRefreshIds"
>

export function useTaskRunStreams({
  activeRun,
  activeTaskRun,
  callbackRef,
  loadProjectResources,
  loadRun,
  projectRuns,
  selectedProjectId,
  setActiveRun,
  setTaskRuns,
  setTerminalTaskRunRefreshIds,
  terminalTaskRunRefreshIds,
}: TaskRunStreamParams) {
  const activeRunRef = useRef(activeRun)

  useEffect(() => {
    activeRunRef.current = activeRun
  }, [activeRun])

  useEffect(() => {
    if (!activeTaskRun) {
      return undefined
    }

    const isTerminal = (status: TaskRun["status"]) => status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

    return connectRetryingEventSource({
      url: streamUrl(apiRoutes.taskRuns.stream(activeTaskRun.id)),
      onMessage: (event) => {
        const taskRun = JSON.parse(event.data) as TaskRun
        setTaskRuns((current) => {
          const next = current.filter((item) => item.id !== taskRun.id)
          return [taskRun, ...next]
        })
        const currentActiveRun = activeRunRef.current
        if (!taskRun.currentRunId) {
          if (currentActiveRun && currentActiveRun.taskRunId !== taskRun.id) {
            setActiveRun(null)
          }
        } else {
          const isUserInspectingDiffFinishedRun = currentActiveRun
            && currentActiveRun.id !== taskRun.currentRunId
            && (currentActiveRun.status === "passed"
              || currentActiveRun.status === "failed"
              || currentActiveRun.status === "cancelled"
              || currentActiveRun.status === "interrupted")

          if (!isUserInspectingDiffFinishedRun) {
            const currentRun = projectRuns.find((item) => item.id === taskRun.currentRunId)
            if (currentRun) {
              setActiveRun(currentRun)
            } else {
              void loadRun(taskRun.currentRunId).then((nextRun) => {
                if (nextRun) setActiveRun(nextRun)
              }).catch(() => undefined)
            }
          }
        }
        if (isTerminal(taskRun.status) && selectedProjectId && !terminalTaskRunRefreshIds.includes(taskRun.id)) {
          setTerminalTaskRunRefreshIds((current) => [...current, taskRun.id])
          void loadProjectResources(selectedProjectId)
          const { loadTestCases: refreshCases, loadAllTestCases: refreshAll } = callbackRef.current
          void refreshCases(selectedProjectId)
          void refreshAll()
        }
      },
    })
  }, [activeTaskRun?.id, selectedProjectId, terminalTaskRunRefreshIds, setTaskRuns, projectRuns, setActiveRun, loadRun, setTerminalTaskRunRefreshIds, loadProjectResources, callbackRef])
}