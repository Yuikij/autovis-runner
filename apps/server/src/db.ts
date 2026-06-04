import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import { authEnabled, hashPassword, sessionExpiresAt, verifyPassword, type AuthUser } from "./auth.js"
import type { CopilotSecretState } from "./copilot.js"
import { bootstrapDatabase } from "./db/bootstrap.js"
import {
  clearAgentSession,
  clearRecorderSession,
  clearRuns,
  deleteRunById,
  deleteGitAuthProfile,
  deleteModule,
  deleteProject,
  deleteScript,
  deleteTestCase,
  deleteTask,
  getAgentSession,
  getGitAuthProfile,
  getLlmState,
  getLlmConfigState,
  getProject,
  getProjectWorkspace,
  getRecorderSession,
  getRun,
  getScript,
  getTaskRun,
  getTestCase,
  getTask,
  insertScript,
  listActiveAgentSessionsForProject,
  listActiveRecorderSessionsForProject,
  listActiveRunsForProject,
  listActiveTaskRunsForProject,
  listAgentSessions,
  listAllAgentSessions,
  listAllRecorderSessions,
  listAllRuns,
  listAllTaskRuns,
  listDependentTestCasesForCase,
  listGitAuthProfiles,
  listModules,
  listProjects,
  listRecorderSessions,
  listRuns,
  listScriptsForTestCase,
  listTaskRuns,
  listTaskRunsForTask,
  listTestCases,
  listTasks,
  replaceAgentSteps,
  saveLlmState,
  saveLlmConfigState,
  updateTestCaseVerification,
  updateTaskLastRun,
  upsertAgentSession,
  upsertGitAuthProfile,
  upsertModule,
  upsertProject,
  upsertProjectWorkspace,
  upsertRecorderSession,
  upsertRun,
  upsertTaskRun,
  upsertTestCase,
  upsertTask,
  AuthProfileRepository,
  TargetUrlRepository,
  listScheduleTriggers,
  listScheduleTriggersForTask,
  listAllScheduleTriggers,
  getScheduleTrigger,
  upsertScheduleTrigger,
  deleteScheduleTrigger,
  updateScheduleTriggerFiredAt,
  updateScheduleTriggerNextFireAt,
  setScheduleTriggerEnabled,
  countUsers,
  createUserSession,
  deleteExpiredUserSessions,
  deleteUserSession,
  findUserBySessionToken,
  findUserByUsername,
  upsertUser,
  getLlmConfigStateForOwner,
  saveLlmConfigStateForOwner,
  upsertValidationTask,
  getValidationTask as getValidationTaskRepo,
  listActiveValidationTasks,
  deleteValidationTask,
} from "./db/repositories.js"
import type { PersistedLlmState } from "./db/shared.js"
import { createSchema } from "./db/schema.js"
import type {
  AgentSession,
  AuthProfile,
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
  TaskRun,
  TestCase,
  UpsertGitAuthProfileRequest,
  UpsertModuleRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertScheduleTriggerRequest,
  UpsertTestCaseRequest,
  UpsertTaskRequest,
  UpsertAuthProfileRequest,
  ValidationTask,
} from "@autovis/shared"

export class AutoVisDatabase {
  private readonly db: DatabaseSync
  private readonly stateFile: string

  private readonly authProfilesRepo: AuthProfileRepository
  private readonly targetUrlsRepo: TargetUrlRepository

  constructor(private readonly dataDir: string, appOrigin: string) {
    mkdirSync(dataDir, { recursive: true })
    this.stateFile = join(dataDir, "state.json")
    this.db = new DatabaseSync(join(dataDir, "autovis.db"))
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    createSchema(this.db)
    bootstrapDatabase(this.db, this.stateFile, appOrigin)
    this.ensureConfiguredUsers()
    this.authProfilesRepo = new AuthProfileRepository(this.db)
    this.targetUrlsRepo = new TargetUrlRepository(this.db)

    // Clean up dangling validation tasks that were running before restart
    const activeTasks = listActiveValidationTasks(this.db)
    for (const task of activeTasks) {
      task.status = "error"
      task.error = "Validation task aborted due to server restart."
      upsertValidationTask(this.db, task)
    }
  }

