import { useEffect, useRef } from "react"
import type { ActiveTasksResponse, AgentSession, CopilotSessionResponse, ExecutionRun, RecorderSession, TaskRun } from "@autovis/shared"
import { request } from "../api"
import { apiRoutes, streamUrl } from "../apiRoutes"
import { sectionAllows, writeHash } from "../hashRouter"
import type { WorkspaceEffectsParams } from "./types"

export type WorkspaceEffectParams = WorkspaceEffectsParams

export function useWorkspaceEffects(params: WorkspaceEffectsParams) {
  const {
    selectedProject, lastTargetUrlId, setLastTargetUrlId, selectedTask,
    taskForm, setTaskForm, selectedCase, caseForm, setCaseForm,
    activeRun, setActiveRun, setWorkbenchVerificationRunId, projectRuns,
    agentSession, loadRun, selectedProjectId, terminalRunRefreshIds,
    setTerminalRunRefreshIds, loadProjectResources, callbackRef,
    activeTaskRun, setTaskRuns, taskRuns, terminalTaskRunRefreshIds,
    setTerminalTaskRunRefreshIds, activeRecorderSession, setRecorderSessions,
    recorderSessions, selectedCaseId, loadScripts, terminalRecorderRefreshIds,
    setTerminalRecorderRefreshIds, setAgentSession, setBusy, llmSession,
    setClock, copilotPolling, clock, setCopilotPolling, copilotModel,
    loadLlmSession, setError, initialized, activeSection, selectedTaskId,
    parseHash, setActiveSection, setSelectedProjectId, setSelectedTaskId,
    setSelectedCaseId, setActiveTaskRunId, setActiveRecorderSessionId,
  } = params
  const rehydratedRef = useRef(false)
  const activeRunRef = useRef<ExecutionRun | null>(activeRun)
  // 记录所有"生成期预热运行"的 id。预热运行也是 kind:"temporary"，
  // 但它属于脚本生成过程（用于准备前置依赖/浏览器状态），绝不能被当成验证运行。
  // 用 ref 保存，确保即便生成结束后 agentSession.warmupRunId 被清空，也仍能识别出它。
  const warmupRunIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    activeRunRef.current = activeRun
  }, [activeRun])

  useEffect(() => {
    if (agentSession?.warmupRunId) {
      warmupRunIdsRef.current.add(agentSession.warmupRunId)
    }
  }, [agentSession?.warmupRunId])

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
    })
  }, [selectedCase?.id, selectedCase, setCaseForm])

  useEffect(() => {
    if (!selectedCase || !activeRun || activeRun.testCaseId === selectedCase.id) {
      return
    }
    setActiveRun(null)
    setWorkbenchVerificationRunId(null)
  }, [selectedCase?.id, activeRun?.id, selectedCase, activeRun, setActiveRun, setWorkbenchVerificationRunId])

  // Auto-adopt a rehydrated temporary run as the workbench verification run
  useEffect(() => {
    if (!activeRun || !selectedCase) return
    if (activeRun.kind !== "temporary") return
    if (activeRun.testCaseId !== selectedCase.id) return
    // 生成期的预热运行不是验证运行：若被采用，生成结束后沙盒会从"智能体思考链"
    // 切换到"验证步骤"，导致脚本生成过程记录消失。这里显式跳过预热运行。
    if (agentSession?.warmupRunId === activeRun.id) return
    if (warmupRunIdsRef.current.has(activeRun.id)) return
    setWorkbenchVerificationRunId((current) => (current === activeRun.id ? current : activeRun.id))
  }, [activeRun?.id, activeRun?.kind, activeRun?.testCaseId, selectedCase?.id, agentSession?.warmupRunId, setWorkbenchVerificationRunId])

  useEffect(() => {
    if (activeRun) {
      if (activeRun.kind === "temporary") {
        return
      }
      const synced = projectRuns.find((item) => item.id === activeRun.id)
      if (synced) {
        setActiveRun(synced)
      }
      return
    }

    if (projectRuns[0]) {
      setActiveRun(projectRuns[0])
    }
  }, [projectRuns, activeRun, setActiveRun])

  useEffect(() => {
    if (!activeRun) {
      return undefined
    }

    const runId = activeRun.id
    let cancelled = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let attempt = 0

    const isTerminal = (status: ExecutionRun["status"]) => status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

    const connect = () => {
      if (cancelled) return
      source = new EventSource(streamUrl(apiRoutes.runs.stream(runId)))
      source.onopen = () => {
        attempt = 0
      }
      source.onmessage = (event) => {
        const run = JSON.parse(event.data) as ExecutionRun
        setActiveRun(run)
        if (isTerminal(run.status) && selectedProjectId && !terminalRunRefreshIds.includes(run.id)) {
          setTerminalRunRefreshIds((current) => [...current, run.id])
          void loadProjectResources(selectedProjectId)
          const { loadTestCases: refreshCases, loadAllTestCases: refreshAll } = callbackRef.current
          if (selectedProjectId) {
            void refreshCases(selectedProjectId)
          }
          void refreshAll()
        }
      }
      source.onerror = () => {
        if (cancelled) return
        source?.close()
        source = null
        attempt += 1
        const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
        retryTimer = window.setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      source?.close()
    }
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

  useEffect(() => {
    if (!activeTaskRun) {
      return undefined
    }

    const taskRunId = activeTaskRun.id
    let cancelled = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let attempt = 0

    const isTerminal = (status: TaskRun["status"]) => status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"

    const connect = () => {
      if (cancelled) return
      source = new EventSource(streamUrl(apiRoutes.taskRuns.stream(taskRunId)))
      source.onopen = () => { attempt = 0 }
      source.onmessage = (event) => {
        const taskRun = JSON.parse(event.data) as TaskRun
        setTaskRuns((current) => {
          const next = current.filter((item) => item.id !== taskRun.id)
          return [taskRun, ...next]
        })
        if (taskRun.currentRunId) {
          const currentActiveRun = activeRunRef.current
          // If the user has explicitly selected a terminal run (passed/failed/etc.) that is NOT the currently running one,
          // do NOT auto-switch them away to the new currentRunId.
          const isUserInspectingDiffFinishedRun = currentActiveRun &&
            currentActiveRun.id !== taskRun.currentRunId &&
            (currentActiveRun.status === "passed" ||
             currentActiveRun.status === "failed" ||
             currentActiveRun.status === "cancelled" ||
             currentActiveRun.status === "interrupted");

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
          if (selectedProjectId) {
            void refreshCases(selectedProjectId)
          }
          void refreshAll()
        }
      }
      source.onerror = () => {
        if (cancelled) return
        source?.close()
        source = null
        attempt += 1
        const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
        retryTimer = window.setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [activeTaskRun?.id, selectedProjectId, terminalTaskRunRefreshIds, setTaskRuns, projectRuns, setActiveRun, loadRun, setTerminalTaskRunRefreshIds, loadProjectResources, callbackRef])

  useEffect(() => {
    if (!activeRecorderSession) {
      return undefined
    }

    const recorderId = activeRecorderSession.id
    let cancelled = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let attempt = 0

    const isTerminal = (status: RecorderSession["status"]) => status === "completed" || status === "cancelled" || status === "interrupted" || status === "error"

    const connect = () => {
      if (cancelled) return
      source = new EventSource(streamUrl(apiRoutes.recorderSessions.stream(recorderId)))
      source.onopen = () => { attempt = 0 }
      source.onmessage = (event) => {
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
          if (selectedProjectId) {
            void refreshCases(selectedProjectId)
          }
          void refreshAll()
        }
      }
      source.onerror = () => {
        if (cancelled) return
        source?.close()
        source = null
        attempt += 1
        const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
        retryTimer = window.setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [activeRecorderSession?.id, selectedCaseId, selectedProjectId, terminalRecorderRefreshIds, setRecorderSessions, loadScripts, setTerminalRecorderRefreshIds, loadProjectResources, callbackRef])

  useEffect(() => {
    if (!agentSession?.id) {
      return undefined
    }

    const agentId = agentSession.id
    let cancelled = false
    let source: EventSource | null = null
    let retryTimer: number | null = null
    let attempt = 0

    const isTerminal = (status: AgentSession["status"]) => status === "completed" || status === "error" || status === "cancelled" || status === "interrupted"

    const connect = () => {
      if (cancelled) return
      source = new EventSource(streamUrl(apiRoutes.agent.stream(agentId)))
      source.onopen = () => { attempt = 0 }
      source.onmessage = (event) => {
        const session = JSON.parse(event.data) as AgentSession
        setAgentSession(session)
        if (session.latestScriptId && selectedCaseId) {
          void loadScripts(selectedCaseId)
        }
        if (isTerminal(session.status) && selectedProjectId) {
          setBusy(false)
          void loadProjectResources(selectedProjectId)
          const { loadTestCases: refreshCases, loadAllTestCases: refreshAll } = callbackRef.current
          if (selectedProjectId) {
            void refreshCases(selectedProjectId)
          }
          void refreshAll()
        }
      }
      source.onerror = () => {
        if (cancelled) return
        source?.close()
        source = null
        attempt += 1
        const delay = Math.min(15_000, 500 * Math.pow(2, attempt))
        retryTimer = window.setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      source?.close()
    }
  }, [agentSession?.id, selectedCaseId, selectedProjectId, setAgentSession, loadScripts, setBusy, loadProjectResources, callbackRef])

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

    const agentLive = agentSession?.status === "running"
      || agentSession?.status === "paused"
      || agentSession?.status === "cancelling"
    const runLive = activeRun?.status === "running"
      || activeRun?.status === "paused"
      || activeRun?.status === "awaiting_human"
      || activeRun?.status === "cancelling"
      || activeRun?.status === "queued"
    const taskRunLive = activeTaskRun?.status === "running"
      || activeTaskRun?.status === "paused"
      || activeTaskRun?.status === "cancelling"
      || activeTaskRun?.status === "queued"
    const recorderLive = activeRecorderSession?.status === "running"
      || activeRecorderSession?.status === "paused"
      || activeRecorderSession?.status === "starting"

    writeHash({
      section: activeSection,
      projectId: selectedProjectId,
      taskId: selectedTaskId,
      caseId: selectedCaseId,
      agentSessionId: agentLive ? agentSession?.id : null,
      runId: runLive ? activeRun?.id : null,
      taskRunId: taskRunLive ? activeTaskRun?.id : null,
      recorderSessionId: recorderLive ? activeRecorderSession?.id : null,
    })
  }, [activeSection, selectedProjectId, selectedTaskId, selectedCaseId, initialized, agentSession?.id, agentSession?.status, activeRun?.id, activeRun?.status, activeTaskRun?.id, activeTaskRun?.status, activeRecorderSession?.id, activeRecorderSession?.status])

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
    }

    window.addEventListener("hashchange", handleHashChange)
    return () => {
      window.removeEventListener("hashchange", handleHashChange)
    }
  }, [parseHash, setActiveSection, setSelectedProjectId, setSelectedTaskId, setSelectedCaseId])

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
