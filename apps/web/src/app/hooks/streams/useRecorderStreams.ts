import { useEffect } from "react"

import type { RecorderSession } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { connectRetryingEventSource } from "./eventSource"

type RecorderStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRecorderSession"
  | "callbackRef"
  | "loadProjectResources"
  | "loadScripts"
  | "selectedCaseId"
  | "selectedProjectId"
  | "setRecorderSessions"
  | "setTerminalRecorderRefreshIds"
  | "terminalRecorderRefreshIds"
>

export function useRecorderStreams({
  activeRecorderSession,
  callbackRef,
  loadProjectResources,
  loadScripts,
  selectedCaseId,
  selectedProjectId,
  setRecorderSessions,
  setTerminalRecorderRefreshIds,
  terminalRecorderRefreshIds,
}: RecorderStreamParams) {
  useEffect(() => {
    if (!activeRecorderSession) {
      return undefined
    }

    const isTerminal = (status: RecorderSession["status"]) => status === "completed" || status === "cancelled" || status === "interrupted" || status === "error"

    return connectRetryingEventSource({
      url: streamUrl(apiRoutes.recorderSessions.stream(activeRecorderSession.id)),
      onMessage: (event) => {
        const session = JSON.parse(event.data) as RecorderSession
        setRecorderSessions((current) => {
          const next = current.filter((item) => item.id !== session.id)
          return [session, ...next]
        })
        if (session.generatedScriptId && selectedCaseId) {
          void loadScripts(selectedCaseId)
        }
        if (isTerminal(session.status) && selectedProjectId && !terminalRecorderRefreshIds.includes(session.id)) {
          setTerminalRecorderRefreshIds((current) => [...current, session.id])
          void loadProjectResources(selectedProjectId)
          const { loadTestCases: refreshCases, loadAllTestCases: refreshAll } = callbackRef.current
          void refreshCases(selectedProjectId)
          void refreshAll()
        }
      },
    })
  }, [activeRecorderSession?.id, selectedCaseId, selectedProjectId, terminalRecorderRefreshIds, setRecorderSessions, loadScripts, setTerminalRecorderRefreshIds, loadProjectResources, callbackRef])
}