  private ensureConfiguredUsers() {
    if (!authEnabled) return
    const nowTime = new Date().toISOString()
    const users: Array<{ username: string; password: string; role: AuthUser["role"] }> = []
    const adminUser = process.env.AUTOVIS_ADMIN_USER?.trim() || "admin"
    const adminPassword = process.env.AUTOVIS_ADMIN_PASSWORD?.trim()
    if (adminPassword) {
      users.push({ username: adminUser, password: adminPassword, role: "admin" })
    }

    for (const entry of (process.env.AUTOVIS_USERS ?? "").split(",")) {
      const [username, password, role] = entry.split(":").map((part) => part?.trim())
      if (!username || !password) continue
      users.push({ username, password, role: role === "admin" ? "admin" : "user" })
    }

    if (users.length === 0 && countUsers(this.db) === 0) {
      throw new Error("AUTOVIS_AUTH_ENABLED=true requires AUTOVIS_ADMIN_PASSWORD or AUTOVIS_USERS")
    }

    for (const user of users) {
      upsertUser(this.db, {
        id: `user_${Buffer.from(user.username).toString("hex").slice(0, 24)}`,
        username: user.username,
        passwordHash: hashPassword(user.password),
        role: user.role,
        now: nowTime,
      })
    }
  }

  listProjects(): Project[] {
    return listProjects(this.db)
  }

  getProject(projectId: string): Project | undefined {
    return getProject(this.db, projectId)
  }

  getProjectWorkspace(projectId: string): ProjectWorkspace | undefined {
    return getProjectWorkspace(this.db, projectId)
  }

  listAuthProfiles(projectId: string): AuthProfile[] {
    return this.authProfilesRepo.listByProjectId(projectId)
  }

  getAuthProfile(profileId: string): AuthProfile | undefined {
    return this.authProfilesRepo.getById(profileId) ?? undefined
  }

  upsertAuthProfile(input: AuthProfile): AuthProfile {
    return this.authProfilesRepo.upsert(input)
  }

  listAuthProfileStates(profileId: string): AuthProfileState[] {
    return this.authProfilesRepo.listStates(profileId)
  }

  getAuthProfileState(profileId: string, targetUrlId: string): AuthProfileState | undefined {
    return this.authProfilesRepo.getState(profileId, targetUrlId) ?? undefined
  }

  upsertAuthProfileState(
    profileId: string,
    targetUrlId: string,
    storageStateJson: string | null,
    postLoginUrlAuto: string | null = null,
  ) {
    return this.authProfilesRepo.upsertState(profileId, targetUrlId, storageStateJson, postLoginUrlAuto)
  }

  setAuthProfileStatePostLoginUrlOverride(profileId: string, targetUrlId: string, overrideUrl: string | null) {
    return this.authProfilesRepo.setStatePostLoginUrlOverride(profileId, targetUrlId, overrideUrl)
  }

  deleteAuthProfileState(profileId: string, targetUrlId: string) {
    this.authProfilesRepo.deleteState(profileId, targetUrlId)
  }

  updateAuthProfileValidationScript(id: string, code: string) {
    this.authProfilesRepo.updateValidationScript(id, code)
  }

  deleteAuthProfile(id: string) {
    this.authProfilesRepo.delete(id)
  }

  // -- Validation Tasks --

  upsertValidationTask(task: ValidationTask) {
    upsertValidationTask(this.db, task)
  }

  getValidationTask(id: string): ValidationTask | undefined {
    return getValidationTaskRepo(this.db, id)
  }

  listActiveValidationTasks(): ValidationTask[] {
    return listActiveValidationTasks(this.db)
  }

  deleteValidationTask(id: string) {
    deleteValidationTask(this.db, id)
  }

  // -- TargetUrl --

  listTargetUrls(projectId: string): TargetUrl[] {
    return this.targetUrlsRepo.listByProject(projectId)
  }

  getTargetUrl(id: string): TargetUrl | undefined {
    return this.targetUrlsRepo.getById(id) ?? undefined
  }

  findTargetUrlByUrl(projectId: string, url: string): TargetUrl | undefined {
    return this.targetUrlsRepo.findByUrl(projectId, url) ?? undefined
  }

  createTargetUrl(input: { id: string; projectId: string; label: string; url: string }): TargetUrl {
    return this.targetUrlsRepo.create(input)
  }

  updateTargetUrl(id: string, patch: { label?: string; url?: string }): TargetUrl {
    return this.targetUrlsRepo.update(id, patch)
  }

  deleteTargetUrl(id: string): void {
    this.targetUrlsRepo.delete(id)
  }

  /**
   * 解析 targetUrlId 到 URL：
   *  - 给了 targetUrlId 但 target_urls 表里查不到 → 返回 null（不再静默回落到 project.testBaseUrl，
   *    防止"用户选了某 URL，结果跑到主域名"这种 bug）。
   *  - 没给 targetUrlId → 回落到项目主域名（用于历史上没要求显式选 URL 的少量入口；新功能应显式给）。
   */
  resolveTargetUrl(projectId: string, targetUrlId: string | undefined | null): { id?: string; url: string } | null {
    if (targetUrlId) {
      const row = this.getTargetUrl(targetUrlId)
      if (!row) return null
      return { id: row.id, url: row.url }
    }
    const project = this.getProject(projectId)
    if (!project) return null
    const fallback = project.testBaseUrl?.trim()
    if (!fallback) return null
    const primary = project.targetUrls.find((t) => t.isPrimary && t.url === fallback)
    return { id: primary?.id, url: fallback }
  }

