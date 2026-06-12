import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type {
  ApiEnvelope,
  CopilotPollDeviceFlowRequest,
  CopilotSessionResponse,
  CopilotStartDeviceFlowRequest,
  CreateScriptVersionRequest,
  CreateScriptVersionResponse,
  ExecutionRun,
  GenerateScriptRequest,
  GenerateScriptResponse,
  GitAuthProfile,
  ImportLocalWorkspaceRequest,
  LlmState,
  LlmSessionConfig,
  UpsertLlmConfigRequest,
  Module,
  Project,
  ProjectWorkspace,
  RecorderInteractionRequest,
  RecorderSession,
  ScriptArtifact,
  StartRecorderSessionRequest,
  StartRunRequest,
  StartRunResponse,
  StartVerificationRequest,
  StartVerificationResponse,
  StopRecorderSessionRequest,
  SyncProjectWorkspaceRequest,
  TestCase,
  Task,
  TaskRun,
  ActivateLlmConfigRequest,
  UpsertGitAuthProfileRequest,
  UpsertModuleRequest,
  UpsertProjectRequest,
  UpsertProjectWorkspaceRequest,
  UpsertTestCaseRequest,
  WorkspaceFileContent,
  WorkspaceSearchMatch,
  WorkspaceTreeEntry,
} from "@autovis/shared"
import { store } from "../store.js"

