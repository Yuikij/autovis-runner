import { useCallback, useEffect, useMemo, useState } from "react"

import type {
  AuthProfile,
  ExecutionRun,
  GitAuthProfile,
  Module,
  Project,
  ProjectWorkspace,
  RecorderSession,
  ScriptArtifact,
  Task,
  TaskRun,
  TestCase,
  UpsertProjectWorkspaceRequest,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"
import { request } from "./api"
import { apiRoutes } from "./apiRoutes"
import { parseHash } from "./hashRouter"
import { emptyWorkspaceForm } from "./workspaceForms"

/**
 * The server-resource domain: the local mirror of project data plus the only
 * functions allowed to fetch it. Extracted out of the workspace controller so
 * all data-loading lives in one cohesive, independently testable place. The
 * controller composes this hook and re-exposes its values unchanged, so the
 * public workspace API and runtime behavior are preserved.
 */
export function useWorkspaceData(onError: (message: string) => void) {
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
  const [recorderSessions, setRecorderSessions] = useState<RecorderSession[]>([])
  const [scripts, setScripts] = useState<ScriptArtifact[]>([])
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => parseHash().caseId)
  const [workspaceForm, setWorkspaceForm] = useState<UpsertProjectWorkspaceRequest>(emptyWorkspaceForm)

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
      return null
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
      return null
    })
  }, [])

  const loadTaskRunsForTask = useCallback(async (taskId: string) => {
    const result = await request<TaskRun[]>(apiRoutes.tasks.runs(taskId))
    return result.data
  }, [])

  // Granular project loaders used by the refresh coordinator for scope-targeted
  // refreshes (so a finished run no longer triggers a 9-endpoint full refetch).
  const loadProjectRuns = useCallback(async (projectId: string) => {
    const result = await request<ExecutionRun[]>(apiRoutes.projects.runs(projectId))
    setProjectRuns(result.data)
    return result.data
  }, [])

  const loadProjectTaskRuns = useCallback(async (projectId: string) => {
    const result = await request<TaskRun[]>(apiRoutes.projects.taskRuns(projectId))
    setTaskRuns(result.data)
    return result.data
  }, [])

  const loadProjectRecorderSessions = useCallback(async (projectId: string) => {
    const result = await request<RecorderSession[]>(apiRoutes.projects.recorderSessions(projectId))
    setRecorderSessions(result.data)
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

  useEffect(() => {
    // Only load resources if we have successfully loaded the projects list
    // AND the selected project ID is valid within that list.
    // This prevents firing off requests with stale/invalid hash IDs.
    if (!selectedProjectId || projects.length === 0 || !projects.some((p) => p.id === selectedProjectId)) {
      return
    }

    loadProjectResources(selectedProjectId).catch((reason) => onError((reason as Error).message))
  }, [selectedProjectId, projects, loadProjectResources, onError])

  useEffect(() => {
    if (!selectedCaseId) {
      setScripts([])
      setSelectedScriptId(null)
      return
    }

    loadScripts(selectedCaseId).catch((reason) => onError((reason as Error).message))
  }, [selectedCaseId, loadScripts, onError])

  const selectedProject = useMemo(() => projects.find((item) => item.id === selectedProjectId) ?? projects[0], [projects, selectedProjectId])
  const selectedTask = useMemo(() => tasks.find((item) => item.id === selectedTaskId), [tasks, selectedTaskId])
  const selectedCase = useMemo(() => allCases.find((item) => item.id === selectedCaseId), [allCases, selectedCaseId])

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

  const refreshLoaders = useMemo(() => ({
    loadProjectResources,
    loadTasks,
    loadProjectRuns,
    loadTaskRuns: loadProjectTaskRuns,
    loadRecorderSessions: loadProjectRecorderSessions,
    loadTestCases,
    loadAllTestCases,
  }), [loadProjectResources, loadTasks, loadProjectRuns, loadProjectTaskRuns, loadProjectRecorderSessions, loadTestCases, loadAllTestCases])

  return {
    // resource state
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
    // loaders
    loadProjects,
    loadTasks,
    loadTestCases,
    loadProjectResources,
    loadTaskRunsForTask,
    loadProjectRuns,
    loadProjectTaskRuns,
    loadProjectRecorderSessions,
    loadScripts,
    loadRun,
    loadAllTestCases,
    refreshLoaders,
    // derived selectors
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
  }
}