  listGitAuthProfiles(): GitAuthProfile[] {
    return listGitAuthProfiles(this.db)
  }

  getGitAuthProfile(profileId: string): GitAuthProfile | undefined {
    return getGitAuthProfile(this.db, profileId)
  }

  listDependentTestCasesForCase(testCaseId: string): TestCase[] {
    return listDependentTestCasesForCase(this.db, testCaseId)
  }

  listTestCases(projectId: string): TestCase[] {
    return listTestCases(this.db, projectId)
  }

  listAllTestCases(): TestCase[] {
    return listTestCases(this.db)
  }

  getTestCase(testCaseId: string): TestCase | undefined {
    return getTestCase(this.db, testCaseId)
  }

  // -- Tasks --

  listTasks(projectId: string): Task[] {
    return listTasks(this.db, projectId)
  }

  getTask(taskId: string): Task | undefined {
    return getTask(this.db, taskId)
  }

  upsertTask(input: UpsertTaskRequest & { id: string }) {
    return upsertTask(this.db, input)
  }

  deleteTask(taskId: string) {
    deleteTask(this.db, taskId)
  }

  updateTaskLastRun(input: { taskId: string; lastRunId?: string; lastStatus?: TaskRun["status"]; lastRunAt?: string }) {
    updateTaskLastRun(this.db, input)
  }

  listScriptsForTestCase(testCaseId: string): ScriptArtifact[] {
    return listScriptsForTestCase(this.db, testCaseId)
  }

  getScript(scriptId: string): ScriptArtifact | undefined {
    return getScript(this.db, scriptId)
  }

  listRuns(projectId: string): ExecutionRun[] {
    return listRuns(this.db, projectId)
  }

  listTaskRuns(projectId: string): TaskRun[] {
    return listTaskRuns(this.db, projectId)
  }

  listTaskRunsForTask(taskId: string): TaskRun[] {
    return listTaskRunsForTask(this.db, taskId)
  }

  getTaskRun(taskRunId: string): TaskRun | undefined {
    return getTaskRun(this.db, taskRunId)
  }

  getRun(runId: string): ExecutionRun | undefined {
    return getRun(this.db, runId)
  }

  listRecorderSessions(projectId: string): RecorderSession[] {
    return listRecorderSessions(this.db, projectId)
  }

  getRecorderSession(sessionId: string): RecorderSession | undefined {
    return getRecorderSession(this.db, sessionId)
  }

  listAgentSessions(projectId: string): AgentSession[] {
    return listAgentSessions(this.db, projectId)
  }

  listAllAgentSessions(): AgentSession[] {
    return listAllAgentSessions(this.db)
  }

  listActiveAgentSessionsForProject(projectId: string): AgentSession[] {
    return listActiveAgentSessionsForProject(this.db, projectId)
  }

  listAllRuns(): ExecutionRun[] {
    return listAllRuns(this.db)
  }

  listActiveRunsForProject(projectId: string): ExecutionRun[] {
    return listActiveRunsForProject(this.db, projectId)
  }

  listAllTaskRuns(): TaskRun[] {
    return listAllTaskRuns(this.db)
  }

  listActiveTaskRunsForProject(projectId: string): TaskRun[] {
    return listActiveTaskRunsForProject(this.db, projectId)
  }

  listAllRecorderSessions(): RecorderSession[] {
    return listAllRecorderSessions(this.db)
  }

  listActiveRecorderSessionsForProject(projectId: string): RecorderSession[] {
    return listActiveRecorderSessionsForProject(this.db, projectId)
  }

  getAgentSession(sessionId: string): AgentSession | undefined {
    return getAgentSession(this.db, sessionId)
  }

  getLlmState(): { session: LlmSessionConfig; secrets: CopilotSecretState } {
    return getLlmState(this.db)
  }

  getLlmConfigState(): PersistedLlmState {
    return getLlmConfigState(this.db)
  }

  getLlmConfigStateForOwner(ownerKey: string): PersistedLlmState {
    return getLlmConfigStateForOwner(this.db, ownerKey)
  }

  saveLlmState(session: LlmSessionConfig, secrets: CopilotSecretState) {
    saveLlmState(this.db, session, secrets)
  }

  saveLlmConfigState(state: PersistedLlmState) {
    saveLlmConfigState(this.db, state)
  }

  saveLlmConfigStateForOwner(ownerKey: string, state: PersistedLlmState) {
    saveLlmConfigStateForOwner(this.db, state, ownerKey)
  }

  resolveUserBySessionToken(token: string | undefined): AuthUser | null {
    if (!token) return null
    return findUserBySessionToken(this.db, token, new Date().toISOString()) ?? null
  }

