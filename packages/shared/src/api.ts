import type { AgentSession } from "./agent"
import type { AuthLoginSandboxSession, AuthProfile, AuthProfileState, ValidationTask } from "./auth-profile"
import type { ScriptArtifact, TestCase, TestCaseType } from "./case"
import type { Identifier } from "./core"
import type { LlmProviderKind, LlmSessionConfig, LlmState } from "./llm"
import type { Module, Project, TargetUrl } from "./project"
import type { RecorderInteractionType, RecorderSession } from "./recorder"
import type { ExecutionRun, ExecutionRunKind, TaskRun } from "./run"
import type {
  PersistedTaskControlCommand,
  ScheduleTrigger,
  ScheduleTriggerKind,
  Task,
  TaskItem,
  TaskKind,
  TaskModeConfig,
} from "./task"
import type { GitAuthKind, GitAuthProfile, ProjectWorkspace, WorkspaceSourceKind } from "./workspace"

export interface GenerateScriptRequest {
  projectId: Identifier
  testCaseId: Identifier
  prompt: string
  /** 生成过程中用于试跑/校验的目标 URL（必须是项目下的 TargetUrl id）；省略则使用主域名。 */
  runTargetUrlId?: Identifier
  baseScriptId?: Identifier
}

export interface StartDirectAgentRequest {
  projectId: Identifier
  testCaseId: Identifier
  prompt: string
  /** 直接执行时使用的目标 URL（必须是项目下 TargetUrl 的 id）。 */
  runTargetUrlId?: Identifier
  taskRunId?: Identifier
}

export interface CreateScriptVersionRequest {
  code: string
  baseScriptId?: Identifier
  prompt?: string
}

export interface CreateScriptVersionResponse {
  script: ScriptArtifact
}

export interface GenerateScriptResponse {
  script?: ScriptArtifact
  sessionId: string
}

export interface CopilotSessionResponse {
  session: LlmSessionConfig
}

export interface LlmStateResponse {
  state: LlmState
}

export interface UpsertLlmConfigRequest {
  id?: Identifier
  name: string
  provider: Extract<LlmProviderKind, "copilot-proxy" | "openai-compatible" | "anthropic-compatible">
  model: string
  baseUrl: string
  apiKey?: string
}

export interface ActivateLlmConfigRequest {
  configId: Identifier
}

export interface ActivateVisionConfigRequest {
  configId: Identifier | null
}

export interface CopilotStartDeviceFlowRequest {
  model?: string
  configId?: Identifier
}

export interface CopilotPollDeviceFlowRequest {
  model?: string
  configId?: Identifier
}

export interface CopilotDisconnectRequest {
  clearPending?: boolean
}

export interface StartRunRequest {
  projectId: Identifier
  testCaseId: Identifier
  scriptId: Identifier
  /** 目标 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
  kind?: ExecutionRunKind
  taskRunId?: Identifier
  batchOrder?: number
}

export interface StartRunResponse {
  run: ExecutionRun
}

export interface StartVerificationRequest {
  projectId: Identifier
  testCaseId: Identifier
  scriptId: Identifier
  /** 目标 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

export interface StartVerificationResponse {
  run: ExecutionRun
}

export interface StartTaskRunRequest {
  projectId: Identifier
  taskId: Identifier
  /** 本次启动的执行模式覆盖（不写则沿用 task.executionMode）。 */
  taskMode?: TaskModeConfig
  /** 用于内部串联 polling 链 / Trigger 触发的元数据，外部接口可忽略。 */
  scheduleTriggerId?: Identifier
  attemptNo?: number
  parentTaskRunId?: Identifier
}

export interface StartTaskRunResponse {
  taskRun: TaskRun
}

