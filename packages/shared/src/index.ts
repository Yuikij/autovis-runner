export type Identifier = string

export type LlmProviderKind =
  | "copilot-proxy"
  | "openai-compatible"
  | "anthropic-compatible"
  | "manual-recorder"
  | "manual-editor"
export type LlmConnectionStatus = "disconnected" | "authorizing" | "connected" | "error"

export type TestCaseType = "functional" | "regression" | "smoke"

export type HumanHandoffReason = "captcha" | "otp" | "manual_confirmation" | "custom"
export type RunPhase = "preconditions" | "target" | "archive"
export type ExecutionStepKind = "orchestration" | "precondition_case" | "target" | "archive" | "business_step"

export interface HumanHandoffRequest {
  id: Identifier
  kind: "text_input"
  reason: HumanHandoffReason
  instruction: string
  inputLabel?: string
  placeholder?: string
  confirmText?: string
  imageUrl?: string
  scope?: "precondition" | "target"
  suiteId?: Identifier
  testCaseId?: Identifier
  createdAt: string
}

export type RunStatus =
  | "idle"
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "awaiting_human"
  | "passed"
  | "failed"
export type ExecutionStepStatus = "queued" | "running" | "passed" | "failed"
export type ExecutionRunKind = "execution" | "verification" | "temporary"
export type LiveViewportStatus = "connecting" | "live" | "ended" | "unavailable"
export type TaskRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "passed"
  | "failed"
export type VerificationStatus = "idle" | "queued" | "running" | "passed" | "failed"
export type WorkspaceSourceKind = "git" | "local_path" | "upload"
export type WorkspaceStatus = "missing" | "importing" | "ready" | "syncing" | "error"
export type GitAuthKind = "none" | "http_token" | "http_basic" | "ssh_key"
export type AgentSessionMode = "generate" | "direct"
export type AgentSessionStatus =
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "completed"
  | "error"
export type AgentStage = "code" | "page" | "generation" | "verification"
export type RecorderSessionStatus =
  | "starting"
  | "running"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "stopping"
  | "completed"
  | "error"
export type RecorderActionType = "navigate" | "click" | "dblclick" | "input" | "keydown" | "scroll"
export type RecorderInteractionType = RecorderActionType
export type TaskKind = "agent" | "run" | "task-run" | "recorder"
export type TaskControlAction = "pause" | "resume" | "cancel"

export interface ProjectSummary {
  totalCases: number
  totalScripts: number
  lastRunStatus: RunStatus
}

export interface Project {
  id: Identifier
  name: string
  description: string
  /** 项目的主域名 / 默认 URL，等价于 targetUrls 中的"主域名"行；保留主要为后端 Playwright 兜底用。 */
  testBaseUrl: string
  version: string
  createdAt: string
  updatedAt: string
  summary: ProjectSummary
  /** 项目下集中管理的 URL 列表，所有运行 / 校验 / 登录态均通过 targetUrlId 引用。 */
  targetUrls: TargetUrl[]
}

/**
 * 项目下统一管理的访问 URL。"主域名"由 project.testBaseUrl 自动维护，其余由用户增删。
 */
export interface TargetUrl {
  id: Identifier
  projectId: Identifier
  label: string
  url: string
  /** 主域名（与 project.testBaseUrl 同步）只能改不能删。 */
  isPrimary?: boolean
  createdAt: string
  updatedAt: string
}

export interface UpsertTargetUrlRequest {
  id?: Identifier
  projectId: Identifier
  label: string
  url: string
}