  login(username: string, password: string): { user: AuthUser; token: string } | null {
    const row = findUserByUsername(this.db, username.trim())
    if (!row || !verifyPassword(password, row.password_hash)) return null
    const token = randomBytes(32).toString("base64url")
    const nowTime = new Date().toISOString()
    createUserSession(this.db, {
      token,
      userId: row.id,
      expiresAt: sessionExpiresAt(),
      now: nowTime,
    })
    deleteExpiredUserSessions(this.db, nowTime)
    return {
      user: { id: row.id, username: row.username, role: row.role === "admin" ? "admin" : "user" },
      token,
    }
  }

  logoutToken(token: string | undefined) {
    if (token) deleteUserSession(this.db, token)
  }

  insertScript(script: ScriptArtifact) {
    insertScript(this.db, script)
  }

  deleteScript(scriptId: string) {
    deleteScript(this.db, scriptId)
  }

  upsertAgentSession(session: AgentSession) {
    upsertAgentSession(this.db, session)
  }

  replaceAgentSteps(sessionId: string, steps: AgentSession["steps"]) {
    replaceAgentSteps(this.db, sessionId, steps)
  }

  clearAgentSession(sessionId: string) {
    clearAgentSession(this.db, sessionId)
  }

  updateTestCaseVerification(input: { testCaseId: string; runId?: string; status?: TestCase["lastVerifiedStatus"]; verifiedAt?: string }) {
    updateTestCaseVerification(this.db, input)
  }

  upsertProject(input: UpsertProjectRequest & { id: string }) {
    return upsertProject(this.db, input)
  }

  upsertProjectWorkspace(projectId: string, managedRoot: string, input: UpsertProjectWorkspaceRequest, overrides?: Partial<Pick<ProjectWorkspace, "status" | "lastSyncedAt" | "lastError" | "lastCommitSha">>) {
    return upsertProjectWorkspace(this.db, projectId, managedRoot, input, overrides)
  }

  upsertGitAuthProfile(input: UpsertGitAuthProfileRequest & { id: string }) {
    return upsertGitAuthProfile(this.db, input)
  }

  deleteGitAuthProfile(profileId: string) {
    deleteGitAuthProfile(this.db, profileId)
  }

  deleteProject(projectId: string) {
    deleteProject(this.db, projectId)
  }

  clearRuns(projectId: string) {
    clearRuns(this.db, projectId)
  }

  deleteRun(runId: string) {
    deleteRunById(this.db, runId)
  }

  upsertTestCase(input: UpsertTestCaseRequest & { id: string }) {
    return upsertTestCase(this.db, input)
  }

  deleteTestCase(testCaseId: string) {
    deleteTestCase(this.db, testCaseId)
  }

  upsertRun(run: ExecutionRun) {
    upsertRun(this.db, run)
  }

  upsertTaskRun(taskRun: TaskRun) {
    upsertTaskRun(this.db, taskRun)
  }

  upsertRecorderSession(session: RecorderSession) {
    upsertRecorderSession(this.db, session)
  }

  clearRecorderSession(sessionId: string) {
    clearRecorderSession(this.db, sessionId)
  }

  listModules(projectId: string): Module[] {
    return listModules(this.db, projectId)
  }

  upsertModule(input: UpsertModuleRequest & { id: string }) {
    return upsertModule(this.db, input)
  }

  deleteModule(moduleId: string) {
    deleteModule(this.db, moduleId)
  }

  // -- ScheduleTriggers --

  listScheduleTriggers(projectId: string): ScheduleTrigger[] {
    return listScheduleTriggers(this.db, projectId)
  }

  listScheduleTriggersForTask(taskId: string): ScheduleTrigger[] {
    return listScheduleTriggersForTask(this.db, taskId)
  }

  listAllScheduleTriggers(): ScheduleTrigger[] {
    return listAllScheduleTriggers(this.db)
  }

  getScheduleTrigger(id: string): ScheduleTrigger | undefined {
    return getScheduleTrigger(this.db, id)
  }

  upsertScheduleTrigger(input: UpsertScheduleTriggerRequest & { id: string }) {
    return upsertScheduleTrigger(this.db, input)
  }

  deleteScheduleTrigger(id: string) {
    deleteScheduleTrigger(this.db, id)
  }

  updateScheduleTriggerFiredAt(id: string, lastFiredAt: string, nextFireAt: string | null) {
    updateScheduleTriggerFiredAt(this.db, id, lastFiredAt, nextFireAt)
  }

  updateScheduleTriggerNextFireAt(id: string, nextFireAt: string | null) {
    updateScheduleTriggerNextFireAt(this.db, id, nextFireAt)
  }

  setScheduleTriggerEnabled(id: string, enabled: boolean) {
    setScheduleTriggerEnabled(this.db, id, enabled)
  }

}
