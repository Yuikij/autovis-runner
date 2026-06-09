import { useEffect, useMemo, useRef } from "react"

import type { TaskRun } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { useEntityStream } from "./useEntityStream"
import type { ProjectSync } from "./useProjectSync"

type TaskRunStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeTaskRun"
  | "loadRun"
  | "projectRuns"
  | "selectedProjectId"
  | "setActiveRun"
  | "setTaskRuns"
>

const isTerminal = (status: TaskRun["status"]) =>
  status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

export function useTaskRunStreams({
  activeRun,
  activeTaskRun,
  loadRun,
  projectRuns,
  selectedProjectId,
  setActiveRun,
  setTaskRuns,
}: TaskRunStreamParams, sync: ProjectSync) {
  const activeRunRef = useRef(activeRun)
  const projectRunsRef = useRef(projectRuns)

  useEffect(() => {
    activeRunRef.current = activeRun
  }, [activeRun])

  useEffect(() => {
    projectRunsRef.current = projectRuns
  }, [projectRuns])

  const streamTarget = useMemo(() => (activeTaskRun ? streamUrl(apiRoutes.taskRuns.stream(activeTaskRun.id)) : null), [activeTaskRun?.id])

  useEntityStream<TaskRun>(streamTarget, (taskRun) => {
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
        const currentRun = projectRunsRef.current.find((item) => item.id === taskRun.currentRunId)
        if (currentRun) {
          setActiveRun(currentRun)
        } else {
          void loadRun(taskRun.currentRunId).then((nextRun) => {
            if (nextRun) setActiveRun(nextRun)
          }).catch(() => undefined)
        }
      }
    }
    if (isTerminal(taskRun.status) && selectedProjectId) {
      sync.onTerminal(taskRun.id)
    }
  })
}
