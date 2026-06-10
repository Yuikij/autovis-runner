import { useEffect, useRef } from "react"
import type { ActiveTasksResponse, AgentSession, CopilotSessionResponse, RecorderSession, TaskRun } from "@autovis/shared"
import { request } from "../api"
import { apiRoutes } from "../apiRoutes"
import { sectionAllows, writeHash } from "../hashRouter"
import type { WorkspaceEffectsParams } from "./types"
import { useAgentStreams } from "./streams/useAgentStreams"
import { useRecorderStreams } from "./streams/useRecorderStreams"
import { useRunStreams } from "./streams/useRunStreams"
import { useTaskRunStreams } from "./streams/useTaskRunStreams"
import { useProjectSync } from "./streams/useProjectSync"

export type WorkspaceEffectParams = WorkspaceEffectsParams

export function useWorkspaceEffects(params: WorkspaceEffectsParams) {
  // One coordinator owns all post-terminal refreshes (coalesced + single-flight),
  // replacing the per-stream refresh fan-out and the three terminal-id arrays.
  const projectSync = useProjectSync({
    selectedProjectId: params.selectedProjectId,
    loaders: params.refreshLoaders,
  })

  useRunStreams(params, projectSync)
  useTaskRunStreams(params, projectSync)
  useRecorderStreams(params, projectSync)
  useAgentStreams(params, projectSync)

  const {
    selectedProject, lastTargetUrlId, setLastTargetUrlId, selectedTask,
    setTaskForm, selectedCase, setCaseForm, activeRun, setActiveRun,
    agentSession, loadProjectResources, loadRun, selectedProjectId, setTaskRuns,
    activeTaskRun, activeRecorderSession, setRecorderSessions,
    selectedCaseId, setAgentSession, llmSession, setClock,
    copilotPolling, clock, setCopilotPolling, copilotModel,
    loadLlmSession, setError, initialized, activeSection, selectedTaskId,
    parseHash, setActiveSection, setSelectedProjectId, setSelectedTaskId,
    setSelectedCaseId, setActiveTaskRunId, setActiveRecorderSessionId,
  } = params
  const rehydratedRef = useRef(false)

  // 切换项目时：若 lastTargetUrlId 不属于当前项目（或为空），自动回落到该项目的主域名 TargetUrl。
  useEffect(() => {
    if (!selectedProject) return
    const urls = selectedProject.targetUrls ?? []
    const matched = lastTargetUrlId && urls.find((u) => u.id === lastTargetUrlId)
    if (matched) return
    const primary = urls.find((u) => u.isPrimary) ?? urls[0]
    const nextId = primary?.id ?? ""
    setLastTargetUrlId(nextId)
    if (typeof window !== "undefined") {
      if (nextId) localStorage.setItem("autovis_last_target_url_id", nextId)
      else localStorage.removeItem("autovis_last_target_url_id")
    }
  }, [selectedProject?.id, selectedProject?.targetUrls, lastTargetUrlId, setLastTargetUrlId])

  // 选中已保存任务时，把任务回填到编辑表单；无选中任务则保持当前草稿。
  useEffect(() => {
    if (!selectedTask) {
      return
    }

    setTaskForm({
      id: selectedTask.id,
      name: selectedTask.name,
      description: selectedTask.description ?? "",
      items: selectedTask.items.map((item) => ({ caseId: item.caseId, targetUrlId: item.targetUrlId })),
      executionMode: selectedTask.executionMode ?? { kind: "oneshot" },
    })
  }, [selectedTask?.id, selectedTask, setTaskForm])

  useEffect(() => {
    if (!selectedCase) {
      return
    }

    setCaseForm({
      id: selectedCase.id,
      caseCode: selectedCase.caseCode,
      moduleName: selectedCase.moduleName,
      moduleId: selectedCase.moduleId ?? "",
      purpose: selectedCase.purpose,
      dependencyCaseIds: selectedCase.dependencyCaseIds,
      authProfileId: selectedCase.authProfileId ?? undefined,
      steps: selectedCase.steps.length ? selectedCase.steps : [""],
      expectedResult: selectedCase.expectedResult,
      testType: selectedCase.testType,
      bugId: selectedCase.bugId ?? "",
      note: selectedCase.note ?? "",
      aiScript: selectedCase.aiScript ?? "",
      defaultTargetUrlId: selectedCase.defaultTargetUrlId ?? undefined,
    })
  }, [selectedCase?.id, selectedCase, setCaseForm])

  useEffect(() => {
    if (!llmSession?.pendingDeviceAuth) {
      return undefined
    }

    const timer = window.setInterval(() => {
      setClock(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [llmSession?.pendingDeviceAuth?.userCode, setClock])

  useEffect(() => {
    const pending = llmSession?.pendingDeviceAuth
    if (!pending || llmSession.connectionStatus !== "authorizing" || copilotPolling) {
      return undefined
    }

    const expiresAt = new Date(pending.expiresAt).getTime()
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      setCopilotPolling(true)
      request<CopilotSessionResponse>(apiRoutes.llm.copilotDevicePoll(), {
        method: "POST",
        body: JSON.stringify({ model: copilotModel }),
      })
        .then(() => Promise.all([loadLlmSession(), selectedProjectId ? loadProjectResources(selectedProjectId) : Promise.resolve()]))
        .catch((reason) => setError((reason as Error).message))
        .finally(() => setCopilotPolling(false))
    }, Math.max(1000, pending.intervalSeconds * 1000))

    return () => {
      window.clearTimeout(timeout)
    }
  }, [copilotModel, copilotPolling, llmSession, selectedProjectId, setCopilotPolling, loadLlmSession, loadProjectResources, setError])

  // Synchronize React state to URL Hash (includes active task IDs)
  useEffect(() => {
    if (!initialized) return
    const currentHash = parseHash()
    if (!rehydratedRef.current && (currentHash.agentSessionId || currentHash.runId || currentHash.taskRunId || currentHash.recorderSessionId)) {
      return
    }

    const agentLive = agentSession?.status === "running"
      || agentSession?.status === "paused"
      || agentSession?.status === "cancelling"
    const runLive = activeRun?.status === "running"
      || activeRun?.status === "paused"
      || activeRun?.status === "awaiting_human"
      || activeRun?.status === "cancelling"
      || activeRun?.status === "queued"
    const recorderLive = activeRecorderSession?.status === "running"
      || activeRecorderSession?.status === "paused"
      || activeRecorderSession?.status === "starting"
    const hashRunId = activeSection === "runs"
      ? activeTaskRun?.id
        ? null
        : activeRun?.id
      : activeSection === "workbench" && runLive
      ? activeRun?.id
      : null
    const hashTaskRunId = activeSection === "runs" ? activeTaskRun?.id : null
    const hashRecorderSessionId = activeSection === "runs"
      ? activeRecorderSession?.id
      : recorderLive
      ? activeRecorderSession?.id
      : null

    writeHash({
      section: activeSection,
      projectId: selectedProjectId,
      taskId: selectedTaskId,
      caseId: selectedCaseId,
      agentSessionId: agentLive ? agentSession?.id : null,
      runId: hashRunId,
      taskRunId: hashTaskRunId,
      recorderSessionId: hashRecorderSessionId,
    })
  }, [activeSection, selectedProjectId, selectedTaskId, selectedCaseId, initialized, parseHash, agentSession?.id, agentSession?.status, activeRun?.id, activeRun?.status, activeTaskRun?.id, activeTaskRun?.status, activeRecorderSession?.id, activeRecorderSession?.status])

  // Synchronize URL Hash change to React state.
  // Only push hash[key] into state when the target section actually owns that key —
  // otherwise navigating Dashboard → ... would clobber selectedProjectId to null.
  useEffect(() => {
    const handleHashChange = () => {
      const hashData = parseHash()
      setActiveSection((curr) => (curr !== hashData.section ? hashData.section : curr))
      if (sectionAllows(hashData.section, "projectId")) {
        setSelectedProjectId((curr) => (curr !== hashData.projectId ? hashData.projectId : curr))
      }
      if (sectionAllows(hashData.section, "taskId")) {
        setSelectedTaskId((curr) => (curr !== hashData.taskId ? hashData.taskId : curr))
      }
      if (sectionAllows(hashData.section, "caseId")) {
        setSelectedCaseId((curr) => (curr !== hashData.caseId ? hashData.caseId : curr))
      }
      if (sectionAllows(hashData.section, "runId")) {
        if (hashData.runId) {
          const runId = hashData.runId
          void loadRun(runId).then((run) => {
            if (run && parseHash().runId === runId) setActiveRun(run)
          }).catch(() => undefined)
        } else if (hashData.section === "workbench" || (hashData.section === "runs" && !hashData.taskRunId)) {
          setActiveRun(null)
        }
      }
      if (sectionAllows(hashData.section, "taskRunId")) {
        if (hashData.taskRunId) {
          const taskRunId = hashData.taskRunId
          request<TaskRun>(apiRoutes.taskRuns.detail(taskRunId))
            .then((res) => {
              if (parseHash().taskRunId !== taskRunId) return
              setTaskRuns((current) => {
                const next = current.filter((item) => item.id !== res.data.id)
                return [res.data, ...next]
              })
              setActiveTaskRunId?.(res.data.id)
            })
            .catch(() => undefined)
        } else if (hashData.section === "runs") {
          setActiveTaskRunId?.(null)
        }
      }
      if (sectionAllows(hashData.section, "recorderSessionId")) {
        if (hashData.recorderSessionId) {
          const recorderSessionId = hashData.recorderSessionId
          request<RecorderSession>(apiRoutes.recorderSessions.detail(recorderSessionId))
            .then((res) => {
              if (parseHash().recorderSessionId !== recorderSessionId) return
              setRecorderSessions((current) => {
                const next = current.filter((item) => item.id !== res.data.id)
                return [res.data, ...next]
              })
              setActiveRecorderSessionId?.(res.data.id)
            })
            .catch(() => undefined)
        } else if (hashData.section === "runs") {
          setActiveRecorderSessionId?.(null)
        }
      }
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => {
      window.removeEventListener("hashchange", handleHashChange)
    }
  }, [parseHash, setActiveSection, setSelectedProjectId, setSelectedTaskId, setSelectedCaseId, loadRun, setActiveRun, setTaskRuns, setActiveTaskRunId, setRecorderSessions, setActiveRecorderSessionId])

  // Rehydrate in-flight tasks: URL hash IDs first, then project-level active tasks
  useEffect(() => {
    if (!initialized || !selectedProjectId) return
    if (rehydratedRef.current) return
    rehydratedRef.current = true

    const hashData = parseHash()

    const adoptAgent = (id: string) => {
      request<AgentSession>(apiRoutes.agent.detail(id))
        .then((res) => setAgentSession(res.data))
        .catch(() => undefined)
    }
    const adoptRun = (id: string) => {
      void loadRun(id).then((run) => {
        if (run) setActiveRun(run)
      }).catch(() => undefined)
    }
    const adoptTaskRun = (id: string) => {
      request<TaskRun>(apiRoutes.taskRuns.detail(id))
        .then((res) => {
          setTaskRuns((current) => {
            const next = current.filter((item) => item.id !== res.data.id)
            return [res.data, ...next]
          })
          setActiveTaskRunId?.(res.data.id)
        })
        .catch(() => undefined)
    }
    const adoptRecorder = (id: string) => {
      request<RecorderSession>(apiRoutes.recorderSessions.detail(id))
        .then((res) => {
          setRecorderSessions((current) => {
            const next = current.filter((item) => item.id !== res.data.id)
            return [res.data, ...next]
          })
          setActiveRecorderSessionId?.(res.data.id)
        })
        .catch(() => undefined)
    }

    let adoptedAgent = false
    let adoptedRun = false
    let adoptedTaskRun = false
    let adoptedRecorder = false

    if (hashData.agentSessionId) { adoptAgent(hashData.agentSessionId); adoptedAgent = true }
    if (hashData.runId) { adoptRun(hashData.runId); adoptedRun = true }
    if (hashData.taskRunId) { adoptTaskRun(hashData.taskRunId); adoptedTaskRun = true }
    if (hashData.recorderSessionId) { adoptRecorder(hashData.recorderSessionId); adoptedRecorder = true }

    if (adoptedAgent && adoptedRun && adoptedTaskRun && adoptedRecorder) return

    request<ActiveTasksResponse>(apiRoutes.projects.activeTasks(selectedProjectId))
      .then((res) => {
        if (!adoptedAgent && res.data.agents[0]) setAgentSession(res.data.agents[0])
        if (!adoptedRun && res.data.runs[0]) setActiveRun(res.data.runs[0])
        if (!adoptedTaskRun && res.data.taskRuns[0]) {
          const adopted = res.data.taskRuns[0]
          setTaskRuns((current) => {
            const next = current.filter((item) => item.id !== adopted.id)
            return [adopted, ...next]
          })
          setActiveTaskRunId?.(adopted.id)
        }
        if (!adoptedRecorder && res.data.recorderSessions[0]) {
          const adopted = res.data.recorderSessions[0]
          setRecorderSessions((current) => {
            const next = current.filter((item) => item.id !== adopted.id)
            return [adopted, ...next]
          })
          setActiveRecorderSessionId?.(adopted.id)
        }
      })
      .catch(() => undefined)
  }, [initialized, selectedProjectId, parseHash, loadRun, setActiveRun, setAgentSession, setTaskRuns, setRecorderSessions, setActiveTaskRunId, setActiveRecorderSessionId])
}