export interface ProjectWorkspace {
  projectId: Identifier
  sourceKind: WorkspaceSourceKind
  managedRoot: string
  gitRepoUrl: string
  localSourcePath: string
  branch: string
  ref: string
  lastCommitSha?: string
  gitAuthProfileId?: Identifier
  status: WorkspaceStatus
  lastSyncedAt?: string
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceTreeEntry {
  path: string
  name: string
  kind: "file" | "directory"
  size?: number
  extension?: string
}

export interface WorkspaceSearchMatch {
  path: string
  lineNumber: number
  line: string
  preview: string
}

export interface WorkspaceFileContent {
  path: string
  content: string
  truncated: boolean
  offset: number
  totalLines: number
}

export interface GitAuthProfile {
  id: Identifier
  name: string
  kind: GitAuthKind
  hostPattern: string
  username?: string
  secret?: string
  createdAt: string
  updatedAt: string
}

export interface Module {
  id: Identifier
  projectId: Identifier
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

export interface CodeFile {
  id: Identifier
  projectId: Identifier
  filename: string
  content: string
  createdAt: string
}

export type TaskRunVerificationStatus = "passed" | "failed"

/**
 * 任务（Task）是可持久化、可编辑的编排实体，取代了原先"测试集 + 调度触发器"的双重概念。
 * - `items`：有序的用例列表，每项可指定自己的初始 URL（缺省回落项目主域名）。
 * - `executionMode`：oneshot / polling / deadline，控制一次触发如何展开为真实执行。
 * - 触发器（ScheduleTrigger）通过 taskId 绑定到任务上，只负责"什么时候触发"。
 */
export interface Task {
  id: Identifier
  projectId: Identifier
  name: string
  description?: string
  items: TaskItem[]
  executionMode?: TaskModeConfig
  lastRunId?: Identifier
  lastStatus?: TaskRunStatus
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

/** 任务编排中的一项：一条用例 + 该用例本次执行使用的初始 URL（缺省回落项目主域名）。 */
export interface TaskItem {
  caseId: Identifier
  /** 该用例的初始 URL（必须为项目下 TargetUrl 的 id）；省略则使用项目主域名。 */
  targetUrlId?: Identifier
}

/**
 * 任务执行模式。控制一次"触发"如何展开为一组真实的脚本执行：
 * - `oneshot`：默认；只跑一次，遇错即终止。
 * - `polling`：到点起一次后，按 intervalMs 循环重跑，直到达到 stopOn 条件或达到 maxAttempts。适用于秒杀、抢票"反复刷新直到成功"。
 * - `deadline`：在 `at` 时刻前提前 `prewarmMs` 启动浏览器与登录态，由脚本内部 `await schedule.waitUntil(at)` 卡到精确时间点；
 *   单次 attempt 的脚本超时会自动放大到 `at - now + extraTimeoutMs` 以承载等待。
 */
export type TaskModeConfig =
  | { kind: "oneshot" }
  | {
      kind: "polling"
      /** 两次 attempt 之间的间隔毫秒数。 */
      intervalMs: number
      /** 最多重试次数（含首次）。 */
      maxAttempts: number
      /** 何时停止：success = 出现一次成功就停；exhausted = 跑满 maxAttempts。 */
      stopOn?: "success" | "exhausted"
      /** 单次 attempt 的脚本超时；默认沿用 runner 默认 5 分钟。 */
      attemptTimeoutMs?: number
    }
  | {
      kind: "deadline"
      /** 精确触发时刻（ISO 字符串）。 */
      at: string
      /** 提前多少毫秒启动浏览器预热；建议 60s ~ 5min。 */
      prewarmMs?: number
      /** 在 at 之后再额外加多少毫秒超时上限，避免下单 / 后续步骤被卡断。 */
      extraTimeoutMs?: number
    }

export type ScheduleTriggerKind = "at" | "cron"

export interface ScheduleTrigger {
  id: Identifier
  projectId: Identifier
  /** 触发的任务；任务自带执行模式、有序用例与每项初始 URL，触发器只负责"什么时候触发"。 */
  taskId: Identifier
  name: string
  kind: ScheduleTriggerKind
  /** kind=at 时为目标 ISO 时刻；cron 时忽略。 */
  atTime?: string
  /** kind=cron 时为标准 5 字段表达式（分 时 日 月 周）；at 时忽略。 */
  cronExpr?: string
  enabled: boolean
  lastFiredAt?: string
  nextFireAt?: string
  createdAt: string
  updatedAt: string
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

/**
 * 解析 storageState JSON 后得到的概要信息（仅用于 UI 展示，不用于回放）。
 * 后端在 `getAuthProfile` 接口返回时基于 storageStateJson 动态计算。
 */
export interface StorageStateCookieInfo {
  name: string
  domain: string
  path?: string
  expires?: number
  sameSite?: string
  secure?: boolean
  httpOnly?: boolean
}

export interface StorageStateOriginInfo {
  origin: string
  localStorageKeys: string[]
}

export interface StorageStateSummary {
  cookieCount: number
  originCount: number
  cookies: StorageStateCookieInfo[]
  origins: StorageStateOriginInfo[]
}

export interface AuthProfile {
  id: Identifier
  projectId: Identifier
  name: string
  description?: string
  /** 登录用例：刷新登录态时单独执行这一条用例（可自带前置用例），抓取其结束时的 storageState。 */
  sourceCaseId: Identifier
  validationScriptId?: Identifier
  /** 失效校验脚本（与 URL 无关，复用于所有 targetUrl）。 */
  validationScript?: string
  validationScriptGeneratedAt?: string
  /** 一个登录态 × 多个目标 URL：每个 URL 一份独立的 storageState。 */
  states: AuthProfileState[]
  createdAt: string
  updatedAt: string
}

export interface AuthProfileState {
  authProfileId: Identifier
  targetUrlId: Identifier
  storageStateJson?: string
  storageStateSummary?: StorageStateSummary
  lastRefreshedAt?: string
  updatedAt: string
  /** 上一次刷新 sourceSuite 结束时浏览器停留的 URL（自动采集，下一次刷新会被覆盖）。 */
  postLoginUrlAuto?: string
  /** 用户手动覆盖的"登录后 URL"（优先级高于 postLoginUrlAuto，不会被刷新冲掉）。 */
  postLoginUrlOverride?: string
  /** 后端 decorator 计算出的最终生效值：postLoginUrlOverride ?? postLoginUrlAuto。 */
  postLoginUrl?: string
}

export interface TestCase {
  id: Identifier
  projectId: Identifier
  caseCode: string
  moduleName?: string
  moduleId?: Identifier
  purpose: string
  /** 有序的前置用例：执行本用例前会自动按顺序先跑这些用例（用于登录 / 造数据等可复用前置）。 */
  dependencyCaseIds: Identifier[]
  authProfileId?: Identifier
  steps: string[]
  expectedResult: string
  testType: TestCaseType
  bugId?: string
  note?: string
  aiScript?: string
  latestScriptId?: Identifier
  lastVerifiedRunId?: Identifier
  lastVerifiedStatus?: VerificationStatus
  lastVerifiedAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface ScriptArtifact {
  id: Identifier
  testCaseId: Identifier
  version: number
  source: "generated" | "manual"
  provider: LlmProviderKind
  prompt: string
  code: string
  createdAt: string
}

export interface ExecutionStep {
  id: Identifier
  title: string
  kind?: ExecutionStepKind
  status: ExecutionStepStatus
  startedAt: string
  finishedAt?: string
  screenshotUrl?: string
  log: string
}

export interface RunArtifact {
  kind: "trace" | "video" | "screenshot"
  name: string
  url: string
}

export interface LiveViewportState {
  mode: "ws-jpeg-stream"
  url: string
  status: LiveViewportStatus
  mimeType: "image/jpeg"
  width?: number
  height?: number
}

export interface ExecutionRun {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  scriptId: Identifier
  kind: ExecutionRunKind
  taskRunId?: Identifier
  batchOrder?: number
  status: RunStatus
  startedAt: string
  finishedAt?: string
  currentViewport: string
  liveViewport?: LiveViewportState
  pendingHumanHandoff?: HumanHandoffRequest
  logs: string[]
  steps: ExecutionStep[]
  artifacts: RunArtifact[]
  targetUrlId?: Identifier
  testBaseUrl: string
  orchestrationPhase?: RunPhase
  currentPreconditionCaseId?: Identifier
  completedPreconditionCaseIds?: Identifier[]
  preconditionSummary?: string[]
  runtimeOutputs?: RuntimeOutput[]
}

export interface RuntimeOutput {
  id: Identifier
  runId: Identifier
  testCaseId?: Identifier
  caseCode?: string
  caseName?: string
  description: string
  value: unknown
  meta?: Record<string, unknown>
  createdAt: string
}

/** 任务的一次执行记录（取代原 TestSuiteRun）。每个任务可查看自己的执行历史。 */
export interface TaskRun {
  id: Identifier
  projectId: Identifier
  taskId: Identifier
  status: TaskRunStatus
  /** 任务级默认 URL（展示用）；每个子 run 实际使用各自 TaskItem 的 targetUrlId。 */
  targetUrlId?: Identifier
  testBaseUrl: string
  totalCount: number
  queuedCount: number
  runningCount: number
  passedCount: number
  failedCount: number
  skippedCount: number
  runIds: Identifier[]
  currentRunId?: Identifier
  /** 当前正在执行的 AI 直接执行 Agent session id（用例无脚本时使用）。 */
  currentAgentId?: Identifier
  logs: string[]
  startedAt: string
  finishedAt?: string
  /** 触发该 taskRun 的 ScheduleTrigger id（手动启动则为空）。 */
  scheduleTriggerId?: Identifier
  /** polling 链中本次 attempt 的序号（1 起；oneshot/deadline 为 undefined）。 */
  attemptNo?: number
  /** polling 链中指向上一轮 attempt 的 taskRun id；首轮为空。 */
  parentTaskRunId?: Identifier
  /** 实际生效的执行模式（如 polling/deadline 的具体参数），便于前端展示与排错。 */
  effectiveTaskMode?: TaskModeConfig
}

export interface RecorderAction {
  id: Identifier
  type: RecorderActionType
  timestamp: string
  url: string
  title?: string
  selector?: string
  role?: string
  label?: string
  text?: string
  placeholder?: string
  value?: string
  key?: string
  deltaY?: number
  x?: number
  y?: number
  screenshotUrl?: string
  detail?: string
}

export interface RecorderSession {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  status: RecorderSessionStatus
  targetUrlId?: Identifier
  testBaseUrl: string
  currentViewport: string
  currentUrl?: string
  pageTitle?: string
  actions: RecorderAction[]
  artifacts: RunArtifact[]
  generatedScriptId?: Identifier
  startedAt: string
  finishedAt?: string
  error?: string
}

export interface LlmSessionConfig {
  id: Identifier
  name: string
  provider: LlmProviderKind
  proxyEndpoint: string
  model: string
  signedIn: boolean
  connectionStatus: LlmConnectionStatus
  baseUrl: string
  loginMode: "device-flow" | "manual-token"
  apiKeyConfigured?: boolean
  lastSyncedAt?: string
  lastError?: string
  pendingDeviceAuth?: {
    userCode: string
    verificationUri: string
    expiresAt: string
    intervalSeconds: number
  }
  featureFlags: {
    realSessionPrototype: boolean
    realScriptGeneration: boolean
  }
}

export interface LlmState {
  activeConfigId?: Identifier
  activeVisionConfigId?: Identifier
  configs: LlmSessionConfig[]
  session: LlmSessionConfig
  visionSession?: LlmSessionConfig
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

export type AgentStepType = "thinking" | "tool_call" | "tool_result" | "generation" | "verification" | "error"

export interface AgentStep {
  id: string
  type: AgentStepType
  stage?: AgentStage
  title: string
  content: string
  detail?: string
  status: "running" | "completed" | "error"
  toolName?: string
  timestamp: string
  payloadJson?: string
  screenshotUrl?: string
  url?: string
  fileName?: string
  selector?: string
  runId?: Identifier
  scriptId?: Identifier
}

export interface DirectOperationStep {
  index: number
  action: string
  description: string
  status: "completed" | "error"
  screenshotUrl?: string
  url?: string
  timestamp: string
}

export interface DirectExecutionResult {
  /** 按时间顺序的操作步骤 */
  operationSteps: DirectOperationStep[]
  /** 最终状态 */
  outcome: "completed" | "partial" | "failed"
  /** Agent 对执行结果的总结 */
  summary?: string
}

export interface AgentSession {
  id: Identifier
  projectId: Identifier
  testCaseId: Identifier
  mode: AgentSessionMode
  status: AgentSessionStatus
  verificationStatus: VerificationStatus
  steps: AgentStep[]
  resultScriptId?: Identifier
  latestScriptId?: Identifier
  latestRunId?: Identifier
  warmupRunId?: Identifier
  preconditionSummary?: string[]
  finalSummary?: string
  directResult?: DirectExecutionResult
  error?: string
  startedAt: string
  pausedAt?: string
  finishedAt?: string
}

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

export type AuthLoginSandboxStatus =
  | "starting"
  | "live"
  | "saving"
  | "saved"
  | "cancelled"
  | "error"

/**
 * 复杂登录沙盒会话：用户在服务端浏览器里"亲手登录"，登录成功后把 storageState
 * 写入 (authProfile, targetUrl) 的状态行。画面通过 WS-JPEG 实时流推送到前端，
 * 用户的点击/输入/滚动通过 interactions 接口转发到服务端 page。
 * 会话仅存于内存（进程级），不落 DB，关闭即销毁。
 */
export interface AuthLoginSandboxSession {
  id: Identifier
  projectId: Identifier
  authProfileId: Identifier
  targetUrlId: Identifier
  targetUrl: string
  status: AuthLoginSandboxStatus
  currentUrl?: string
  pageTitle?: string
  liveViewport?: LiveViewportState
  /** 保存登录态后的 storageState 概要（cookie / origin 数量等）。 */
  savedSummary?: StorageStateSummary
  /** 保存时浏览器停留的 URL，会写入 auth_profile_states.post_login_url_auto。 */
  postLoginUrl?: string
  error?: string
  startedAt: string
  finishedAt?: string
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

export type ValidationProgressStatus = "running" | "done" | "error" | "skipped"
export type ValidationTaskStatus = "running" | "completed" | "error"
export type ValidationTaskKind = "generate" | "check"

/**
 * 失效校验脚本生成 / 登录状态重放过程中，单个可视化步骤。
 * 兼容旧版（label/status/detail），新版可携带截图、代码预览、元数据。
 */
export type ValidationProgressStepKind =
  | "init" // 加载配置
  | "browser" // 启动/操作浏览器
  | "navigate" // 导航到 URL
  | "snapshot" // DOM/截图采集
  | "llm" // 调 LLM
  | "verify" // 验证脚本回归
  | "save" // 落库
  | "result" // 最终结果

export interface ValidationProgressStep {
  label: string
  status: ValidationProgressStatus
  kind?: ValidationProgressStepKind
  detail?: string
  screenshotUrl?: string
  codePreview?: string
  metaJson?: string
  iteration?: number
}

export interface ValidationTask {
  id: Identifier
  profileId: Identifier
  /** 区分"生成校验脚本"和"检查登录状态"两类任务 */
  kind?: ValidationTaskKind
  /** 任务作用的目标 URL（check / refresh 都按 URL 维度处理）。 */
  targetUrlId?: Identifier
  status: ValidationTaskStatus
  steps: ValidationProgressStep[]
  resultProfile?: AuthProfile
  /** check 任务的最终结果 */
  checkResult?: { valid: boolean; error?: string }
  error?: string
}

export interface GenerateValidationScriptResponse {
  taskId: Identifier
}

export interface CheckLoginStatusResponse {
  valid: boolean
  error?: string
  taskId?: Identifier
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
