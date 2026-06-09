import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  AgentSession,
  ExecutionRun,
  LlmState,
  LlmSessionConfig,
  Project,
  UpsertLlmConfigRequest,
  UpsertProjectRequest,
  UpsertTaskRequest,
  UpsertTestCaseRequest,
} from "@autovis/shared"
import { request } from "./api"
import { apiRoutes } from "./apiRoutes"
import { defaultCopilotModel, defaultScriptPrompt, type WorkspaceSection } from "./constants"
import { parseHash } from "./hashRouter"
import { useWorkspaceData } from "./useWorkspaceData"
import { useWorkspaceEffects } from "./hooks/useWorkspaceEffects"
import { useWorkspaceActions } from "./useWorkspaceActions"
import { emptyCaseForm, emptyProjectForm, emptyTaskForm } from "./workspaceForms"

export function useWorkspaceController() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(() => parseHash().section)
  const [initialized, setInitialized] = useState(false)
  const [activeTaskRunId, setActiveTaskRunId] = useState<string | null>(null)
  const [activeRecorderSessionId, setActiveRecorderSessionId] = useState<string | null>(null)
  const [llmSession, setLlmSession] = useState<LlmSessionConfig | null>(null)
  const [llmConfigs, setLlmConfigs] = useState<LlmSessionConfig[]>([])
  const [activeLlmConfigId, setActiveLlmConfigId] = useState<string | null>(null)
  const [activeVisionConfigId, setActiveVisionConfigId] = useState<string | null>(null)
  const [copilotModel, setCopilotModel] = useState(defaultCopilotModel)
  const [prompt, setPrompt] = useState(defaultScriptPrompt)
  const [activeRun, setActiveRun] = useState<ExecutionRun | null>(null)
  const [workbenchVerificationRunId, setWorkbenchVerificationRunId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [activeTaskAgentSession, setActiveTaskAgentSession] = useState<AgentSession | null>(null)
  const [copilotPolling, setCopilotPolling] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [lastTargetUrlId, setLastTargetUrlId] = useState(() => {
    if (typeof window === "undefined") return ""
    return localStorage.getItem("autovis_last_target_url_id") || ""
  })
  const [projectForm, setProjectForm] = useState<UpsertProjectRequest>(emptyProjectForm)
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

  // Server-resource domain (state + loaders + load effects + derived selectors).
  const data = useWorkspaceData(setError)
  const {
    projects, setProjects,
    selectedProjectId, setSelectedProjectId,
    tasks, setTasks,
    selectedTaskId, setSelectedTaskId,
    testCases, setTestCases,
    allCases, setAllCases,
    modules, setModules,
    projectWorkspace, setProjectWorkspace,
    gitAuthProfiles, setGitAuthProfiles,
    authProfiles, setAuthProfiles,
    workspaceTree, setWorkspaceTree,
    workspaceSearchResults, setWorkspaceSearchResults,
    selectedWorkspaceFile, setSelectedWorkspaceFile,
    projectRuns, setProjectRuns,
    taskRuns, setTaskRuns,
    recorderSessions, setRecorderSessions,
    scripts, setScripts,
    selectedScriptId, setSelectedScriptId,
    selectedCaseId, setSelectedCaseId,
    workspaceForm, setWorkspaceForm,
    loadProjects,
    loadTasks,
    loadTestCases,
    loadProjectResources,
    loadTaskRunsForTask,
    loadScripts,
    loadRun,
    loadAllTestCases,
    refreshLoaders,
    selectedProject,
    selectedTask,
    selectedCase,
    latestScript,
    selectedScript,
    dependencyCaseCandidates,
    selectedCaseDependencies,
    passCount,
    failCount,
    activeCount,
    executionRate,
  } = data

  const loadLlmSession = useCallback(async () => {
    const result = await request<LlmState>(apiRoutes.llm.state())
    setLlmSession(result.data.session)
    setLlmConfigs(result.data.configs)
    setActiveLlmConfigId(result.data.activeConfigId ?? result.data.session.id)
    setActiveVisionConfigId(result.data.activeVisionConfigId ?? null)
    setCopilotModel(result.data.session.model)
    return result.data
  }, [])

  useEffect(() => {
    Promise.all([loadProjects(), loadLlmSession(), loadAllTestCases()])
      .catch((reason) => setError((reason as Error).message))
      .finally(() => setInitialized(true))
  }, [])

  const activeTaskRun = useMemo(() => taskRuns.find((item) => item.id === activeTaskRunId) ?? null, [taskRuns, activeTaskRunId])
  const activeRecorderSession = useMemo(() => recorderSessions.find((item) => item.id === activeRecorderSessionId) ?? null, [recorderSessions, activeRecorderSessionId])

  const pendingDeviceAuth = llmSession?.pendingDeviceAuth
  const pendingExpiresInSeconds = pendingDeviceAuth ? Math.max(0, Math.ceil((new Date(pendingDeviceAuth.expiresAt).getTime() - clock) / 1000)) : 0

  useWorkspaceEffects({
    selectedProject, lastTargetUrlId, setLastTargetUrlId, selectedTask,
    taskForm, setTaskForm, selectedCase, caseForm, setCaseForm,
    activeRun, setActiveRun, setWorkbenchVerificationRunId, projectRuns,
    agentSession, loadRun, selectedProjectId, loadProjectResources, refreshLoaders,
    activeTaskRun, activeTaskAgentSession, setActiveTaskAgentSession, setTaskRuns, taskRuns,
    activeRecorderSession, setRecorderSessions,
    recorderSessions, selectedCaseId, loadScripts,
    setAgentSession, setBusy, llmSession,
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
    activeTaskAgentSession,
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
    setActiveTaskAgentSession,
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
