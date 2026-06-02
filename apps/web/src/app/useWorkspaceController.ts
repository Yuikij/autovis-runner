import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  AgentSession,
  ExecutionRun,
  GitAuthProfile,
  LlmState,
  LlmSessionConfig,
  Module,
  Project,
  ProjectWorkspace,
  RecorderSession,
  ScriptArtifact,
  Task,
  TaskRun,
  TestCase,
  UpsertLlmConfigRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertTaskRequest,
  UpsertTestCaseRequest,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
  AuthProfile,
} from "@autovis/shared"
import { request } from "./api"
import { apiRoutes } from "./apiRoutes"
import { defaultCopilotModel, defaultRecorderUrl, defaultScriptPrompt, type WorkspaceSection } from "./constants"
import { parseHash } from "./hashRouter"
import { useWorkspaceEffects } from "./hooks/useWorkspaceEffects"
import { useWorkspaceActions } from "./useWorkspaceActions"
import { emptyCaseForm, emptyProjectForm, emptyTaskForm, emptyWorkspaceForm } from "./workspaceForms"

export function useWorkspaceController() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(() => parseHash().section)
  const [initialized, setInitialized] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => parseHash().projectId)
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => parseHash().taskId)
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [allCases, setAllCases] = useState<TestCase[]>([])
  const [modules, setModules] = useState<Module[]>([])
  const [projectWorkspace, setProjectWorkspace] = useState<ProjectWorkspace | null>(null)
  const [gitAuthProfiles, setGitAuthProfiles] = useState<GitAuthProfile[]>([])
  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([])
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceTreeEntry[]>([])
  const [workspaceSearchResults, setWorkspaceSearchResults] = useState<WorkspaceSearchMatch[]>([])
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<WorkspaceFileContent | null>(null)
  const [projectRuns, setProjectRuns] = useState<ExecutionRun[]>([])
  const [taskRuns, setTaskRuns] = useState<TaskRun[]>([])
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null)
  const [recorderSessions, setRecorderSessions] = useState<RecorderSession[]>([])
  const [activeRecorderSessionId, setActiveRecorderSessionId] = useState<string | null>(null)
  const [llmSession, setLlmSession] = useState<LlmSessionConfig | null>(null)
  const [llmConfigs, setLlmConfigs] = useState<LlmSessionConfig[]>([])
  const [activeLlmConfigId, setActiveLlmConfigId] = useState<string | null>(null)
  const [activeVisionConfigId, setActiveVisionConfigId] = useState<string | null>(null)
  const [scripts, setScripts] = useState<ScriptArtifact[]>([])
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => parseHash().caseId)
  const [copilotModel, setCopilotModel] = useState(defaultCopilotModel)
  const [prompt, setPrompt] = useState(defaultScriptPrompt)
  const [activeRun, setActiveRun] = useState<ExecutionRun | null>(null)
  const [workbenchVerificationRunId, setWorkbenchVerificationRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [terminalRunRefreshIds, setTerminalRunRefreshIds] = useState<string[]>([])
  const [terminalTaskRunRefreshIds, setTerminalTaskRunRefreshIds] = useState<string[]>([])
  const [terminalRecorderRefreshIds, setTerminalRecorderRefreshIds] = useState<string[]>([])
  const [copilotPolling, setCopilotPolling] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [lastTargetUrlId, setLastTargetUrlId] = useState(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("autovis_last_target_url_id") || ""
  })
  const [projectForm, setProjectForm] = useState<UpsertProjectRequest>(emptyProjectForm)
  const [workspaceForm, setWorkspaceForm] = useState<UpsertProjectWorkspaceRequest>(emptyWorkspaceForm)
  const [taskForm, setTaskForm] = useState<Omit<UpsertTaskRequest, "projectId">>(emptyTaskForm)
  const [caseForm, setCaseForm] = useState<Omit<UpsertTestCaseRequest, "projectId">>(emptyCaseForm)
  const [llmConfigForm, setLlmConfigForm] = useState<UpsertLlmConfigRequest>({
    name: "GitHub Copilot",
    provider: "copilot-proxy",
    model: defaultCopilotModel,
    baseUrl: "https://api.githubcopilot.com",
    apiKey: "",
  })

  const [theme, setThemeState] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    return (localStorage.getItem("autovis_theme") as "light" | "dark") || "light"
  })

  const setTheme = useCallback((nextTheme: "light" | "dark") => {
    setThemeState(nextTheme)
    if (typeof window !== "undefined") {
      localStorage.setItem("autovis_theme", nextTheme)
      if (nextTheme === "dark") {
        document.documentElement.classList.add("dark")
      } else {
        document.documentElement.classList.remove("dark")
      }
    }
  }, [])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  const loadProjects = useCallback(async () => {
    const result = await request<Project[]>(apiRoutes.projects.list())
    setProjects(result.data)
    setSelectedProjectId((current) => {
      // If the currently selected ID (e.g. from hash) exists, keep it.
      if (current && result.data.some((item) => item.id === current)) {
        return current
      }
      return result.data[0]?.id ?? null
    })
    return result.data
  }, [])

  const loadLlmSession = useCallback(async () => {
    const result = await request<LlmState>(apiRoutes.llm.state())
    setLlmSession(result.data.session)
    setLlmConfigs(result.data.configs)
    setActiveLlmConfigId(result.data.activeConfigId ?? result.data.session.id)
    setActiveVisionConfigId(result.data.activeVisionConfigId ?? null)
    setCopilotModel(result.data.session.model)
    return result.data
  }, [])

  const loadTasks = useCallback(async (projectId: string) => {
    const result = await request<Task[]>(apiRoutes.projects.tasks(projectId))
    setTasks(result.data)
    setSelectedTaskId((current) => {
      if (current && result.data.some((item) => item.id === current)) {
        return current
      }
      return result.data[0]?.id ?? null
    })
    return result.data
  }, [])

  const loadTestCases = useCallback(async (projectId: string) => {
    const result = await request<TestCase[]>(apiRoutes.projects.testCases(projectId))
    setTestCases(result.data)
    setSelectedCaseId((current) => {
      if (current && result.data.some((item) => item.id === current)) {
        return current
      }
      return result.data[0]?.id ?? null
    })
    return result.data
  }, [])

  const loadProjectResources = useCallback(async (projectId: string) => {
    const [
      tasksResult,
      runsResult,
      taskRunsResult,
      recorderSessionsResult,
      modulesResult,
      testCasesResult,
      workspaceResult,
      gitAuthProfilesResult,
      authProfilesResult,
    ] = await Promise.all([
      request<Task[]>(apiRoutes.projects.tasks(projectId)),
      request<ExecutionRun[]>(apiRoutes.projects.runs(projectId)),
      request<TaskRun[]>(apiRoutes.projects.taskRuns(projectId)),
      request<RecorderSession[]>(apiRoutes.projects.recorderSessions(projectId)),
      request<Module[]>(apiRoutes.projects.modules(projectId)),
      request<TestCase[]>(apiRoutes.projects.testCases(projectId)),
      request<ProjectWorkspace | null>(apiRoutes.projects.workspace(projectId)),
      request<GitAuthProfile[]>(apiRoutes.gitAuthProfiles.list()),
      request<AuthProfile[]>(apiRoutes.projects.authProfiles(projectId)),
    ])

    setTasks(tasksResult.data)
    setProjectRuns(runsResult.data)
    setTaskRuns(taskRunsResult.data)
    setRecorderSessions(recorderSessionsResult.data)
    setModules(modulesResult.data)
    setTestCases(testCasesResult.data)
    setProjectWorkspace(workspaceResult.data)
    setGitAuthProfiles(gitAuthProfilesResult.data)
    setAuthProfiles(authProfilesResult.data)
    setWorkspaceTree([])
    setWorkspaceSearchResults([])
    setSelectedWorkspaceFile(null)
    setWorkspaceForm(workspaceResult.data ? {
      sourceKind: workspaceResult.data.sourceKind,
      gitRepoUrl: workspaceResult.data.gitRepoUrl,
      localSourcePath: workspaceResult.data.localSourcePath,
      branch: workspaceResult.data.branch,
      ref: workspaceResult.data.ref,
      gitAuthProfileId: workspaceResult.data.gitAuthProfileId ?? "",
    } : emptyWorkspaceForm())
    setSelectedTaskId((current) => {
      if (current && tasksResult.data.some((item) => item.id === current)) {
        return current
      }
      return tasksResult.data[0]?.id ?? null
    })
    setSelectedCaseId((current) => {
      if (current && testCasesResult.data.some((item) => item.id === current)) {
        return current
      }
      return testCasesResult.data[0]?.id ?? null
    })
  }, [])

  const loadTaskRunsForTask = useCallback(async (taskId: string) => {
    const result = await request<TaskRun[]>(apiRoutes.tasks.runs(taskId))
    return result.data
  }, [])

  const loadScripts = useCallback(async (testCaseId: string) => {
    const result = await request<ScriptArtifact[]>(apiRoutes.testCases.scripts(testCaseId))
    setScripts(result.data)
    setSelectedScriptId((current) => {
      if (current && result.data.some((item) => item.id === current)) {
        return current
      }
      return result.data[0]?.id ?? null
    })
  }, [])

  const loadRun = useCallback(async (runId: string) => {
    const result = await request<ExecutionRun>(apiRoutes.runs.detail(runId))
    setProjectRuns((current) => {
      const next = current.filter((item) => item.id !== result.data.id)
      return [result.data, ...next]
    })
    return result.data
  }, [])

  const loadAllTestCases = useCallback(async () => {
    const result = await request<TestCase[]>(apiRoutes.testCases.listAll())
    setAllCases(result.data)
    return result.data
  }, [])

  const callbackRef = useRef({
    loadTestCases,
    loadAllTestCases,
  })

  useEffect(() => {
    callbackRef.current = {
      loadTestCases,
      loadAllTestCases,
    }
  }, [loadTestCases, loadAllTestCases])

  useEffect(() => {
    Promise.all([loadProjects(), loadLlmSession(), loadAllTestCases()])
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setInitialized(true))
  }, [])

  useEffect(() => {
    // Only load resources if we have successfully loaded the projects list
    // AND the selected project ID is valid within that list.
    // This prevents firing off requests with stale/invalid hash IDs.
    if (!selectedProjectId || projects.length === 0 || !projects.some(p => p.id === selectedProjectId)) {
      return
    }

    loadProjectResources(selectedProjectId).catch((reason) => setError((reason as Error).message))
  }, [selectedProjectId, projects])

  useEffect(() => {
    if (!selectedCaseId) {
      setScripts([])
      setSelectedScriptId(null)
      return
    }

    loadScripts(selectedCaseId).catch((reason) => setError((reason as Error).message))
  }, [selectedCaseId, loadScripts])

  const selectedProject = useMemo(() => projects.find((item) => item.id === selectedProjectId) ?? projects[0], [projects, selectedProjectId])
  const selectedTask = useMemo(() => tasks.find((item) => item.id === selectedTaskId), [tasks, selectedTaskId])
  const selectedCase = useMemo(() => allCases.find((item) => item.id === selectedCaseId), [allCases, selectedCaseId])
  const activeTaskRun = useMemo(() => taskRuns.find((item) => item.id === activeTaskRunId) ?? null, [taskRuns, activeTaskRunId])
  const activeRecorderSession = useMemo(() => recorderSessions.find((item) => item.id === activeRecorderSessionId) ?? null, [recorderSessions, activeRecorderSessionId])

  const latestScript = useMemo(() => {
    if (!selectedCase?.latestScriptId) {
      return undefined
    }

    return scripts.find((item) => item.id === selectedCase.latestScriptId)
  }, [scripts, selectedCase])
  const selectedScript = useMemo(() => scripts.find((item) => item.id === selectedScriptId) ?? latestScript, [scripts, selectedScriptId, latestScript])

  const dependencyCaseCandidates = useMemo(() => {
    return allCases.filter((item) => {
      if (item.id === selectedCase?.id) return false
      return item.projectId === (selectedCase?.projectId ?? selectedProject?.id)
    })
  }, [allCases, selectedCase?.id, selectedCase?.projectId, selectedProject?.id])
  const selectedCaseDependencies = useMemo(
    () => allCases.filter((item) => selectedCase?.dependencyCaseIds.includes(item.id)),
    [allCases, selectedCase],
  )
  const passCount = useMemo(() => projectRuns.filter((item) => item.status === "passed").length, [projectRuns])
  const failCount = useMemo(() => projectRuns.filter((item) => item.status === "failed").length, [projectRuns])
  const activeCount = useMemo(() => projectRuns.filter((item) => item.status === "queued" || item.status === "running").length, [projectRuns])
  const executionRate = projectRuns.length ? Math.round((passCount / projectRuns.length) * 100) : 0
  const pendingDeviceAuth = llmSession?.pendingDeviceAuth
  const pendingExpiresInSeconds = pendingDeviceAuth ? Math.max(0, Math.ceil((new Date(pendingDeviceAuth.expiresAt).getTime() - clock) / 1000)) : 0

  useWorkspaceEffects({
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
  })

  const actions = useWorkspaceActions({
    llmSessionLoaded: Boolean(llmSession),
    selectedProjectId,
    selectedProject,
    selectedTaskId,
    selectedTask,
    selectedCase,
    copilotModel,
    prompt,
    projectForm,
    workspaceForm,
    taskForm,
    caseForm,
    lastTargetUrlId,
    setBusy,
    setError,
    setSuccessMessage,
    setSelectedProjectId,
    setSelectedTaskId,
    setSelectedCaseId,
    setSelectedScriptId,
    setActiveRun,
    setWorkbenchVerificationRunId,
    setActiveTaskRunId,
    setActiveRecorderSessionId,
    setActiveSection,
    setProjectForm,
    setWorkspaceForm,
    setTaskForm,
    setTasks,
    setTestCases,
    setProjectRuns,
    setTaskRuns,
    setRecorderSessions,
    setScripts,
    setAgentSession,
    setModules,
    setProjectWorkspace,
    setGitAuthProfiles,
    setAuthProfiles,
    setLlmConfigs,
    setActiveLlmConfigId,
    setActiveVisionConfigId,
    setWorkspaceTree,
    setWorkspaceSearchResults,
    setSelectedWorkspaceFile,
    llmConfigForm,
    setLlmConfigForm,
    loadProjects,
    loadLlmSession,
    loadProjectResources,
    loadScripts,
    loadTasks,
    loadTestCases,
    loadAllTestCases,
  })

  return {
    activeSection,
    initialized,
    projects,
    selectedProjectId,
    tasks,
    selectedTaskId,
    testCases,
    allCases,
    modules,
    projectRuns,
    taskRuns,
    activeTaskRunId,
    recorderSessions,
    activeRecorderSessionId,
    llmSession,
    llmConfigs,
    activeLlmConfigId,
    activeVisionConfigId,
    scripts,
    selectedCaseId,
    copilotModel,
    prompt,
    activeRun,
    workbenchVerificationRunId,
    activeTaskRun,
    activeRecorderSession,
    agentSession,
    error,
    successMessage,
    busy,
    copilotPolling,
    clock,
    projectWorkspace,
    gitAuthProfiles,
    authProfiles,
    workspaceTree,
    workspaceSearchResults,
    selectedWorkspaceFile,
    projectForm,
    workspaceForm,
    taskForm,
    caseForm,
    llmConfigForm,
    lastTargetUrlId,
    setLastTargetUrlId,
    selectedProject,
    selectedTask,
    selectedCase,
    latestScript,
    selectedScript,
    selectedScriptId,
    dependencyCaseCandidates,
    selectedCaseDependencies,
    passCount,
    failCount,
    activeCount,
    executionRate,
    pendingDeviceAuth,
    pendingExpiresInSeconds,
    setActiveSection,
    setSelectedProjectId,
    setSelectedTaskId,
    setSelectedCaseId,
    setSelectedScriptId,
    setCopilotModel,
    setPrompt,
    setActiveRun,
    setWorkbenchVerificationRunId,
    setActiveTaskRunId,
    setActiveRecorderSessionId,
    setProjectForm,
    setWorkspaceForm,
    setTaskForm,
    setCaseForm,
    setLlmConfigForm,
    setError,
    setSuccessMessage,
    loadTasks,
    loadTaskRunsForTask,
    loadAllTestCases,
    loadLlmSession,
    theme,
    setTheme,
    ...actions,
  }
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>
export type LoadedWorkspaceController = WorkspaceController & { llmSession: LlmSessionConfig }
export type ReadyWorkspaceController = LoadedWorkspaceController & { selectedProject: Project }
