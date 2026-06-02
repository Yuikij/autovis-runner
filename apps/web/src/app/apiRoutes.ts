import { apiBase } from "./constants"

const enc = encodeURIComponent

const qs = (params?: Record<string, string | number | boolean | null | undefined>) => {
  if (!params) return ""
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const str = String(value)
    if (str === "") continue
    sp.set(key, str)
  }
  const text = sp.toString()
  return text ? `?${text}` : ""
}

const api = (path: string) => `/api${path}`

const project = (projectId: string) => `/projects/${enc(projectId)}`
const taskPath = (taskId: string) => `/tasks/${enc(taskId)}`
const testCase = (testCaseId: string) => `/test-cases/${enc(testCaseId)}`
const run = (runId: string) => `/runs/${enc(runId)}`
const taskRun = (taskRunId: string) => `/task-runs/${enc(taskRunId)}`
const recorder = (sessionId: string) => `/recorder-sessions/${enc(sessionId)}`
const agent = (sessionId: string) => `/agent/${enc(sessionId)}`
const llmConfig = (configId: string) => `/llm/configs/${enc(configId)}`
const authProfile = (profileId: string) => `/auth-profiles/${enc(profileId)}`
const gitAuthProfile = (profileId: string) => `/git-auth-profiles/${enc(profileId)}`
const moduleId = (id: string) => `/modules/${enc(id)}`

