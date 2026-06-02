import type { WorkspaceActionParams } from "../types"
import { request } from "../../api"
import { apiRoutes } from "../../apiRoutes"
import type { ExecutionRun, RecorderInteractionRequest, RecorderSession, ScriptArtifact } from "@autovis/shared"

export function useRecorderActions(params: WorkspaceActionParams) {
  const {
    selectedProject,
    selectedCase,
    setBusy,
    setError,
    setRecorderSessions,
    setActiveRecorderSessionId,
    setActiveSection,
    setSelectedScriptId,
    setActiveRun,
    setActiveTaskRunId,
    setWorkbenchVerificationRunId,
    loadScripts,
    loadProjectResources,
    loadTestCases,
  } = params

  const startRecorder = async (targetUrlId: string) => {
    if (!selectedProject || !selectedCase) return

    setBusy(true)
    setError(null)
    try {
      const result = await request<RecorderSession>(apiRoutes.recorderSessions.create(), {
        method: "POST",
        body: JSON.stringify({
          projectId: selectedProject.id,
          testCaseId: selectedCase.id,
          targetUrlId,
        }),
      })
      setRecorderSessions((current) => [result.data, ...current.filter((item) => item.id !== result.data.id)])
      setActiveRecorderSessionId(result.data.id)
      setActiveSection("workbench")
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sendRecorderInteraction = async (sessionId: string, interaction: RecorderInteractionRequest) => {
    try {
      const result = await request<RecorderSession>(apiRoutes.recorderSessions.interactions(sessionId), {
        method: "POST",
        body: JSON.stringify(interaction),
      })
      setRecorderSessions((current) => [result.data, ...current.filter((item) => item.id !== result.data.id)])
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const stopRecorder = async (sessionId: string, runAfterSave = false) => {
    setBusy(true)
    setError(null)
    try {
      const result = await request<{ session: RecorderSession; script?: ScriptArtifact; run?: ExecutionRun }>(apiRoutes.recorderSessions.stop(sessionId), {
        method: "POST",
        body: JSON.stringify({ saveAsScript: true, runAfterSave }),
      })
      setRecorderSessions((current) => [result.data.session, ...current.filter((item) => item.id !== result.data.session.id)])
      setActiveRecorderSessionId(result.data.session.id)
      if (result.data.script?.id) {
        setSelectedScriptId(result.data.script.id)
      }
      if (result.data.run) {
        setActiveTaskRunId(null)
        setWorkbenchVerificationRunId(result.data.run.id)
        setActiveRun(result.data.run)
      }
      if (selectedCase) {
        await loadScripts(selectedCase.id)
      }
      if (selectedProject) {
        await loadProjectResources(selectedProject.id)
        await loadTestCases(selectedProject.id)
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return {
    startRecorder,
    sendRecorderInteraction,
    stopRecorder,
  }
}
