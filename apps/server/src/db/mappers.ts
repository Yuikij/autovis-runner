import type { CopilotSecretState } from "../copilot.js"
import type {
  AgentSession,
  AgentStep,
  AuthProfileState,
  ExecutionRun,
  GitAuthProfile,
  LlmSessionConfig,
  Module,
  Project,
  ProjectWorkspace,
  RecorderSession,
  ScheduleTrigger,
  ScriptArtifact,
  TargetUrl,
  Task,
  TaskItem,
  TaskModeConfig,
  TaskRun,
  TestCase,
  AuthProfile,
} from "@autovis/shared"
import {
  buildDefaultLlmState,
  buildDefaultSession,
  buildLegacyLlmState,
  normalizePersistedLlmState,
  parseJson,
  toPublicLlmState,
  type PersistedLlmState,
} from "./shared.js"
import { decryptStoredText } from "./secrets.js"

const mergeLlmSecrets = (state: PersistedLlmState, secretsJson: string | null): PersistedLlmState => {
  const secrets = parseJson<Record<string, { apiKey?: string; copilot?: CopilotSecretState }>>(
    decryptStoredText(secretsJson) ?? null,
    {},
  )

  return {
    activeConfigId: state.activeConfigId,
    activeVisionConfigId: state.activeVisionConfigId,
    configs: state.configs.map((item) => ({
      session: item.session,
      secrets: secrets[item.session.id] ?? item.secrets ?? {},
    })),
  }
}

export interface ProjectRow {
  id: string
  name: string
  description: string
  test_base_url: string
  version: string
  created_at: string
  updated_at: string
}

