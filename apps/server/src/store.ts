import { AutoVisDatabase } from "./db.js"
import { buildOutboxItems } from "./outbox.js"
import { WorkspaceService } from "./workspace.js"
import { appOrigin, createId, dataDir, now, removeArtifactDirs } from "./services/common.js"
import { SuiteService } from "./services/suite.service.js"
import { TaskService } from "./services/task.service.js"
import { LlmConfigService } from "./services/llm-config.service.js"
import { ProjectService } from "./services/project.service.js"
import { RunService } from "./services/run.service.js"
import { RunStateService } from "./services/run-state.service.js"
import { TaskRunService } from "./services/task-run.service.js"
import { AgentService } from "./services/agent.service.js"
import { ValidationService } from "./services/validation.service.js"
import { AgentWarmupService } from "./services/agent-warmup.service.js"
import { RecorderService } from "./services/recorder.service.js"
import { AuthLoginSandboxService } from "./services/auth-login-sandbox.service.js"
import { SchedulerService } from "./services/scheduler.service.js"
import { TaskControlRegistry } from "./services/task-control.js"
import { getSessionToken, type AuthUser } from "./auth.js"
import { CURRENT_SCHEMA_VERSION } from "./db/migrations.js"
import { log } from "./log.js"
import type { FastifyRequest } from "fastify"

import {
  type AgentSession,
  type ExecutionRun,
  type GenerateScriptRequest,
  type PersistedTaskControlCommand,
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
  type TaskControlAction,
  type TaskKind,
} from "@autovis/shared"

class PersistentStore {
  private readonly db = new AutoVisDatabase(dataDir, appOrigin)
  private readonly workspace = new WorkspaceService(dataDir)
  private readonly startedAt = now()
  private recoveryStatus: "running" | "succeeded" | "failed" = "running"
  private recoveryCompletedAt?: string
  private recoveryError?: string
  private schedulerStartedAt?: string

  private readonly tasks = new TaskControlRegistry(this.db)
  private readonly suiteService = new SuiteService(this.db)
  private readonly taskService = new TaskService(this.db)
  private readonly llmService = new LlmConfigService(this.db)
  private readonly projectService = new ProjectService(this.db, this.workspace, this.suiteService, this.llmService)
  private readonly runStateService = new RunStateService(this.db)
  private readonly runService = new RunService(this.db, this.suiteService, this.llmService, this.tasks, this.runStateService)
  private readonly taskRunService = new TaskRunService(this.db, this.tasks, this.runService)
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
  private readonly schedulerService = new SchedulerService(this.db, this.runService, this.taskRunService)

  constructor() {
    // 注入 AI 直接执行回调，使任务可以在无脚本时走 agent 路径
    this.taskRunService.runDirectAgentForTask = (opts) => this.agentService.startDirectAgentForTask(opts)
    this.taskRunService.cancelRunCallback = (runId) => this.cancelRun(runId)
    this.taskRunService.cancelAgentCallback = (sessionId) => this.cancelAgent(sessionId)
    this.taskRunService.getAgentSessionCallback = (sessionId) => this.agentService.getAgentSession(sessionId)
    this.taskRunService.recoverAgentCallback = (sessionId) => this.agentService.recoverAgent(sessionId)
    this.reapStaleTasks()
    this.scheduleTemporaryRunCleanup()
    this.schedulerService.start()
    this.schedulerStartedAt = now()
    void this.recoverExpiredTasks()
      .then(() => {
        this.recoveryStatus = "succeeded"
        this.recoveryCompletedAt = now()
      })
      .catch((error) => {
        this.recoveryStatus = "failed"
        this.recoveryCompletedAt = now()
        this.recoveryError = error instanceof Error ? error.message : String(error)
        log.error("store.lease_recovery.failed", { error })
      })
  }