export const apiRoutes = {
  health: () => "/health",

  auth: {
    session: () => api("/auth/session"),
    login: () => api("/auth/login"),
    logout: () => api("/auth/logout"),
  },

  dashboard: () => api("/dashboard"),

  projects: {
    list: () => api("/projects"),
    create: () => api("/projects"),
    detail: (projectId: string) => api(project(projectId)),
    remove: (projectId: string) => api(project(projectId)),
    runs: (projectId: string) => api(`${project(projectId)}/runs`),
    taskRuns: (projectId: string) => api(`${project(projectId)}/task-runs`),
    recorderSessions: (projectId: string) => api(`${project(projectId)}/recorder-sessions`),
    modules: (projectId: string) => api(`${project(projectId)}/modules`),
    testCases: (projectId: string) => api(`${project(projectId)}/test-cases`),
    tasks: (projectId: string) => api(`${project(projectId)}/tasks`),
    activeTasks: (projectId: string) => api(`${project(projectId)}/active-tasks`),
    authProfiles: (projectId: string) => api(`${project(projectId)}/auth-profiles`),
    targetUrls: (projectId: string) => api(`${project(projectId)}/target-urls`),
    workspace: (projectId: string) => api(`${project(projectId)}/workspace`),
    workspaceImportLocal: (projectId: string) => api(`${project(projectId)}/workspace/import-local`),
    workspaceSync: (projectId: string) => api(`${project(projectId)}/workspace/sync`),
    workspaceUpload: (projectId: string) => api(`${project(projectId)}/workspace/upload`),
    workspaceSearch: (projectId: string) => api(`${project(projectId)}/workspace/search`),
    workspaceTree: (projectId: string, path?: string) =>
      api(`${project(projectId)}/workspace/tree${qs({ path })}`),
    workspaceGlob: (projectId: string, pattern?: string) =>
      api(`${project(projectId)}/workspace/glob${qs({ pattern })}`),
    workspaceFile: (projectId: string, path: string) =>
      api(`${project(projectId)}/workspace/file${qs({ path })}`),
  },

  tasks: {
    listForProject: (projectId: string) => api(`/tasks${qs({ projectId })}`),
    create: () => api("/tasks"),
    detail: (taskId: string) => api(taskPath(taskId)),
    remove: (taskId: string) => api(taskPath(taskId)),
    runs: (taskId: string) => api(`${taskPath(taskId)}/runs`),
    run: (taskId: string) => api(`${taskPath(taskId)}/run`),
    scheduleTriggers: (taskId: string) => api(`${taskPath(taskId)}/schedule-triggers`),
  },

  testCases: {
    listAll: () => api("/test-cases"),
    listForProject: (projectId: string) => api(`/test-cases${qs({ projectId })}`),
    create: () => api("/test-cases"),
    remove: (testCaseId: string) => api(testCase(testCaseId)),
    scripts: (testCaseId: string) => api(`${testCase(testCaseId)}/scripts`),
    createScriptVersion: (testCaseId: string) => api(`${testCase(testCaseId)}/scripts`),
    script: (testCaseId: string, scriptId: string) =>
      api(`${testCase(testCaseId)}/scripts/${enc(scriptId)}`),
  },

  scripts: {
    generate: () => api("/scripts/generate"),
    directExecute: () => api("/scripts/direct-execute"),
  },

  runs: {
    create: () => api("/runs"),
    detail: (runId: string) => api(run(runId)),
    stream: (runId: string) => api(`${run(runId)}/stream`),
    live: (runId: string) => api(`${run(runId)}/live`),
    repair: (runId: string) => api(`${run(runId)}/repair`),
    humanInput: (runId: string) => api(`${run(runId)}/human-input`),
    pause: (runId: string) => api(`${run(runId)}/pause`),
    resume: (runId: string) => api(`${run(runId)}/resume`),
    cancel: (runId: string) => api(`${run(runId)}/cancel`),
  },

  taskRuns: {
    detail: (taskRunId: string) => api(taskRun(taskRunId)),
    stream: (taskRunId: string) => api(`${taskRun(taskRunId)}/stream`),
    pause: (taskRunId: string) => api(`${taskRun(taskRunId)}/pause`),
    resume: (taskRunId: string) => api(`${taskRun(taskRunId)}/resume`),
    cancel: (taskRunId: string) => api(`${taskRun(taskRunId)}/cancel`),
  },

  verifications: {
    create: () => api("/verifications"),
  },

  recorderSessions: {
    create: () => api("/recorder-sessions"),
    detail: (sessionId: string) => api(recorder(sessionId)),
    stream: (sessionId: string) => api(`${recorder(sessionId)}/stream`),
    interactions: (sessionId: string) => api(`${recorder(sessionId)}/interactions`),
    stop: (sessionId: string) => api(`${recorder(sessionId)}/stop`),
    pause: (sessionId: string) => api(`${recorder(sessionId)}/pause`),
    resume: (sessionId: string) => api(`${recorder(sessionId)}/resume`),
    cancel: (sessionId: string) => api(`${recorder(sessionId)}/cancel`),
  },

  agent: {
    detail: (sessionId: string) => api(agent(sessionId)),
    stream: (sessionId: string) => api(`${agent(sessionId)}/stream`),
    pause: (sessionId: string) => api(`${agent(sessionId)}/pause`),
    resume: (sessionId: string) => api(`${agent(sessionId)}/resume`),
    cancel: (sessionId: string) => api(`${agent(sessionId)}/cancel`),
  },

  llm: {
    state: () => api("/llm/state"),
    session: () => api("/llm/session"),
    sessionModel: () => api("/llm/session/model"),
    configs: () => api("/llm/configs"),
    config: (configId: string) => api(llmConfig(configId)),
    testConfig: () => api("/llm/configs/test"),
    activateConfig: () => api("/llm/configs/activate"),
    activateVisionConfig: () => api("/llm/configs/activate-vision"),
    models: (params?: { configId?: string }) => api(`/llm/models${qs(params)}`),
    copilotDeviceStart: () => api("/llm/copilot/device/start"),
    copilotDevicePoll: () => api("/llm/copilot/device/poll"),
    copilotDisconnect: () => api("/llm/copilot/disconnect"),
  },

  authProfiles: {
    create: () => api("/auth-profiles"),
    detail: (profileId: string) => api(authProfile(profileId)),
    remove: (profileId: string) => api(authProfile(profileId)),
    generateValidationScript: (profileId: string) =>
      api(`${authProfile(profileId)}/generate-validation-script`),
    checkLoginStatus: (profileId: string) =>
      api(`${authProfile(profileId)}/check-login-status`),
    refreshState: (profileId: string) =>
      api(`${authProfile(profileId)}/refresh-state`),
    setPostLoginUrl: (profileId: string, targetUrlId: string) =>
      api(`${authProfile(profileId)}/states/${enc(targetUrlId)}/post-login-url`),
  },

  authLoginSandbox: {
    create: () => api("/auth-login-sandbox"),
    detail: (sessionId: string) => api(`/auth-login-sandbox/${enc(sessionId)}`),
    interactions: (sessionId: string) => api(`/auth-login-sandbox/${enc(sessionId)}/interactions`),
    save: (sessionId: string) => api(`/auth-login-sandbox/${enc(sessionId)}/save`),
    cancel: (sessionId: string) => api(`/auth-login-sandbox/${enc(sessionId)}/cancel`),
  },

  validationTasks: {
    stream: (taskId: string) => api(`/validation-tasks/${enc(taskId)}/stream`),
  },

  gitAuthProfiles: {
    list: () => api("/git-auth-profiles"),
    create: () => api("/git-auth-profiles"),
    remove: (profileId: string) => api(gitAuthProfile(profileId)),
  },

  modules: {
    remove: (id: string) => api(moduleId(id)),
  },

  targetUrls: {
    update: (id: string) => api(`/target-urls/${enc(id)}`),
    remove: (id: string) => api(`/target-urls/${enc(id)}`),
  },

  scheduleTriggers: {
    listForProject: (projectId: string) => api(`${project(projectId)}/schedule-triggers`),
    listForTask: (taskId: string) => api(`${taskPath(taskId)}/schedule-triggers`),
    create: () => api("/schedule-triggers"),
    update: (id: string) => api(`/schedule-triggers/${enc(id)}`),
    remove: (id: string) => api(`/schedule-triggers/${enc(id)}`),
    setEnabled: (id: string) => api(`/schedule-triggers/${enc(id)}/enable`),
    fire: (id: string) => api(`/schedule-triggers/${enc(id)}/fire`),
  },

} as const

export type TaskKindRoute = "agent" | "run" | "task-run" | "recorder"
export type TaskAction = "pause" | "resume" | "cancel"

export const taskActionUrl = (kind: TaskKindRoute, id: string, action: TaskAction) => {
  switch (kind) {
    case "agent":
      return apiRoutes.agent[action](id)
    case "run":
      return apiRoutes.runs[action](id)
    case "task-run":
      return apiRoutes.taskRuns[action](id)
    case "recorder":
      return apiRoutes.recorderSessions[action](id)
  }
}

export const streamUrl = (path: string) => `${apiBase}${path}`
