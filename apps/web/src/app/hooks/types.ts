import type { Dispatch, SetStateAction } from "react"
import type {
  AgentSession,
  ExecutionRun,
  GitAuthProfile,
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
import type { WorkspaceSection } from "../constants"
import type { ParsedHash } from "../hashRouter"
import type { ProjectRefreshLoaders } from "./streams/useProjectSync"

export type Setter<T> = Dispatch<SetStateAction<T>>

export type { WorkspaceSection, ParsedHash }

export interface WorkspaceEffectsParams {
  selectedProject?: Project
  lastTargetUrlId: string
  setLastTargetUrlId: Setter<string>
  selectedTask?: Task
  taskForm: Omit<UpsertTaskRequest, "projectId">
  setTaskForm: Setter<Omit<UpsertTaskRequest, "projectId">>
  selectedCase?: TestCase
  caseForm: Omit<UpsertTestCaseRequest, "projectId">
  setCaseForm: Setter<Omit<UpsertTestCaseRequest, "projectId">>
  activeRun: ExecutionRun | null
  setActiveRun: Setter<ExecutionRun | null>
  setWorkbenchVerificationRunId: Setter<string | null>
  projectRuns: ExecutionRun[]
  agentSession: AgentSession | null
  loadRun: (runId: string) => Promise<ExecutionRun | null>
  selectedProjectId: string | null
  loadProjectResources: (projectId: string) => Promise<void>
  refreshLoaders: ProjectRefreshLoaders
  activeTaskRun: TaskRun | null
  activeTaskAgentSession: AgentSession | null
  setActiveTaskAgentSession: Setter<AgentSession | null>
  setTaskRuns: Setter<TaskRun[]>
  taskRuns: TaskRun[]
  activeRecorderSession: RecorderSession | null
  setRecorderSessions: Setter<RecorderSession[]>
  recorderSessions: RecorderSession[]
  selectedCaseId: string | null
  loadScripts: (testCaseId: string) => Promise<void>
  setAgentSession: Setter<AgentSession | null>
  setBusy: Setter<boolean>
  llmSession: LlmSessionConfig | null
  setClock: Setter<number>
  copilotPolling: boolean
  clock: number
  setCopilotPolling: Setter<boolean>
  copilotModel: string
  loadLlmSession: () => Promise<unknown>
  setError: Setter<string | null>
  initialized: boolean
  activeSection: WorkspaceSection
  selectedTaskId: string | null
  parseHash: () => ParsedHash
  setActiveSection: Setter<WorkspaceSection>
  setSelectedProjectId: Setter<string | null>
  setSelectedTaskId: Setter<string | null>
  setSelectedCaseId: Setter<string | null>
  setActiveTaskRunId: Setter<string | null>
  setActiveRecorderSessionId: Setter<string | null>
}

export type WorkspaceActionParams = {
  llmSessionLoaded: boolean
  selectedProjectId: string | null
  selectedProject?: Project
  selectedTaskId: string | null
  selectedTask?: Task
  selectedCase?: TestCase
  copilotModel: string
  prompt: string
  projectForm: UpsertProjectRequest
  workspaceForm: UpsertProjectWorkspaceRequest
  taskForm: Omit<UpsertTaskRequest, "projectId">
  caseForm: Omit<UpsertTestCaseRequest, "projectId">
  lastTargetUrlId: string
  setBusy: Setter<boolean>
  setError: Setter<string | null>
  setSuccessMessage: Setter<string | null>
  setSelectedProjectId: Setter<string | null>
  setSelectedTaskId: Setter<string | null>
  setSelectedCaseId: Setter<string | null>
  setSelectedScriptId: Setter<string | null>
  setActiveRun: Setter<ExecutionRun | null>
  setWorkbenchVerificationRunId: Setter<string | null>
  setActiveTaskRunId: Setter<string | null>
  setActiveRecorderSessionId: Setter<string | null>
  setActiveSection: Setter<WorkspaceSection>
  setProjectForm: Setter<UpsertProjectRequest>
  setWorkspaceForm: Setter<UpsertProjectWorkspaceRequest>
  setTaskForm: Setter<Omit<UpsertTaskRequest, "projectId">>
  setTasks: Setter<Task[]>
  setTestCases: Setter<TestCase[]>
  setProjectRuns: Setter<ExecutionRun[]>
  setTaskRuns: Setter<TaskRun[]>
  setRecorderSessions: Setter<RecorderSession[]>
  setScripts: Setter<ScriptArtifact[]>
  setAgentSession: Setter<AgentSession | null>
  setModules: Setter<Module[]>
  setProjectWorkspace: Setter<ProjectWorkspace | null>
  setGitAuthProfiles: Setter<GitAuthProfile[]>
  setAuthProfiles: Setter<AuthProfile[]>
  setLlmConfigs: Setter<LlmSessionConfig[]>
  setActiveLlmConfigId: Setter<string | null>
  setActiveVisionConfigId: Setter<string | null>
  setWorkspaceTree: Setter<WorkspaceTreeEntry[]>
  setWorkspaceSearchResults: Setter<WorkspaceSearchMatch[]>
  setSelectedWorkspaceFile: Setter<WorkspaceFileContent | null>
  llmConfigForm: UpsertLlmConfigRequest
  setLlmConfigForm: Setter<UpsertLlmConfigRequest>
  loadProjects: () => Promise<Project[]>
  loadLlmSession: () => Promise<unknown>
  loadProjectResources: (projectId: string) => Promise<void>
  loadScripts: (testCaseId: string) => Promise<void>
  loadTasks: (projectId: string) => Promise<Task[]>
  loadTestCases: (projectId: string) => Promise<TestCase[]>
  loadAllTestCases: () => Promise<TestCase[]>
}
