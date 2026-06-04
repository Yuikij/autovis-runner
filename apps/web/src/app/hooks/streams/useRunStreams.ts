import { useEffect, useRef } from "react"

import type { ExecutionRun } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { connectRetryingEventSource } from "./eventSource"

type RunStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeSection"
  | "agentSession"
  | "callbackRef"
  | "loadProjectResources"
  | "loadRun"
  | "projectRuns"
  | "selectedCase"
  | "selectedProjectId"
  | "setActiveRun"
  | "setTerminalRunRefreshIds"
  | "setWorkbenchVerificationRunId"
  | "terminalRunRefreshIds"
>

export function useRunStreams({
  activeRun,
  activeSection,
  agentSession,
  callbackRef,
  loadProjectResources,
  loadRun,
  projectRuns,
  selectedCase,
  selectedProjectId,
  setActiveRun,
  setTerminalRunRefreshIds,
  setWorkbenchVerificationRunId,
  terminalRunRefreshIds,
}: RunStreamParams) {
  const warmupRunIdsRef = useRef<Set<string>>(new Set())

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

  useEffect(() => {
    if (!activeRun) {
      return undefined
    }

    const isTerminal = (status: ExecutionRun["status"]) => status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

    return connectRetryingEventSource({
      url: streamUrl(apiRoutes.runs.stream(activeRun.id)),
      onMessage: (event) => {
        const run = JSON.parse(event.data) as ExecutionRun
        setActiveRun(run)
        if (isTerminal(run.status) && selectedProjectId && !terminalRunRefreshIds.includes(run.id)) {
          setTerminalRunRefreshIds((current) => [...current, run.id])
          void loadProjectResources(selectedProjectId)
          const { loadTestCases: refreshCases, loadAllTestCases: refreshAll } = callbackRef.current
          void refreshCases(selectedProjectId)
          void refreshAll()
        }
      },
    })
  }, [activeRun?.id, selectedProjectId, terminalRunRefreshIds, setActiveRun, setTerminalRunRefreshIds, loadProjectResources, callbackRef])

  useEffect(() => {
    if (!agentSession?.warmupRunId) {
      return undefined
    }

    if (activeRun?.id === agentSession.warmupRunId) {
      return undefined
    }

    const existingRun = projectRuns.find((item) => item.id === agentSession.warmupRunId)
    if (existingRun) {
      setActiveRun(existingRun)
      return undefined
    }

    void loadRun(agentSession.warmupRunId).then((run) => {
      if (run) setActiveRun(run)
    }).catch(() => undefined)

    return undefined
  }, [agentSession?.warmupRunId, activeRun?.id, projectRuns, loadRun, setActiveRun])
}