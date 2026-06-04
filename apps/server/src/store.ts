import { AutoVisDatabase } from "./db.js"
import { WorkspaceService } from "./workspace.js"
import { appOrigin, dataDir, now } from "./services/common.js"
import { SuiteService } from "./services/suite.service.js"
import { TaskService } from "./services/task.service.js"
import { LlmConfigService } from "./services/llm-config.service.js"
import { ProjectService } from "./services/project.service.js"
import { RunService } from "./services/run.service.js"
import { AgentService } from "./services/agent.service.js"
import { ValidationService } from "./services/validation.service.js"
import { AgentWarmupService } from "./services/agent-warmup.service.js"
import { RecorderService } from "./services/recorder.service.js"
import { AuthLoginSandboxService } from "./services/auth-login-sandbox.service.js"
import { SchedulerService } from "./services/scheduler.service.js"
import { taskControlRegistry } from "./services/task-control.js"
import { getSessionToken, type AuthUser } from "./auth.js"
import type { FastifyRequest } from "fastify"

import {
  type AgentSession,
  type ExecutionRun,
  type GenerateScriptRequest,
  type StartAuthLoginSandboxRequest,
  type StartDirectAgentRequest,
  type ImportLocalWorkspaceRequest,
  type RecorderInteractionRequest,
  type RecorderSession,
  type StartRecorderSessionRequest,
  type StartRunRequest,
  type StartTaskRunRequest,
  type StopRecorderSessionRequest,
  type SyncProjectWorkspaceRequest,
  type TaskRun,
  type UpsertGitAuthProfileRequest,
  type UpsertLlmConfigRequest,
  type UpsertModuleRequest,
  type UpsertProjectRequest,
  type UpsertProjectWorkspaceRequest,
  type UpsertScheduleTriggerRequest,
  type UpsertTargetUrlRequest,
  type UpsertTestCaseRequest,
  type UpsertTaskRequest,
  type UpsertAuthProfileRequest,
  type TestCase,
} from "@autovis/shared"

class PersistentStore {
  private readonly db = new AutoVisDatabase(dataDir, appOrigin)
  private readonly workspace = new WorkspaceService(dataDir)

  private readonly tasks = taskControlRegistry
  private readonly suiteService = new SuiteService(this.db)
  private readonly taskService = new TaskService(this.db)
  private readonly llmService = new LlmConfigService(this.db)
  private readonly projectService = new ProjectService(this.db, this.workspace, this.suiteService, this.llmService)
  private readonly runService = new RunService(this.db, this.suiteService, this.llmService, this.tasks)
  private readonly agentWarmupService = new AgentWarmupService(this.db, this.suiteService, this.runService)
  private readonly agentService = new AgentService(this.db, this.suiteService, this.llmService, this.projectService, this.runService, this.agentWarmupService, this.tasks)
  private readonly validationService = new ValidationService(this.db, this.llmService)
  private readonly recorderService = new RecorderService(
    this.db,
    (req) => this.runService.startVerification(req),
    (testCaseId, provider, prompt, code, source) => this.agentService.createScriptArtifact(testCaseId, provider, prompt, code, source),
    this.tasks,
  )
  private readonly authLoginSandboxService = new AuthLoginSandboxService(this.db)
  private readonly schedulerService = new SchedulerService(this.db, this.runService)

  constructor() {
    // 注入 AI 直接执行回调，使任务可以在无脚本时走 agent 路径
    this.runService.runDirectAgentForTask = (opts) => this.agentService.startDirectAgentForTask(opts)
    this.runService.cancelAgentCallback = (sessionId) => this.agentService.cancelAgent(sessionId)
    this.runService.getAgentSessionCallback = (sessionId) => this.agentService.getAgentSession(sessionId)
    this.reapStaleTasks()
    this.scheduleTemporaryRunCleanup()
    this.schedulerService.start()
  }