export async function projectsRoutes(app: FastifyInstance) {
  app.get("/projects", async (): Promise<ApiEnvelope<Project[]>> => ({
    data: await store.listProjects(),
  }))

  app.get("/projects/:projectId", async (request, reply): Promise<ApiEnvelope<Project> | { message: string }> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const project = await store.getProject(params.projectId)
    if (!project) {
      reply.code(404)
      return { message: "Project not found" }
    }
  
    return { data: project }
  })

  app.post("/projects", async (request): Promise<ApiEnvelope<Project | undefined>> => {
    const body = z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().min(1),
        testBaseUrl: z.string().default(""),
        version: z.string().default(""),
        gitRepoUrl: z.string().default(""),
        localRepoPath: z.string().default(""),
      })
      .parse(request.body) as UpsertProjectRequest
  
    return { data: await store.saveProject(body) }
  })

  app.get("/projects/:projectId/workspace", async (request): Promise<ApiEnvelope<ProjectWorkspace | null>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.getProjectWorkspace(params.projectId) ?? null }
  })

  app.post("/projects/:projectId/workspace", async (request): Promise<ApiEnvelope<ProjectWorkspace | undefined>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({
      sourceKind: z.enum(["git", "local_path", "upload"]),
      gitRepoUrl: z.string().optional(),
      localSourcePath: z.string().optional(),
      branch: z.string().optional(),
      ref: z.string().optional(),
      gitAuthProfileId: z.string().optional(),
    }).parse(request.body) as UpsertProjectWorkspaceRequest
    return { data: await store.saveProjectWorkspace(params.projectId, body) }
  })

  app.post("/projects/:projectId/workspace/import-local", async (request): Promise<ApiEnvelope<{ managedRoot: string; totalFiles: number }>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({ localPath: z.string().min(1) }).parse(request.body) as ImportLocalWorkspaceRequest
    return { data: await store.importLocalWorkspace(params.projectId, body) }
  })

  app.post("/projects/:projectId/workspace/sync", async (request): Promise<ApiEnvelope<{ managedRoot: string; totalFiles: number; commit?: string }>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({ branch: z.string().optional(), ref: z.string().optional() }).parse(request.body) as SyncProjectWorkspaceRequest
    return { data: await store.syncProjectWorkspace(params.projectId, body) }
  })

  app.post("/projects/:projectId/workspace/upload", async (request): Promise<ApiEnvelope<{ managedRoot: string; totalFiles: number }>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const fileRequest = request as typeof request & { file: () => Promise<{ filename: string; toFile: (path: string) => Promise<void> } | undefined> }
    const part = await fileRequest.file()
    if (!part) {
      throw new Error("未收到上传文件")
    }
  
    const os = await import("node:os")
    const pathMod = await import("node:path")
    const fs = await import("node:fs/promises")
    const uploadDir = pathMod.join(os.tmpdir(), `autovis-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    const filePath = pathMod.join(uploadDir, part.filename)
    await fs.mkdir(uploadDir, { recursive: true })
    const chunks: Buffer[] = []
    for await (const chunk of part.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    await fs.writeFile(filePath, Buffer.concat(chunks))
    const result = await store.importUploadedWorkspace(params.projectId, filePath)
    await fs.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined)
    return { data: result }
  })

  app.get("/projects/:projectId/workspace/tree", async (request): Promise<ApiEnvelope<WorkspaceTreeEntry[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const query = z.object({ path: z.string().optional() }).parse(request.query)
    return { data: await store.listWorkspaceTree(params.projectId, query.path) }
  })

  app.get("/projects/:projectId/workspace/glob", async (request): Promise<ApiEnvelope<string[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const query = z.object({ pattern: z.string().min(1) }).parse(request.query)
    return { data: await store.globWorkspacePaths(params.projectId, query.pattern) }
  })

  app.post("/projects/:projectId/workspace/search", async (request): Promise<ApiEnvelope<WorkspaceSearchMatch[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({ query: z.string().min(1), path: z.string().optional(), limit: z.number().int().positive().max(100).optional() }).parse(request.body)
    return { data: await store.searchWorkspaceCode(params.projectId, body.query, body.path, body.limit) }
  })

  app.get("/projects/:projectId/workspace/file", async (request): Promise<ApiEnvelope<WorkspaceFileContent>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const query = z.object({ path: z.string().min(1), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().positive().max(1000).optional() }).parse(request.query)
    return { data: await store.readWorkspaceFile(params.projectId, query.path, query.offset, query.limit) }
  })

  app.delete("/projects/:projectId", async (request, reply): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    await store.deleteProject(params.projectId)
    return { data: true }
  })

  app.delete("/projects/:projectId/runs", async (request, reply): Promise<ApiEnvelope<boolean>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    await store.clearRuns(params.projectId)
    return { data: true }
  })

  app.get("/projects/:projectId/test-cases", async (request): Promise<ApiEnvelope<TestCase[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listTestCases(params.projectId) }
  })

  app.get("/projects/:projectId/tasks", async (request): Promise<ApiEnvelope<Task[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listTasks(params.projectId) }
  })

  app.get("/projects/:projectId/modules", async (request): Promise<ApiEnvelope<Module[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listModules(params.projectId) }
  })

  app.post("/projects/:projectId/modules", async (request): Promise<ApiEnvelope<Module | undefined>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z
      .object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().default(""),
      })
      .parse(request.body)
    const module = await store.saveModule({ ...body, projectId: params.projectId })
    return { data: module }
  })

  app.get("/projects/:projectId/runs", async (request): Promise<ApiEnvelope<ExecutionRun[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listRuns(params.projectId) }
  })

  app.get("/projects/:projectId/task-runs", async (request): Promise<ApiEnvelope<TaskRun[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listTaskRuns(params.projectId) }
  })

  app.get("/projects/:projectId/recorder-sessions", async (request): Promise<ApiEnvelope<RecorderSession[]>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listRecorderSessions(params.projectId) }
  })

  // ----- TargetUrls (项目网址管理) -----
  app.get("/projects/:projectId/target-urls", async (request) => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    return { data: await store.listTargetUrls(params.projectId) }
  })

  app.post("/projects/:projectId/target-urls", async (request) => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z.object({ label: z.string().min(1), url: z.string().min(1), needsStealth: z.boolean().optional() }).parse(request.body)
    return { data: await store.createTargetUrl({ projectId: params.projectId, label: body.label, url: body.url, needsStealth: body.needsStealth }) }
  })

  app.patch("/target-urls/:targetUrlId", async (request) => {
    const params = z.object({ targetUrlId: z.string() }).parse(request.params)
    const body = z.object({ label: z.string().optional(), url: z.string().optional(), needsStealth: z.boolean().optional() }).parse(request.body)
    return { data: await store.updateTargetUrl(params.targetUrlId, body) }
  })

  app.delete("/target-urls/:targetUrlId", async (request) => {
    const params = z.object({ targetUrlId: z.string() }).parse(request.params)
    await store.deleteTargetUrl(params.targetUrlId)
    return { data: true }
  })

  app.post("/projects/:projectId/test-cases", async (request): Promise<ApiEnvelope<TestCase | undefined>> => {
    const params = z.object({ projectId: z.string() }).parse(request.params)
    const body = z
      .object({
        id: z.string().optional(),
        caseCode: z.string().optional().default(""),
        moduleName: z.string().optional(),
        moduleId: z.string().optional(),
        purpose: z.string().optional().default(""),
        dependencyCaseIds: z.array(z.string()).default([]),
        authProfileId: z.string().optional(),
        steps: z.array(z.string().min(1)).min(1),
        expectedResult: z.string().min(1),
        testType: z.enum(["functional", "regression", "smoke"]),
        bugId: z.string().optional(),
        note: z.string().optional(),
        aiScript: z.string().optional(),
      })
      .parse(request.body) as Omit<UpsertTestCaseRequest, "projectId">
  
    return { data: await store.saveTestCase({ ...body, projectId: params.projectId }) }
  })

}