export interface ModuleRow {
  id: string
  project_id: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export interface ProjectWorkspaceRow {
  project_id: string
  source_kind: ProjectWorkspace["sourceKind"]
  managed_root: string
  git_repo_url: string
  local_source_path: string
  branch: string
  ref: string
  last_commit_sha: string | null
  git_auth_profile_id: string | null
  status: ProjectWorkspace["status"]
  last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface GitAuthProfileRow {
  id: string
  name: string
  kind: GitAuthProfile["kind"]
  host_pattern: string
  username: string | null
  secret: string | null
  created_at: string
  updated_at: string
}

export interface TestCaseRow {
  id: string
  project_id: string
  case_code: string
  module_name: string | null
  module_id: string | null
  purpose: string
  dependency_case_ids: string | null
  steps: string
  expected_result: string
  test_type: TestCase["testType"]
  bug_id: string | null
  note: string | null
  ai_script: string | null
  latest_script_id: string | null
  last_verified_run_id: string | null
  last_verified_status: string | null
  last_verified_at: string | null
  auth_profile_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface AuthProfileRow {
  id: string
  project_id: string
  name: string
  description: string | null
  source_case_id: string
  validation_script_id: string | null
  validation_script: string | null
  validation_script_generated_at: string | null
  created_at: string
  updated_at: string
}

export interface AuthProfileStateRow {
  auth_profile_id: string
  target_url_id: string
  storage_state_json: string | null
  last_refreshed_at: string | null
  updated_at: string
  post_login_url_auto: string | null
  post_login_url_override: string | null
}

export interface TargetUrlRow {
  id: string
  project_id: string
  label: string
  url: string
  is_primary: number
  created_at: string
  updated_at: string
}

export interface TaskRow {
  id: string
  project_id: string
  name: string
  description: string | null
  items_json: string | null
  execution_mode: string | null
  last_run_id: string | null
  last_status: TaskRun["status"] | null
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export interface ScheduleTriggerRow {
  id: string
  project_id: string
  task_id: string
  name: string
  kind: ScheduleTrigger["kind"]
  at_time: string | null
  cron_expr: string | null
  enabled: number
  last_fired_at: string | null
  next_fire_at: string | null
  created_at: string
  updated_at: string
}

export interface ScriptRow {
  id: string
  test_case_id: string
  version: number
  source: ScriptArtifact["source"]
  provider: ScriptArtifact["provider"]
  prompt: string
  code: string
  created_at: string
}

export interface RunRow {
  id: string
  project_id: string
  test_case_id: string
  script_id: string
  kind: ExecutionRun["kind"] | null
  task_run_id: string | null
  batch_order: number | null
  status: ExecutionRun["status"]
  started_at: string
  finished_at: string | null
  current_viewport: string
  live_viewport: string | null
  pending_human_handoff: string | null
  orchestration_phase: string | null
  current_precondition_case_id: string | null
  completed_precondition_case_ids: string | null
  precondition_summary: string | null
  runtime_outputs: string | null
  logs: string
  steps: string
  artifacts: string
  test_base_url?: string
  target_url_id?: string | null
}

export interface TaskRunRow {
  id: string
  project_id: string
  task_id: string
  status: TaskRun["status"]
  test_base_url: string
  target_url_id?: string | null
  total_count: number
  queued_count: number
  running_count: number
  passed_count: number
  failed_count: number
  skipped_count: number
  run_ids: string
  current_run_id: string | null
  current_agent_id: string | null
  last_agent_id: string | null
  logs: string
  started_at: string
  finished_at: string | null
  schedule_trigger_id?: string | null
  attempt_no?: number | null
  parent_task_run_id?: string | null
  effective_task_mode?: string | null
}

export interface AgentSessionRow {
  id: string
  project_id: string
  test_case_id: string
  mode: AgentSession["mode"]
  status: AgentSession["status"]
  verification_status: AgentSession["verificationStatus"]
  result_script_id: string | null
  latest_script_id: string | null
  latest_run_id: string | null
  warmup_run_id: string | null
  task_run_id: string | null
  precondition_summary: string | null
  final_summary: string | null
  direct_result: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface AgentStepRow {
  id: string
  session_id: string
  type: AgentStep["type"]
  stage: AgentStep["stage"] | null
  title: string
  content: string
  detail: string | null
  status: AgentStep["status"]
  tool_name: string | null
  timestamp: string
  payload_json: string | null
  screenshot_url: string | null
  url: string | null
  file_name: string | null
  selector: string | null
  run_id: string | null
  script_id: string | null
  position: number
}

export interface LlmSessionRow {
  provider: LlmSessionConfig["provider"]
  proxy_endpoint: string
  model: string
  signed_in: number
  connection_status: LlmSessionConfig["connectionStatus"]
  base_url: string
  login_mode: LlmSessionConfig["loginMode"]
  last_synced_at: string | null
  last_error: string | null
  pending_device_auth: string | null
  feature_flags: string
  copilot_secrets: string
  configs_json: string | null
  llm_secrets_json: string | null
  active_config_id: string | null
}

export interface RecorderSessionRow {
  id: string
  project_id: string
  test_case_id: string
  status: RecorderSession["status"]
  test_base_url: string
  target_url_id?: string | null
  current_viewport: string
  current_url: string | null
  page_title: string | null
  actions: string
  artifacts: string
  generated_script_id: string | null
  started_at: string
  finished_at: string | null
  error: string | null
}

export const mapProject = (
  row: ProjectRow,
  counts: {
    totalCases: number
    totalScripts: number
    lastRunStatus: Project["summary"]["lastRunStatus"]
  },
  targetUrls: TargetUrl[] = [],
): Project => ({
  id: row.id,
  name: row.name,
  description: row.description,
  testBaseUrl: row.test_base_url ?? "",
  version: row.version ?? "",
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  summary: counts,
  targetUrls,
})

export const mapTargetUrl = (row: TargetUrlRow): TargetUrl => ({
  id: row.id,
  projectId: row.project_id,
  label: row.label,
  url: row.url,
  isPrimary: row.is_primary === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapAuthProfileState = (row: AuthProfileStateRow): AuthProfileState => ({
  authProfileId: row.auth_profile_id,
  targetUrlId: row.target_url_id,
  storageStateJson: decryptStoredText(row.storage_state_json) ?? undefined,
  lastRefreshedAt: row.last_refreshed_at ?? undefined,
  updatedAt: row.updated_at,
  postLoginUrlAuto: row.post_login_url_auto ?? undefined,
  postLoginUrlOverride: row.post_login_url_override ?? undefined,
})

export const mapModule = (row: ModuleRow): Module => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapProjectWorkspace = (row: ProjectWorkspaceRow): ProjectWorkspace => ({
  projectId: row.project_id,
  sourceKind: resolveWorkspaceSourceKind({
    sourceKind: row.source_kind,
    gitRepoUrl: row.git_repo_url ?? "",
    localSourcePath: row.local_source_path ?? "",
  }),
  managedRoot: row.managed_root,
  gitRepoUrl: row.git_repo_url ?? "",
  localSourcePath: row.local_source_path ?? "",
  branch: row.branch ?? "",
  ref: row.ref ?? "",
  lastCommitSha: row.last_commit_sha ?? undefined,
  gitAuthProfileId: row.git_auth_profile_id ?? undefined,
  status: row.status,
  lastSyncedAt: row.last_synced_at ?? undefined,
  lastError: row.last_error ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapGitAuthProfile = (row: GitAuthProfileRow): GitAuthProfile => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  hostPattern: row.host_pattern,
  username: row.username ?? undefined,
  secret: decryptStoredText(row.secret) ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const resolveWorkspaceSourceKind = (input: {
  sourceKind: ProjectWorkspace["sourceKind"]
  gitRepoUrl: string
  localSourcePath: string
}): ProjectWorkspace["sourceKind"] => {
  const gitRepoUrl = input.gitRepoUrl.trim()
  const localSourcePath = input.localSourcePath.trim()
  if (gitRepoUrl && !localSourcePath) return "git"
  if (localSourcePath && !gitRepoUrl) return "local_path"
  return input.sourceKind
}

export const mapTestCase = (row: TestCaseRow): TestCase => ({
  id: row.id,
  projectId: row.project_id,
  caseCode: row.case_code,
  moduleName: row.module_name ?? undefined,
  moduleId: row.module_id ?? undefined,
  purpose: row.purpose,
  dependencyCaseIds: parseJson(row.dependency_case_ids, [] as string[]),
  steps: parseJson(row.steps, [] as string[]),
  expectedResult: row.expected_result,
  testType: row.test_type,
  bugId: row.bug_id ?? undefined,
  note: row.note ?? undefined,
  aiScript: row.ai_script ?? undefined,
  latestScriptId: row.latest_script_id ?? undefined,
  lastVerifiedRunId: row.last_verified_run_id ?? undefined,
  lastVerifiedStatus: (row.last_verified_status as TestCase["lastVerifiedStatus"]) ?? undefined,
  lastVerifiedAt: row.last_verified_at ?? undefined,
  authProfileId: row.auth_profile_id ?? undefined,
  createdAt: row.created_at ?? undefined,
  updatedAt: row.updated_at ?? undefined,
})

export const mapAuthProfile = (row: AuthProfileRow, states: AuthProfileState[] = []): AuthProfile => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  description: row.description ?? undefined,
  sourceCaseId: row.source_case_id,
  validationScriptId: row.validation_script_id ?? undefined,
  validationScript: row.validation_script ?? undefined,
  validationScriptGeneratedAt: row.validation_script_generated_at ?? undefined,
  states,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapTask = (row: TaskRow): Task => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name ?? "",
  description: row.description ?? undefined,
  items: parseJson<TaskItem[]>(row.items_json, [] as TaskItem[]),
  executionMode: parseJson<TaskModeConfig | undefined>(row.execution_mode, undefined),
  lastRunId: row.last_run_id ?? undefined,
  lastStatus: row.last_status ?? undefined,
  lastRunAt: row.last_run_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapScheduleTrigger = (row: ScheduleTriggerRow): ScheduleTrigger => ({
  id: row.id,
  projectId: row.project_id,
  taskId: row.task_id,
  name: row.name ?? "",
  kind: row.kind,
  atTime: row.at_time ?? undefined,
  cronExpr: row.cron_expr ?? undefined,
  enabled: row.enabled === 1,
  lastFiredAt: row.last_fired_at ?? undefined,
  nextFireAt: row.next_fire_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const mapScript = (row: ScriptRow): ScriptArtifact => ({
  id: row.id,
  testCaseId: row.test_case_id,
  version: row.version,
  source: row.source,
  provider: row.provider,
  prompt: row.prompt,
  code: row.code,
  createdAt: row.created_at,
})

export const mapRun = (row: RunRow): ExecutionRun => ({
  id: row.id,
  projectId: row.project_id,
  testCaseId: row.test_case_id,
  scriptId: row.script_id,
  kind: row.kind ?? "execution",
  taskRunId: row.task_run_id ?? undefined,
  batchOrder: row.batch_order ?? undefined,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  currentViewport: row.current_viewport,
  liveViewport: parseJson(row.live_viewport, undefined as ExecutionRun["liveViewport"]),
  pendingHumanHandoff: parseJson(row.pending_human_handoff, undefined as ExecutionRun["pendingHumanHandoff"]),
  orchestrationPhase: (row.orchestration_phase ?? undefined) as ExecutionRun["orchestrationPhase"],
  currentPreconditionCaseId: row.current_precondition_case_id ?? undefined,
  completedPreconditionCaseIds: parseJson(row.completed_precondition_case_ids, undefined as ExecutionRun["completedPreconditionCaseIds"]),
  preconditionSummary: parseJson(row.precondition_summary, undefined as ExecutionRun["preconditionSummary"]),
  runtimeOutputs: parseJson(row.runtime_outputs, undefined as ExecutionRun["runtimeOutputs"]),
  logs: parseJson(row.logs, [] as string[]),
  steps: parseJson(row.steps, [] as ExecutionRun["steps"]),
  artifacts: parseJson(row.artifacts, [] as ExecutionRun["artifacts"]),
  targetUrlId: row.target_url_id ?? undefined,
  testBaseUrl: row.test_base_url ?? "",
})

export const mapTaskRun = (row: TaskRunRow): TaskRun => ({
  id: row.id,
  projectId: row.project_id,
  taskId: row.task_id,
  status: row.status,
  targetUrlId: row.target_url_id ?? undefined,
  testBaseUrl: row.test_base_url,
  totalCount: row.total_count,
  queuedCount: row.queued_count,
  runningCount: row.running_count,
  passedCount: row.passed_count,
  failedCount: row.failed_count,
  skippedCount: row.skipped_count,
  runIds: parseJson(row.run_ids, [] as string[]),
  currentRunId: row.current_run_id ?? undefined,
  currentAgentId: row.current_agent_id ?? undefined,
  lastAgentId: row.last_agent_id ?? undefined,
  logs: parseJson(row.logs, [] as string[]),
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  scheduleTriggerId: row.schedule_trigger_id ?? undefined,
  attemptNo: row.attempt_no ?? undefined,
  parentTaskRunId: row.parent_task_run_id ?? undefined,
  effectiveTaskMode: parseJson<TaskModeConfig | undefined>(row.effective_task_mode ?? null, undefined),
})

export const mapAgentStep = (row: AgentStepRow): AgentStep => ({
  id: row.id,
  type: row.type,
  stage: row.stage ?? undefined,
  title: row.title,
  content: row.content,
  detail: row.detail ?? undefined,
  status: row.status,
  toolName: row.tool_name ?? undefined,
  timestamp: row.timestamp,
  payloadJson: row.payload_json ?? undefined,
  screenshotUrl: row.screenshot_url ?? undefined,
  url: row.url ?? undefined,
  fileName: row.file_name ?? undefined,
  selector: row.selector ?? undefined,
  runId: row.run_id ?? undefined,
  scriptId: row.script_id ?? undefined,
})

export const mapAgentSession = (row: AgentSessionRow, steps: AgentStep[]): AgentSession => ({
  id: row.id,
  projectId: row.project_id,
  testCaseId: row.test_case_id,
  mode: row.mode,
  status: row.status,
  verificationStatus: row.verification_status,
  steps,
  resultScriptId: row.result_script_id ?? undefined,
  latestScriptId: row.latest_script_id ?? undefined,
  latestRunId: row.latest_run_id ?? undefined,
  warmupRunId: row.warmup_run_id ?? undefined,
  taskRunId: row.task_run_id ?? undefined,
  preconditionSummary: parseJson(row.precondition_summary, undefined as AgentSession["preconditionSummary"]),
  finalSummary: row.final_summary ?? undefined,
  directResult: parseJson(row.direct_result, undefined as AgentSession["directResult"]),
  error: row.error ?? undefined,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
})

export const mapPersistedLlmState = (row: LlmSessionRow | undefined): PersistedLlmState => {
  if (!row) {
    return buildDefaultLlmState()
  }

  if (row.configs_json) {
    return mergeLlmSecrets(
      normalizePersistedLlmState(parseJson(row.configs_json, buildDefaultLlmState())),
      row.llm_secrets_json ?? null,
    )
  }

  const legacySession: LlmSessionConfig = {
    id: buildDefaultSession().id,
    name: buildDefaultSession().name,
    provider: row.provider,
    proxyEndpoint: row.proxy_endpoint,
    model: row.model,
    signedIn: Boolean(row.signed_in),
    connectionStatus: row.connection_status,
    baseUrl: row.base_url,
    loginMode: row.login_mode,
    lastSyncedAt: row.last_synced_at ?? undefined,
    lastError: row.last_error ?? undefined,
    pendingDeviceAuth: parseJson(row.pending_device_auth, undefined as LlmSessionConfig["pendingDeviceAuth"]),
    featureFlags: parseJson(row.feature_flags, buildDefaultSession().featureFlags),
    apiKeyConfigured: false,
  }

  return buildLegacyLlmState(
    legacySession,
    parseJson(decryptStoredText(row.copilot_secrets) ?? null, {} as CopilotSecretState),
  )
}

export const mapLlmState = (row: LlmSessionRow | undefined): { session: LlmSessionConfig; secrets: CopilotSecretState } => {
  const state = mapPersistedLlmState(row)
  const active = state.configs.find((item) => item.session.id === state.activeConfigId) ?? state.configs[0]
  return {
    session: toPublicLlmState(state).session,
    secrets: active?.secrets.copilot ?? {},
  }
}

export const mapRecorderSession = (row: RecorderSessionRow): RecorderSession => ({
  id: row.id,
  projectId: row.project_id,
  testCaseId: row.test_case_id,
  status: row.status,
  targetUrlId: row.target_url_id ?? undefined,
  testBaseUrl: row.test_base_url,
  currentViewport: row.current_viewport,
  currentUrl: row.current_url ?? undefined,
  pageTitle: row.page_title ?? undefined,
  actions: parseJson(row.actions, [] as RecorderSession["actions"]),
  artifacts: parseJson(row.artifacts, [] as RecorderSession["artifacts"]),
  generatedScriptId: row.generated_script_id ?? undefined,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  error: row.error ?? undefined,
})
