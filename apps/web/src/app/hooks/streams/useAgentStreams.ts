import { useEffect, useMemo, useRef } from "react"

import type { AgentSession } from "@autovis/shared"

import { request } from "../../api"
import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { useEntityStream } from "./useEntityStream"
import type { ProjectSync } from "./useProjectSync"

type AgentStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeTaskAgentSession"
  | "activeTaskRun"
  | "agentSession"
  | "loadRun"
  | "loadScripts"
  | "projectRuns"
  | "selectedCaseId"
  | "selectedProjectId"
  | "setActiveRun"
  | "setActiveTaskAgentSession"
  | "setAgentSession"
  | "setBusy"
>

const isTerminal = (status: AgentSession["status"]) =>
  status === "completed" || status === "error" || status === "cancelled" || status === "interrupted"

export function useAgentStreams({
  activeRun,
  activeTaskAgentSession,
  activeTaskRun,
  agentSession,
  loadRun,
  loadScripts,
  projectRuns,
  selectedCaseId,
  selectedProjectId,
  setActiveRun,
  setActiveTaskAgentSession,
  setAgentSession,
  setBusy,
}: AgentStreamParams, sync: ProjectSync) {
  const projectRunsRef = useRef(projectRuns)

  useEffect(() => {
    projectRunsRef.current = projectRuns
  }, [projectRuns])

  // One-shot hydrate of the active task run's current/last agent session.
  useEffect(() => {
    const agentId = activeTaskRun?.currentAgentId ?? activeTaskRun?.lastAgentId
    if (!agentId) {
      return undefined
    }
    let cancelled = false
    void request<AgentSession>(apiRoutes.agent.detail(agentId))
      .then((res) => {
        if (!cancelled) setActiveTaskAgentSession(res.data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeTaskRun?.currentAgentId, activeTaskRun?.lastAgentId, setActiveTaskAgentSession])

  // Live updates only while a *current* agent is attached to the task run.
  const taskAgentStreamTarget = useMemo(
    () => (activeTaskRun?.currentAgentId ? streamUrl(apiRoutes.agent.stream(activeTaskRun.currentAgentId)) : null),
    [activeTaskRun?.currentAgentId],
  )
  useEntityStream<AgentSession>(taskAgentStreamTarget, (session) => {
    setActiveTaskAgentSession(session)
    if (isTerminal(session.status) && selectedProjectId) {
      sync.onTerminal(session.id, ["cases", "runs"])
    }
  })

  useEffect(() => {
    const warmupRunId = activeTaskAgentSession?.warmupRunId ?? activeTaskAgentSession?.latestRunId
    if (!warmupRunId || !activeTaskRun?.currentAgentId) {
      return undefined
    }

    if (activeRun?.id === warmupRunId) {
      return undefined
    }

    const existingRun = projectRunsRef.current.find((item) => item.id === warmupRunId)
    if (existingRun) {
      setActiveRun(existingRun)
      return undefined
    }

    void loadRun(warmupRunId).then((run) => {
      if (run) setActiveRun(run)
    }).catch(() => undefined)

    return undefined
  }, [activeTaskAgentSession?.warmupRunId, activeTaskAgentSession?.latestRunId, activeTaskRun?.currentAgentId, activeRun?.id, loadRun, setActiveRun])

  useEffect(() => {
    if (activeTaskRun?.currentAgentId) {
      return
    }
    if (activeTaskAgentSession && activeTaskRun?.lastAgentId === activeTaskAgentSession.id) {
      return
    }
    setActiveTaskAgentSession(null)
  }, [activeTaskRun?.id, activeTaskRun?.currentAgentId, activeTaskRun?.lastAgentId, activeTaskAgentSession, setActiveTaskAgentSession])

  const agentStreamTarget = useMemo(
    () => (agentSession?.id ? streamUrl(apiRoutes.agent.stream(agentSession.id)) : null),
    [agentSession?.id],
  )
  useEntityStream<AgentSession>(agentStreamTarget, (session) => {
    setAgentSession(session)
    if (session.latestScriptId && selectedCaseId) {
      void loadScripts(selectedCaseId)
    }
    if (isTerminal(session.status) && selectedProjectId) {
      setBusy(false)
      sync.onTerminal(session.id, ["cases", "runs"])
    }
  })
}