  private scheduleTemporaryRunCleanup() {
    const intervalMs = 30 * 60 * 1000
    const maxAgeMs = 2 * 60 * 60 * 1000
    const cleanup = () => {
      const cutoff = Date.now() - maxAgeMs
      for (const run of this.db.listAllRuns()) {
        if (run.kind !== "temporary") continue
        if (this.tasks.has(run.id)) continue
        const isTerminal = run.status === "passed" || run.status === "failed" || run.status === "cancelled" || run.status === "interrupted"
        if (!isTerminal) continue
        const ts = run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(run.startedAt)
        if (Number.isFinite(ts) && ts < cutoff) {
          try {
            this.db.deleteRun(run.id)
          } catch (err) {
            console.warn("[store] failed to delete stale temporary run", run.id, err)
          }
        }
      }
    }
    cleanup()
    setInterval(cleanup, intervalMs).unref?.()
  }

  private reapStaleTasks() {
    const reason = "进程重启导致中断"
    const isLive = (id: string) => this.tasks.has(id)

    for (const agent of this.db.listAllAgentSessions()) {
      if (!isLive(agent.id) && (agent.status === "running" || agent.status === "paused" || agent.status === "cancelling")) {
        agent.status = "interrupted"
        agent.error = agent.error || reason
        agent.finishedAt = agent.finishedAt || now()
        agent.pausedAt = undefined
        this.db.upsertAgentSession(agent)
      }
    }

    for (const run of this.db.listAllRuns()) {
      if (!isLive(run.id) && (run.status === "running" || run.status === "paused" || run.status === "cancelling" || run.status === "awaiting_human" || run.status === "queued")) {
        run.status = "interrupted"
        run.finishedAt = run.finishedAt || now()
        run.pendingHumanHandoff = undefined
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
        this.db.upsertRun(run)
      }
    }

    for (const taskRun of this.db.listAllTaskRuns()) {
      if (!isLive(taskRun.id) && (taskRun.status === "running" || taskRun.status === "paused" || taskRun.status === "cancelling" || taskRun.status === "queued")) {
        taskRun.status = "interrupted"
        taskRun.finishedAt = taskRun.finishedAt || now()
        taskRun.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
        this.db.upsertTaskRun(taskRun)
      }
    }

    for (const recorder of this.db.listAllRecorderSessions()) {
      if (!isLive(recorder.id) && (recorder.status === "running" || recorder.status === "paused" || recorder.status === "cancelling" || recorder.status === "starting" || recorder.status === "stopping")) {
        recorder.status = "interrupted"
        recorder.finishedAt = recorder.finishedAt || now()
        recorder.error = recorder.error || reason
        this.db.upsertRecorderSession(recorder)
      }
    }
  }

  // -- Project Service Delegation --
  async listProjects() { return this.db.listProjects() }
  async getProject(projectId: string) { return this.db.getProject(projectId) }
  async getProjectWorkspace(projectId: string) { return this.projectService.getWorkspaceConfig(projectId) }
  async listGitAuthProfiles() { return this.db.listGitAuthProfiles() }
  async saveGitAuthProfile(input: UpsertGitAuthProfileRequest) { return this.projectService.saveGitAuthProfile(input) }
  async deleteGitAuthProfile(profileId: string) { return this.projectService.deleteGitAuthProfile(profileId) }
  async listAuthProfiles(projectId: string) { return this.db.listAuthProfiles(projectId) }
  async getAuthProfile(profileId: string) { return this.db.getAuthProfile(profileId) }
  async saveAuthProfile(input: UpsertAuthProfileRequest) { return this.projectService.saveAuthProfile(input) }
  async deleteAuthProfile(profileId: string) { return this.db.deleteAuthProfile(profileId) }
  startGenerateValidationScript(projectId: string, profileId: string, targetUrlId?: string, llmOwnerKey = "shared") { return this.validationService.startGenerateValidationScript(projectId, profileId, targetUrlId, llmOwnerKey) }
  startCheckLoginStatus(projectId: string, profileId: string, targetUrlId: string) { return this.validationService.startCheckLoginStatus(projectId, profileId, targetUrlId) }
  /**
   * 跑该登录态的 sourceCase（按指定 targetUrl），通过现有 storageState 自动捕获逻辑写入 auth_profile_states 行。
   * 完全独立于用例执行流程：不要求任何测试用例显式配置 authProfileId。
   */
  /**
   * 设置 / 清除某 (profile, targetUrl) 行的"登录后 URL"手动覆盖。
   * 传 null 表示清除覆盖，回退到自动采集值。
   */
  async setAuthProfileStatePostLoginUrl(profileId: string, targetUrlId: string, overrideUrl: string | null) {
    const profile = this.db.getAuthProfile(profileId)
    if (!profile) throw new Error("Auth profile not found")
    const targetUrl = this.db.getTargetUrl(targetUrlId)
    if (!targetUrl || targetUrl.projectId !== profile.projectId) {
      throw new Error("目标 URL 不存在或不属于该项目，请刷新页面后重试。")
    }
    const trimmed = overrideUrl?.trim()
    return this.db.setAuthProfileStatePostLoginUrlOverride(profileId, targetUrlId, trimmed ? trimmed : null)
  }