  private scheduleTemporaryRunCleanup() {
    const intervalMs = 30 * 60 * 1000
    // 临时运行在执行记录页可见，保留 24 小时再自动回收（含产物目录）。
    const maxAgeMs = 24 * 60 * 60 * 1000
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
            void removeArtifactDirs([run.id])
          } catch (err) {
            log.warn("store.temp_run_cleanup.failed", { runId: run.id, error: err })
          }
        }
      }
    }
    cleanup()
    setInterval(cleanup, intervalMs).unref?.()
  }

  private reapStaleTasks() {
    const reason = "进程重启导致中断"
    const shouldInterrupt = (kind: TaskKind, id: string) => !this.tasks.has(id) && !this.db.getTaskLease(kind, id)

    for (const agent of this.db.listAllAgentSessions()) {
      if (shouldInterrupt("agent", agent.id) && (agent.status === "running" || agent.status === "paused" || agent.status === "cancelling")) {
        agent.status = "interrupted"
        agent.error = agent.error || reason
        agent.finishedAt = agent.finishedAt || now()
        agent.pausedAt = undefined
        this.db.upsertAgentSession(agent)
      }
    }

    for (const run of this.db.listAllRuns()) {
      if (shouldInterrupt("run", run.id) && (run.status === "running" || run.status === "paused" || run.status === "cancelling" || run.status === "awaiting_human" || run.status === "queued")) {
        run.status = "interrupted"
        run.finishedAt = run.finishedAt || now()
        run.pendingHumanHandoff = undefined
        run.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
        this.db.upsertRun(run)
      }
    }

    for (const taskRun of this.db.listAllTaskRuns()) {
      if (shouldInterrupt("task-run", taskRun.id) && (taskRun.status === "running" || taskRun.status === "paused" || taskRun.status === "cancelling" || taskRun.status === "queued")) {
        taskRun.status = "interrupted"
        taskRun.finishedAt = taskRun.finishedAt || now()
        taskRun.logs.push(`[${new Date().toLocaleTimeString()}] ${reason}`)
        this.db.upsertTaskRun(taskRun)
      }
    }

    for (const recorder of this.db.listAllRecorderSessions()) {
      if (shouldInterrupt("recorder", recorder.id) && (recorder.status === "running" || recorder.status === "paused" || recorder.status === "cancelling" || recorder.status === "starting" || recorder.status === "stopping")) {
        recorder.status = "interrupted"
        recorder.finishedAt = recorder.finishedAt || now()
        recorder.error = recorder.error || reason
        this.db.upsertRecorderSession(recorder)
      }
    }
  }

  private getTaskStatus(kind: TaskKind, taskId: string) {
    switch (kind) {
      case "run":
        return this.db.getRun(taskId)?.status
      case "task-run":
        return this.db.getTaskRun(taskId)?.status
      case "agent":
        return this.db.getAgentSession(taskId)?.status
      case "recorder":
        return this.db.getRecorderSession(taskId)?.status
      default:
        return undefined
    }
  }

  private isTerminalTaskStatus(kind: TaskKind, status: string | undefined) {
    if (!status) return false
    switch (kind) {
      case "run":
      case "task-run":
        return status === "passed" || status === "failed" || status === "cancelled" || status === "interrupted"
      case "agent":
        return status === "completed" || status === "cancelled" || status === "error" || status === "interrupted"
      case "recorder":
        return status === "completed" || status === "cancelled" || status === "error" || status === "interrupted"
      default:
        return false
    }
  }

  private recordTaskControlCommand(kind: TaskKind, taskId: string, action: TaskControlAction) {
    const commandId = createId("task_ctrl")
    const taskStatus = this.getTaskStatus(kind, taskId)
    const lease = this.db.getTaskLease(kind, taskId)

    if (!taskStatus) {
      this.db.createTaskControlCommand({
        id: commandId,
        taskKind: kind,
        taskId,
        action,
        status: "rejected",
        requestedAt: now(),
        resolvedAt: now(),
        note: "Task not found.",
      })
      return false
    }

    if (this.isTerminalTaskStatus(kind, taskStatus)) {
      this.db.createTaskControlCommand({
        id: commandId,
        taskKind: kind,
        taskId,
        action,
        status: "rejected",
        requestedAt: now(),
        resolvedAt: now(),
        note: `Task already finished with status ${taskStatus}.`,
      })
      return false
    }

    if (!lease || (lease.status !== "active" && lease.status !== "recovering")) {
      this.db.createTaskControlCommand({
        id: commandId,
        taskKind: kind,
        taskId,
        action,
        status: "rejected",
        requestedAt: now(),
        resolvedAt: now(),
        note: "Task lease unavailable for command dispatch.",
      })
      return false
    }

    this.db.createTaskControlCommand({
      id: commandId,
      taskKind: kind,
      taskId,
      action,
      status: "requested",
      requestedAt: now(),
    })
    this.tasks.poke(kind, taskId)
    return true
  }

  private async recoverExpiredTasks() {
    const expiredLeases = this.db.listExpiredActiveTaskLeases()
    if (expiredLeases.length === 0) {
      return
    }

    const activeAgentRunIds = new Set(
      this.db.listAllAgentSessions()
        .filter((session) => session.status === "running" || session.status === "paused" || session.status === "cancelling")
        .flatMap((session) => [session.latestRunId, session.warmupRunId].filter((value): value is string => Boolean(value))),
    )

    for (const lease of expiredLeases.filter((item) => item.taskKind === "task-run")) {
      try {
        await this.taskRunService.recoverTaskRun(lease.taskId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const taskRun = this.db.getTaskRun(lease.taskId)
        if (taskRun && taskRun.status !== "passed" && taskRun.status !== "failed" && taskRun.status !== "cancelled" && taskRun.status !== "interrupted") {
          taskRun.status = "interrupted"
          taskRun.finishedAt = taskRun.finishedAt || now()
          taskRun.logs.push(`[${new Date().toLocaleTimeString()}] 任务恢复失败: ${message}`)
          this.db.upsertTaskRun(taskRun)
        }
        this.db.finalizeTaskLease({ taskKind: "task-run", taskId: lease.taskId, status: "terminated", lastError: message })
      }
    }

    for (const lease of expiredLeases.filter((item) => item.taskKind === "agent")) {
      const session = this.db.getAgentSession(lease.taskId)
      if (!session || session.taskRunId) continue
      try {
        await this.agentService.recoverAgent(lease.taskId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (session.status !== "completed" && session.status !== "cancelled" && session.status !== "error" && session.status !== "interrupted") {
          session.status = "interrupted"
          session.error = message
          session.finishedAt = session.finishedAt || now()
          session.pausedAt = undefined
          this.db.upsertAgentSession(session)
        }
        this.db.finalizeTaskLease({ taskKind: "agent", taskId: lease.taskId, status: "terminated", lastError: message })
      }
    }

    for (const lease of expiredLeases.filter((item) => item.taskKind === "run")) {
      const run = this.db.getRun(lease.taskId)
      if (!run || activeAgentRunIds.has(run.id) || run.taskRunId) continue
      try {
        await this.runService.recoverRun(lease.taskId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (run.status !== "passed" && run.status !== "failed" && run.status !== "cancelled" && run.status !== "interrupted") {
          run.status = "interrupted"
          run.finishedAt = run.finishedAt || now()
          run.pendingHumanHandoff = undefined
          run.logs.push(`[${new Date().toLocaleTimeString()}] 运行恢复失败: ${message}`)
          this.db.upsertRun(run)
        }
        this.db.finalizeTaskLease({ taskKind: "run", taskId: lease.taskId, status: "terminated", lastError: message })
      }
    }

    for (const lease of expiredLeases.filter((item) => item.taskKind === "recorder")) {
      const recorder = this.db.getRecorderSession(lease.taskId)
      if (!recorder) continue
      recorder.status = "interrupted"
      recorder.finishedAt = recorder.finishedAt || now()
      recorder.error = recorder.error || "Recorder session cannot be resumed after executor restart."
      this.db.upsertRecorderSession(recorder)
      this.db.finalizeTaskLease({
        taskKind: "recorder",
        taskId: lease.taskId,
        status: "terminated",
        lastError: recorder.error,
      })
    }
  }

  private async recordTaskControlCommandAsync(kind: TaskKind, taskId: string, action: TaskControlAction) {
    return this.recordTaskControlCommand(kind, taskId, action)
  }

  private isActiveRunStatus(status: string) {
    return status === "running" || status === "paused" || status === "cancelling" || status === "awaiting_human" || status === "queued"
  }

  private isActiveTaskRunStatus(status: string) {
    return status === "running" || status === "paused" || status === "cancelling" || status === "queued"
  }

  private isActiveAgentStatus(status: string) {
    return status === "running" || status === "paused" || status === "cancelling"
  }

  private isActiveRecorderStatus(status: string) {
    return status === "running" || status === "paused" || status === "cancelling" || status === "starting" || status === "stopping"
  }

  getReadinessSnapshot() {
    const ready = this.recoveryStatus === "succeeded" && Boolean(this.schedulerStartedAt)
    return {
      ready,
      startedAt: this.startedAt,
      recoveryStatus: this.recoveryStatus,
      recoveryCompletedAt: this.recoveryCompletedAt,
      recoveryError: this.recoveryError,
      schedulerStartedAt: this.schedulerStartedAt,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
  }

  getMetricsSnapshot() {
    const readiness = this.getReadinessSnapshot()
    const runs = this.db.listAllRuns()
    const taskRuns = this.db.listAllTaskRuns()
    const agents = this.db.listAllAgentSessions()
    const recorders = this.db.listAllRecorderSessions()
    const leases = this.db.listTaskLeases()

    return {
      ready: readiness.ready ? 1 : 0,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      uptimeSeconds: Math.floor((Date.now() - Date.parse(this.startedAt)) / 1000),
      projectsTotal: this.db.listProjects().length,
      activeRuns: runs.filter((item) => this.isActiveRunStatus(item.status)).length,
      activeTaskRuns: taskRuns.filter((item) => this.isActiveTaskRunStatus(item.status)).length,
      activeAgents: agents.filter((item) => this.isActiveAgentStatus(item.status)).length,
      activeRecorders: recorders.filter((item) => this.isActiveRecorderStatus(item.status)).length,
      activeLeases: leases.filter((item) => item.status === "active").length,
      recoveringLeases: leases.filter((item) => item.status === "recovering").length,
      expiredActiveLeases: this.db.listExpiredActiveTaskLeases().length,
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

  /**
   * 导入外部采集的登录态：把用户在自己真浏览器里采集到的 storageState 写入
   * (profile, targetUrl) 行。绕开服务端沙盒——对淘宝详情页这类「IP 即原罪」的强风控
   * 站点，本机采集是唯一可靠路径。写入后业务回放沿用现成 storageState 注入逻辑。
   */
  async importAuthProfileState(
    profileId: string,
    input: { projectId: string; targetUrlId?: string; storageStateJson: string; postLoginUrl?: string },
  ) {
    const profile = this.db.getAuthProfile(profileId)
    if (!profile) throw new Error("Auth profile not found")
    if (profile.projectId !== input.projectId) {
      throw new Error("登录态配置不属于该项目，请刷新页面后重试。")
    }
    const resolved = this.db.resolveTargetUrl(input.projectId, input.targetUrlId)
    if (!resolved?.id) {
      throw new Error("无法解析目标 URL：请先在项目设置中配置主域名或选择有效的 TargetUrl。")
    }

    let parsed: { cookies?: unknown[]; origins?: unknown[] }
    try {
      parsed = JSON.parse(input.storageStateJson)
    } catch {
      throw new Error("storageStateJson 不是合法的 JSON。")
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cookies)) {
      throw new Error("storageState 缺少 cookies 数组：请确认导出的是 Playwright 兼容格式。")
    }
    if (parsed.cookies.length === 0 && (!Array.isArray(parsed.origins) || parsed.origins.length === 0)) {
      throw new Error("storageState 为空（没有任何 cookie / localStorage），请在已登录的页面重新采集。")
    }

    const postLoginUrl = input.postLoginUrl?.trim()
    return this.db.upsertAuthProfileState(
      profileId,
      resolved.id,
      input.storageStateJson,
      postLoginUrl ? postLoginUrl : null,
    )
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
      needsStealth: input.needsStealth,
    })
  }
  async updateTargetUrl(id: string, patch: { label?: string; url?: string; needsStealth?: boolean }) {
    const cleaned: { label?: string; url?: string; needsStealth?: boolean } = {}
    if (patch.label !== undefined) cleaned.label = patch.label.trim()
    if (patch.url !== undefined) cleaned.url = patch.url.trim()
    if (patch.needsStealth !== undefined) cleaned.needsStealth = patch.needsStealth
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
  getOutbox(limit = 60) { return buildOutboxItems(this.db.listAllRuns(), limit) }
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
  async startTaskRun(request: StartTaskRunRequest) { return this.taskRunService.startTaskRun(request) }
  subscribeTaskRun(taskRunId: string, listener: (taskRun: TaskRun) => void) { return this.taskRunService.subscribeTaskRun(taskRunId, listener) }
  async getRun(runId: string) { return this.runStateService.getRun(runId) }
  buildRepairPrompt(testCase: TestCase, run: ExecutionRun, originalPrompt: string) { return this.runService.buildRepairPrompt(testCase, run, originalPrompt) }
  async submitRunHumanInput(runId: string, handoffId: string, value: string) { return this.runStateService.submitRunHumanInput(runId, handoffId, value) }
  subscribe(runId: string, listener: (run: ExecutionRun) => void) { return this.runStateService.subscribe(runId, listener) }
  subscribeLiveViewport(runId: string, listener: (chunk: Uint8Array) => void) { return this.runStateService.subscribeLiveViewport(runId, listener) }
  pauseRun(runId: string) { return this.recordTaskControlCommand("run", runId, "pause") }
  resumeRun(runId: string) { return this.recordTaskControlCommand("run", runId, "resume") }
  cancelRun(runId: string) { return this.recordTaskControlCommand("run", runId, "cancel") }
  pauseTaskRun(taskRunId: string) { return this.recordTaskControlCommand("task-run", taskRunId, "pause") }
  resumeTaskRun(taskRunId: string) { return this.recordTaskControlCommand("task-run", taskRunId, "resume") }
  cancelTaskRun(taskRunId: string) { return this.recordTaskControlCommand("task-run", taskRunId, "cancel") }

  // -- Agent control --
  pauseAgent(sessionId: string) { return this.recordTaskControlCommand("agent", sessionId, "pause") }
  resumeAgent(sessionId: string) { return this.recordTaskControlCommand("agent", sessionId, "resume") }
  cancelAgent(sessionId: string) { return this.recordTaskControlCommand("agent", sessionId, "cancel") }

  // -- Recorder control --
  pauseRecorder(sessionId: string) { return this.recordTaskControlCommand("recorder", sessionId, "pause") }
  resumeRecorder(sessionId: string) { return this.recordTaskControlCommand("recorder", sessionId, "resume") }
  async cancelRecorder(sessionId: string) { return this.recordTaskControlCommandAsync("recorder", sessionId, "cancel") }
  listTaskControlCommands(input: { projectId?: string; taskKind?: TaskKind; taskId?: string; status?: PersistedTaskControlCommand["status"]; limit?: number }) {
    return this.db.listTaskControlCommands(input)
  }

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
