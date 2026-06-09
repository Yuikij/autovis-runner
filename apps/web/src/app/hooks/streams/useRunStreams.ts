import { useEffect, useMemo, useRef } from "react"

import type { ExecutionRun } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { useEntityStream } from "./useEntityStream"
import type { ProjectSync } from "./useProjectSync"

type RunStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeSection"
  | "agentSession"
  | "loadRun"
  | "projectRuns"
  | "selectedCase"
  | "selectedProjectId"
  | "setActiveRun"
  | "setWorkbenchVerificationRunId"
>

const isTerminal = (status: ExecutionRun["status"]) =>
  status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

export function useRunStreams({
  activeRun,
  activeSection,
  agentSession,
  loadRun,
  projectRuns,
  selectedCase,
  selectedProjectId,
  setActiveRun,
  setWorkbenchVerificationRunId,
}: RunStreamParams, sync: ProjectSync) {
  const warmupRunIdsRef = useRef<Set<string>>(new Set())
  const projectRunsRef = useRef(projectRuns)

  useEffect(() => {
    projectRunsRef.current = projectRuns
  }, [projectRuns])

  useEffect(() => {
    if (agentSession?.warmupRunId) {
      warmupRunIdsRef.current.add(agentSession.warmupRunId)
    }
  }, [agentSession?.warmupRunId])

  useEffect(() => {
    if (!activeRun || activeRun.kind !== "temporary") {
      return
    }
    if (activeSection !== "cases" && activeSection !== "workbench") {
      return
    }
    if (selectedCase && activeRun.testCaseId === selectedCase.id) {
      return
    }
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
  }, [activeSection, selectedCase?.id, activeRun?.id, activeRun?.kind, activeRun?.testCaseId, selectedCase, setActiveRun, setWorkbenchVerificationRunId])

  useEffect(() => {
    if (!activeRun || !selectedCase) return
    if (activeRun.kind !== "temporary") return
    if (activeRun.testCaseId !== selectedCase.id) return
    if (agentSession?.warmupRunId === activeRun.id) return
    if (warmupRunIdsRef.current.has(activeRun.id)) return
    setWorkbenchVerificationRunId((current) => (current === activeRun.id ? current : activeRun.id))
  }, [activeRun?.id, activeRun?.kind, activeRun?.testCaseId, selectedCase?.id, agentSession?.warmupRunId, setWorkbenchVerificationRunId])

  useEffect(() => {
    if (!activeRun) {
      return
    }
    if (activeRun.kind === "temporary") {
      return
    }
    if (selectedProjectId && activeRun.projectId !== selectedProjectId) {
      setActiveRun(null)
      return
    }
    const synced = projectRuns.find((item) => item.id === activeRun.id)
    if (synced && synced !== activeRun) {
      setActiveRun(synced)
    }
  }, [projectRuns, activeRun, selectedProjectId, setActiveRun])

  const streamTarget = useMemo(() => (activeRun ? streamUrl(apiRoutes.runs.stream(activeRun.id)) : null), [activeRun?.id])

  useEntityStream<ExecutionRun>(streamTarget, (run) => {
    setActiveRun(run)
    if (isTerminal(run.status) && selectedProjectId) {
      sync.onTerminal(run.id, ["runs", "cases"])
    }
  })

  useEffect(() => {
    if (!agentSession?.warmupRunId) {
      return undefined
    }

    if (activeRun?.id === agentSession.warmupRunId) {
      return undefined
    }

    const existingRun = projectRunsRef.current.find((item) => item.id === agentSession.warmupRunId)
    if (existingRun) {
      setActiveRun(existingRun)
      return undefined
    }

    void loadRun(agentSession.warmupRunId).then((run) => {
      if (run) setActiveRun(run)
    }).catch(() => undefined)

    return undefined
  }, [agentSession?.warmupRunId, activeRun?.id, loadRun, setActiveRun])
}