  async startRefreshAuthProfileState(profileId: string, targetUrlId: string) {
    const profile = this.db.getAuthProfile(profileId)
    if (!profile) throw new Error("Auth profile not found")
    const targetUrl = this.db.getTargetUrl(targetUrlId)
    if (!targetUrl || targetUrl.projectId !== profile.projectId) {
      throw new Error("目标 URL 不存在或不属于该项目，请刷新页面后重试。")
    }
    const run = await this.runService.runSourceCaseForAuth(profile.id, targetUrl.id)
    return { runId: run.id, targetUrlId: targetUrl.id, testBaseUrl: targetUrl.url }
  }

  // -- TargetUrl --
  async listTargetUrls(projectId: string) { return this.db.listTargetUrls(projectId) }
  async createTargetUrl(input: UpsertTargetUrlRequest) {
    if (!input.label?.trim() || !input.url?.trim()) throw new Error("label 和 url 都不能为空")
    const url = input.url.trim()
    const existing = this.db.findTargetUrlByUrl(input.projectId, url)
    if (existing) throw new Error("该项目下已存在同样的 URL")
    return this.db.createTargetUrl({
      id: `target-url-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      projectId: input.projectId,
      label: input.label.trim(),
      url,
    })
  }
  async updateTargetUrl(id: string, patch: { label?: string; url?: string }) {
    const cleaned: { label?: string; url?: string } = {}
    if (patch.label !== undefined) cleaned.label = patch.label.trim()
    if (patch.url !== undefined) cleaned.url = patch.url.trim()
    if (cleaned.url) {
      const existing = this.db.getTargetUrl(id)
      if (existing) {
        const dup = this.db.findTargetUrlByUrl(existing.projectId, cleaned.url)
        if (dup && dup.id !== id) throw new Error("该项目下已存在同样的 URL")
      }
    }
    return this.db.updateTargetUrl(id, cleaned)
  }
  async deleteTargetUrl(id: string) {
    return this.db.deleteTargetUrl(id)
  }
  getValidationTask(taskId: string) { return this.validationService.getValidationTask(taskId) }
  subscribeValidationTask(taskId: string, listener: (task: any) => void) { return this.validationService.subscribeValidationTask(taskId, listener) }
  async syncProjectFiles(projectId: string, sourcePathOrUrl: string) { return this.projectService.syncProjectFiles(projectId, sourcePathOrUrl) }
  async saveProject(input: UpsertProjectRequest) { return this.projectService.saveProject(input) }
  async saveProjectWorkspace(projectId: string, input: UpsertProjectWorkspaceRequest) { return this.projectService.saveProjectWorkspace(projectId, input) }
  async importLocalWorkspace(projectId: string, input: ImportLocalWorkspaceRequest) { return this.projectService.importLocalWorkspace(projectId, input) }
  async syncProjectWorkspace(projectId: string, input: SyncProjectWorkspaceRequest) { return this.projectService.syncProjectWorkspace(projectId, input) }
  async importUploadedWorkspace(projectId: string, uploadedDir: string) { return this.projectService.importUploadedWorkspace(projectId, uploadedDir) }
  async listWorkspaceTree(projectId: string, path = "") { return this.projectService.listWorkspaceTree(projectId, path) }
  async globWorkspacePaths(projectId: string, pattern: string) { return this.projectService.globWorkspacePaths(projectId, pattern) }
  async searchWorkspaceCode(projectId: string, query: string, path = "", limit = 20) { return this.projectService.searchWorkspaceCode(projectId, query, path, limit) }
  async readWorkspaceFile(projectId: string, path: string, offset = 0, limit = 200) { return this.projectService.readWorkspaceFile(projectId, path, offset, limit) }
  async deleteProject(projectId: string) { return this.projectService.deleteProject(projectId) }
  async clearRuns(projectId: string) { return this.projectService.clearRuns(projectId) }
  async getTestCase(testCaseId: string) { return this.db.getTestCase(testCaseId) }
  async saveTestCase(input: UpsertTestCaseRequest) { return this.projectService.saveTestCase(input) }
  async deleteTestCase(testCaseId: string) { return this.projectService.deleteTestCase(testCaseId) }
  async listModules(projectId: string) { return this.projectService.listModules(projectId) }
  async saveModule(input: UpsertModuleRequest) { return this.projectService.saveModule(input) }
  async deleteModule(moduleId: string) { return this.projectService.deleteModule(moduleId) }
  async getDashboard(projectId?: string) { return this.projectService.getDashboard(projectId) }

  // -- DB Delegation (Direct) --
  async listTestCases(projectId: string) { return this.db.listTestCases(projectId) }
  async listAllTestCases() { return this.db.listAllTestCases() }
  async listRuns(projectId: string) { return this.db.listRuns(projectId) }
  async listTaskRuns(projectId: string) { return this.db.listTaskRuns(projectId) }
  async getTaskRun(taskRunId: string) { return this.db.getTaskRun(taskRunId) }
  async listRecorderSessions(projectId: string) { return this.db.listRecorderSessions(projectId) }
  async getRecorderSession(sessionId: string) { return this.db.getRecorderSession(sessionId) }
  async listScriptsForTestCase(testCaseId: string) { return this.db.listScriptsForTestCase(testCaseId) }
  async getScript(scriptId: string) { return this.db.getScript(scriptId) }
  async deleteScript(scriptId: string) { return this.db.deleteScript(scriptId) }

  // -- Task Service --
  async listTasks(projectId: string) { return this.taskService.listTasks(projectId) }
  async getTask(taskId: string) { return this.taskService.getTask(taskId) }
  async saveTask(input: UpsertTaskRequest) { return this.taskService.saveTask(input) }
  async deleteTask(taskId: string) { return this.taskService.deleteTask(taskId) }
  async listTaskRunsForTask(taskId: string) { return this.taskService.listTaskRunsForTask(taskId) }

  // -- LLM Service --
  async getLlmSession(ownerKey = "shared") { return this.llmService.getLlmSession(ownerKey) }
  async getLlmState(ownerKey = "shared") { return this.llmService.getLlmState(ownerKey) }
  async saveLlmConfig(input: UpsertLlmConfigRequest, ownerKey = "shared") { return this.llmService.saveLlmConfig(input, ownerKey) }
  async activateLlmConfig(configId: string, ownerKey = "shared") { return this.llmService.activateLlmConfig(configId, ownerKey) }
  async activateVisionConfig(configId: string | null, ownerKey = "shared") { return this.llmService.activateVisionConfig(configId, ownerKey) }
  async deleteLlmConfig(configId: string, ownerKey = "shared") { return this.llmService.deleteLlmConfig(configId, ownerKey) }
  async startCopilotDeviceSession(req: { model?: string; configId?: string }, ownerKey = "shared") { return this.llmService.startCopilotDeviceSession(req, ownerKey) }
  async pollCopilotDeviceSession(req: { model?: string; configId?: string }, ownerKey = "shared") { return this.llmService.pollCopilotDeviceSession(req, ownerKey) }
  async fetchLlmModels(configId?: string, ownerKey = "shared") { return this.llmService.fetchLlmModels(configId, ownerKey) }
  async testLlmConfig(input: any, ownerKey = "shared") { return this.llmService.testLlmConfig(input, ownerKey) }
  async updateLlmModel(model: string, configId?: string, ownerKey = "shared") { return this.llmService.updateLlmModel(model, configId, ownerKey) }
  async disconnectCopilotSession(configId?: string, ownerKey = "shared") { return this.llmService.disconnectCopilotSession(configId, ownerKey) }

  resolveUserBySessionToken(token: string | undefined): AuthUser | null {
    return this.db.resolveUserBySessionToken(token)
  }

  login(username: string, password: string) {
    return this.db.login(username, password)
  }

  logout(request: FastifyRequest) {
    this.db.logoutToken(getSessionToken(request))
  }

  // -- Agent Service --
  async saveScriptVersion(testCaseId: string, input: { code: string; baseScriptId?: string; prompt?: string }) { return this.agentService.saveScriptVersion(testCaseId, input) }
  async generateScript(request: GenerateScriptRequest & { llmOwnerKey?: string }) { return this.agentService.generateScript(request) }
  async runScriptAgent(request: GenerateScriptRequest & { sessionId: string; llmOwnerKey?: string }) { return this.agentService.runScriptAgent(request) }
  async runDirectAgent(request: StartDirectAgentRequest & { sessionId: string; llmOwnerKey?: string }) { return this.agentService.runDirectAgent(request) }
  getAgentSession(sessionId: string) { return this.agentService.getAgentSession(sessionId) }
  subscribeAgent(sessionId: string, listener: (session: AgentSession) => void) { return this.agentService.subscribeAgent(sessionId, listener) }

  // -- Recorder Service --
  async startRecorderSession(request: StartRecorderSessionRequest) { return this.recorderService.startRecorderSession(request) }
  async applyRecorderInteraction(sessionId: string, interaction: RecorderInteractionRequest) { return this.recorderService.applyRecorderInteraction(sessionId, interaction) }
  async stopRecorderSession(sessionId: string, options: StopRecorderSessionRequest) { return this.recorderService.stopRecorderSession(sessionId, options) }
  subscribeRecorder(sessionId: string, listener: (session: RecorderSession) => void) { return this.recorderService.subscribeRecorder(sessionId, listener) }

  // -- Auth Login Sandbox Service --
  async startAuthLoginSandbox(request: StartAuthLoginSandboxRequest) { return this.authLoginSandboxService.start(request) }
  async interactAuthLoginSandbox(sessionId: string, interaction: RecorderInteractionRequest) { return this.authLoginSandboxService.interact(sessionId, interaction) }
  async saveAuthLoginSandbox(sessionId: string) { return this.authLoginSandboxService.save(sessionId) }
  async cancelAuthLoginSandbox(sessionId: string) { return this.authLoginSandboxService.cancel(sessionId) }
  getAuthLoginSandbox(sessionId: string) { return this.authLoginSandboxService.getSession(sessionId) }
  subscribeAuthLoginSandboxLiveViewport(sessionId: string, listener: (chunk: Uint8Array) => void) { return this.authLoginSandboxService.subscribeLiveViewport(sessionId, listener) }

  // -- Run Service --
  async startVerification(request: StartRunRequest & { llmOwnerKey?: string }) { return this.runService.startVerification(request) }
  async startRun(request: StartRunRequest & { llmOwnerKey?: string }) { return this.runService.startRun(request) }
  async startTaskRun(request: StartTaskRunRequest) { return this.runService.startTaskRun(request) }
  subscribeTaskRun(taskRunId: string, listener: (taskRun: TaskRun) => void) { return this.runService.subscribeTaskRun(taskRunId, listener) }
  async getRun(runId: string) { return this.runService.getRun(runId) }
  buildRepairPrompt(testCase: TestCase, run: ExecutionRun, originalPrompt: string) { return this.runService.buildRepairPrompt(testCase, run, originalPrompt) }
  async submitRunHumanInput(runId: string, handoffId: string, value: string) { return this.runService.submitRunHumanInput(runId, handoffId, value) }
  subscribe(runId: string, listener: (run: ExecutionRun) => void) { return this.runService.subscribe(runId, listener) }
  subscribeLiveViewport(runId: string, listener: (chunk: Uint8Array) => void) { return this.runService.subscribeLiveViewport(runId, listener) }
  pauseRun(runId: string) { return this.runService.pauseRun(runId) }
  resumeRun(runId: string) { return this.runService.resumeRun(runId) }
  cancelRun(runId: string) { return this.runService.cancelRun(runId) }
  pauseTaskRun(taskRunId: string) { return this.runService.pauseTaskRun(taskRunId) }
  resumeTaskRun(taskRunId: string) { return this.runService.resumeTaskRun(taskRunId) }
  cancelTaskRun(taskRunId: string) { return this.runService.cancelTaskRun(taskRunId) }

  // -- Agent control --
  pauseAgent(sessionId: string) { return this.agentService.pauseAgent(sessionId) }
  resumeAgent(sessionId: string) { return this.agentService.resumeAgent(sessionId) }
  cancelAgent(sessionId: string) { return this.agentService.cancelAgent(sessionId) }

  // -- Recorder control --
  pauseRecorder(sessionId: string) { return this.recorderService.pauseRecorder(sessionId) }
  resumeRecorder(sessionId: string) { return this.recorderService.resumeRecorder(sessionId) }
  async cancelRecorder(sessionId: string) { return this.recorderService.cancelRecorder(sessionId) }

  // -- Active tasks aggregation --
  getActiveTasksForProject(projectId: string) {
    const agents = this.db.listActiveAgentSessionsForProject(projectId)
    const runs = this.db.listActiveRunsForProject(projectId)
    const taskRuns = this.db.listActiveTaskRunsForProject(projectId)
    const recorderSessions = this.db.listActiveRecorderSessionsForProject(projectId)
    const summaries = [
      ...agents.map((s) => ({ kind: "agent" as const, id: s.id, projectId: s.projectId, testCaseId: s.testCaseId, status: s.status, startedAt: s.startedAt, pausedAt: s.pausedAt })),
      ...runs.map((r) => ({ kind: "run" as const, id: r.id, projectId: r.projectId, testCaseId: r.testCaseId, status: r.status, startedAt: r.startedAt })),
      ...taskRuns.map((s) => ({ kind: "task-run" as const, id: s.id, projectId: s.projectId, taskId: s.taskId, status: s.status, startedAt: s.startedAt })),
      ...recorderSessions.map((r) => ({ kind: "recorder" as const, id: r.id, projectId: r.projectId, testCaseId: r.testCaseId, status: r.status, startedAt: r.startedAt })),
    ]
    return { agents, runs, taskRuns, recorderSessions, summaries }
  }

  findActiveAgentForCase(testCaseId: string) {
    return this.agentService.findActiveAgentForCase(testCaseId)
  }

  // -- ScheduleTrigger --
  listScheduleTriggers(projectId: string) { return this.db.listScheduleTriggers(projectId) }
  listScheduleTriggersForTask(taskId: string) { return this.db.listScheduleTriggersForTask(taskId) }
  saveScheduleTrigger(input: UpsertScheduleTriggerRequest) { return this.schedulerService.upsert(input) }
  deleteScheduleTrigger(id: string) { return this.schedulerService.delete(id) }
  setScheduleTriggerEnabled(id: string, enabled: boolean) { return this.schedulerService.setEnabled(id, enabled) }
  fireScheduleTriggerNow(id: string) { return this.schedulerService.fireNow(id) }
}

export const store = new PersistentStore()
