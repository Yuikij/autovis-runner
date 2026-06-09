import { useMemo } from "react"

import type { RecorderSession } from "@autovis/shared"

import { apiRoutes, streamUrl } from "../../apiRoutes"
import type { WorkspaceEffectsParams } from "../types"
import { useEntityStream } from "./useEntityStream"
import type { ProjectSync } from "./useProjectSync"

type RecorderStreamParams = Pick<WorkspaceEffectsParams,
  | "activeRecorderSession"
  | "loadScripts"
  | "selectedCaseId"
  | "selectedProjectId"
  | "setRecorderSessions"
>

const isTerminal = (status: RecorderSession["status"]) =>
  status === "completed" || status === "cancelled" || status === "interrupted" || status === "error"

export function useRecorderStreams({
  activeRecorderSession,
  loadScripts,
  selectedCaseId,
  selectedProjectId,
  setRecorderSessions,
}: RecorderStreamParams, sync: ProjectSync) {
  const streamTarget = useMemo(
    () => (activeRecorderSession ? streamUrl(apiRoutes.recorderSessions.stream(activeRecorderSession.id)) : null),
    [activeRecorderSession?.id],
  )

  useEntityStream<RecorderSession>(streamTarget, (session) => {
    setRecorderSessions((current) => {
      const next = current.filter((item) => item.id !== session.id)
      return [session, ...next]
    })
    if (session.generatedScriptId && selectedCaseId) {
      void loadScripts(selectedCaseId)
    }
    if (isTerminal(session.status) && selectedProjectId) {
      sync.onTerminal(session.id)
    }
  })
}
