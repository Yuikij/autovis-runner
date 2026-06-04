import { useEffect } from "react"

import type { AgentSession } from "@autovis/shared"

import { request } from "../../api"
import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { connectRetryingEventSource } from "./eventSource"

type AgentStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRun"
  | "activeTaskAgentSession"
  | "activeTaskRun"
  | "agentSession"
  | "loadProjectResources"
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

export function useAgentStreams({
  activeRun,
  activeTaskAgentSession,
  activeTaskRun,
  agentSession,
  loadProjectResources,
  loadRun,
  loadScripts,
  projectRuns,
  selectedCaseId,
  selectedProjectId,
  setActiveRun,
  setActiveTaskAgentSession,
  setAgentSession,
  setBusy,
}: AgentStreamParams) {
  useEffect(() => {
    if (!activeTaskRun?.currentAgentId && !activeTaskRun?.lastAgentId) {
      return undefined
    }

    const agentId = activeTaskRun.currentAgentId ?? activeTaskRun.lastAgentId
    if (!agentId) {
      return undefined
    }
    let cancelled = false

    const isTerminal = (status: AgentSession["status"]) => status === "completed" || status === "error" || status === "cancelled" || status === "interrupted"

    void request<AgentSession>(apiRoutes.agent.detail(agentId))
      .then((res) => {
        if (!cancelled) {
          setActiveTaskAgentSession(res.data)
        }
      })
      .catch(() => undefined)

    if (!activeTaskRun.currentAgentId) {
      return () => {
        cancelled = true
      }
    }

    const cleanup = connectRetryingEventSource({
      url: streamUrl(apiRoutes.agent.stream(agentId)),
      onMessage: (event) => {
        const session = JSON.parse(event.data) as AgentSession
        setActiveTaskAgentSession(session)
        if (isTerminal(session.status) && selectedProjectId) {
          void loadProjectResources(selectedProjectId)
        }
      },
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [activeTaskRun?.currentAgentId, activeTaskRun?.lastAgentId, selectedProjectId, setActiveTaskAgentSession, loadProjectResources])

  useEffect(() => {
    const warmupRunId = activeTaskAgentSession?.warmupRunId ?? activeTaskAgentSession?.latestRunId
    if (!warmupRunId || !activeTaskRun?.currentAgentId) {
      return undefined
    }

    if (activeRun?.id === warmupRunId) {
      return undefined
    }

    const existingRun = projectRuns.find((item) => item.id === warmupRunId)
    if (existingRun) {
      setActiveRun(existingRun)
      return undefined
    }

    void loadRun(warmupRunId).then((run) => {
      if (run) setActiveRun(run)
    }).catch(() => undefined)

    return undefined
  }, [activeTaskAgentSession?.warmupRunId, activeTaskAgentSession?.latestRunId, activeTaskRun?.currentAgentId, activeRun?.id, projectRuns, loadRun, setActiveRun])

  useEffect(() => {
    if (activeTaskRun?.currentAgentId) {
      return
    }
    if (activeTaskAgentSession && activeTaskRun?.lastAgentId === activeTaskAgentSession.id) {
      return
    }
    setActiveTaskAgentSession(null)
  }, [activeTaskRun?.id, activeTaskRun?.currentAgentId, activeTaskRun?.lastAgentId, activeTaskAgentSession, setActiveTaskAgentSession])

  useEffect(() => {
    if (!agentSession?.id) {
      return undefined
    }

    const isTerminal = (status: AgentSession["status"]) => status === "completed" || status === "error" || status === "cancelled" || status === "interrupted"

    return connectRetryingEventSource({
      url: streamUrl(apiRoutes.agent.stream(agentSession.id)),
      onMessage: (event) => {
        const session = JSON.parse(event.data) as AgentSession
        setAgentSession(session)
        if (session.latestScriptId && selectedCaseId) {
          void loadScripts(selectedCaseId)
        }
        if (isTerminal(session.status) && selectedProjectId) {
          setBusy(false)
          void loadProjectResources(selectedProjectId)
        }
      },
    })
  }, [agentSession?.id, selectedCaseId, selectedProjectId, setAgentSession, loadScripts, setBusy, loadProjectResources])
}