export interface StartRecorderSessionRequest {
  projectId: Identifier
  testCaseId: Identifier
  /** 目标 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

export interface RecorderInteractionRequest {
  type: RecorderInteractionType
  url?: string
  x?: number
  y?: number
  value?: string
  key?: string
  deltaY?: number
  selector?: string
  role?: string
  label?: string
  text?: string
  placeholder?: string
}

export interface StopRecorderSessionRequest {
  saveAsScript?: boolean
  runAfterSave?: boolean
}

export interface StopRecorderSessionResponse {
  session: RecorderSession
  script?: ScriptArtifact
  run?: ExecutionRun
}

export interface StartAuthLoginSandboxRequest {
  projectId: Identifier
  authProfileId: Identifier
  /** 目标 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

export interface SaveAuthLoginSandboxResponse {
  session: AuthLoginSandboxSession
  state: AuthProfileState
}

export interface UpsertProjectRequest {
  id?: Identifier
  name: string
  description: string
  testBaseUrl: string
  version: string
}

export interface UpsertTargetUrlRequest {
  id?: Identifier
  projectId: Identifier
  label: string
  url: string
}

export interface UpsertProjectWorkspaceRequest {
  sourceKind: WorkspaceSourceKind
  gitRepoUrl?: string
  localSourcePath?: string
  branch?: string
  ref?: string
  gitAuthProfileId?: Identifier
}

export interface ImportLocalWorkspaceRequest {
  localPath: string
}

export interface UploadWorkspaceResponse {
  managedRoot: string
  totalFiles: number
}

export interface SyncProjectWorkspaceRequest {
  branch?: string
  ref?: string
}

export interface WorkspaceTreeRequest {
  path?: string
}

export interface WorkspaceGlobRequest {
  pattern: string
}

export interface WorkspaceSearchRequest {
  query: string
  path?: string
  limit?: number
}

export interface WorkspaceReadFileRequest {
  path: string
  offset?: number
  limit?: number
}

export interface UpsertGitAuthProfileRequest {
  id?: Identifier
  name: string
  kind: GitAuthKind
  hostPattern: string
  username?: string
  secret?: string
}

export interface UpsertModuleRequest {
  id?: Identifier
  projectId: Identifier
  name: string
  description: string
}

export interface UpsertTestCaseRequest {
  id?: Identifier
  projectId: Identifier
  caseCode: string
  moduleName?: string
  moduleId?: Identifier
  purpose?: string
  dependencyCaseIds: Identifier[]
  authProfileId?: Identifier
  defaultTargetUrlId?: Identifier
  steps: string[]
  expectedResult: string
  testType: TestCaseType
  bugId?: string
  note?: string
  aiScript?: string
}

export interface UpsertTaskRequest {
  id?: Identifier
  projectId: Identifier
  name: string
  description?: string
  items: TaskItem[]
  executionMode?: TaskModeConfig
}

export interface UpsertScheduleTriggerRequest {
  id?: Identifier
  projectId: Identifier
  taskId: Identifier
  name?: string
  kind: ScheduleTriggerKind
  atTime?: string
  cronExpr?: string
  enabled?: boolean
}

export interface UpsertAuthProfileRequest {
  id?: Identifier
  projectId: Identifier
  name: string
  description?: string
  sourceCaseId: Identifier
  validationScriptId?: Identifier
}

export interface GenerateValidationScriptRequest {
  projectId: Identifier
  profileId: Identifier
  /** 用于生成校验脚本时打开的 URL（鉴权域）。省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

export interface CheckLoginStatusRequest {
  projectId: Identifier
  profileId: Identifier
  /** 用 targetUrl 下的 storageState 进行重放校验。 */
  targetUrlId: Identifier
}

export interface RefreshAuthProfileStateRequest {
  /** 通过对应登录用例跑一次，将 storageState 写入 (profile, targetUrl) 的状态行。 */
  targetUrlId: Identifier
}

export interface RefreshAuthProfileStateResponse {
  runId: Identifier
  targetUrlId: Identifier
}

export interface UpdateAuthProfilePostLoginUrlRequest {
  /** 传 null 或 undefined 表示清除手动覆盖，回退到自动采集值。 */
  postLoginUrl: string | null
}

/**
 * 外部采集的登录态导入请求：把用户在「自己真浏览器」里采集到的 storageState
 * （cookies + localStorage，Playwright 兼容格式）直接写入 (profile, targetUrl) 行。
 * 用于强风控站点（如淘宝详情页）——这些站点对机房 IP / 沙盒环境会触发 punish，
 * 但对用户本机的住宅 IP + 真实指纹放行，因此在本机采集是最可靠的路径。
 */
export interface ImportAuthProfileStateRequest {
  projectId: Identifier
  /** 目标 URL 行；省略则落到项目主域名对应的行。 */
  targetUrlId?: Identifier
  /** Playwright storageState JSON 字符串（{ cookies, origins }）。 */
  storageStateJson: string
  /** 采集时浏览器停留的 URL，会写入 post_login_url_auto，便于后续回放落点。 */
  postLoginUrl?: string
}

export interface GenerateValidationScriptResponse {
  taskId: Identifier
}

export interface CheckLoginStatusResponse {
  valid: boolean
  error?: string
  taskId?: Identifier
}

export interface DashboardData {
  projects: Project[]
  modules: Module[]
  tasks: Task[]
  authProfiles: AuthProfile[]
  testCases: TestCase[]
  scripts: ScriptArtifact[]
  runs: ExecutionRun[]
  taskRuns: TaskRun[]
  recorderSessions: RecorderSession[]
  /** 项目 → URL 列表（每个项目对应若干 TargetUrl）。 */
  targetUrlsByProject?: Record<Identifier, TargetUrl[]>
  /** 项目 → ScheduleTrigger 列表。 */
  scheduleTriggersByProject?: Record<Identifier, ScheduleTrigger[]>
  llmSession: LlmSessionConfig
  llmConfigs?: LlmSessionConfig[]
  activeLlmConfigId?: Identifier
}

export interface ActiveTaskSummary {
  kind: TaskKind
  id: Identifier
  projectId: Identifier
  testCaseId?: Identifier
  taskId?: Identifier
  status: string
  startedAt: string
  pausedAt?: string
  label?: string
}

export interface ActiveTasksResponse {
  agents: AgentSession[]
  runs: ExecutionRun[]
  taskRuns: TaskRun[]
  recorderSessions: RecorderSession[]
  summaries: ActiveTaskSummary[]
}

export interface TaskControlResponse {
  kind: TaskKind
  id: Identifier
  status: string
}

export interface ConflictTaskResponse {
  conflict: true
  kind: TaskKind
  id: Identifier
  status: string
}

export interface ApiEnvelope<T> {
  data: T
}

export type { PersistedTaskControlCommand, ProjectWorkspace, GitAuthProfile, ValidationTask }