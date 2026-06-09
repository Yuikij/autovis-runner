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
import { createSseStream } from "../sse.js"

const RECORDER_TERMINAL_STATUSES = new Set(["completed", "error", "cancelled", "interrupted"])

export async function recorderRoutes(app: FastifyInstance) {
  app.post("/recorder-sessions", async (request): Promise<ApiEnvelope<RecorderSession>> => {
    const body = z
      .object({
        projectId: z.string(),
        testCaseId: z.string(),
        targetUrlId: z.string().optional(),
      })
      .parse(request.body) as StartRecorderSessionRequest
  
    return { data: await store.startRecorderSession(body) }
  })

  app.post("/recorder-sessions/:sessionId/interactions", async (request): Promise<ApiEnvelope<RecorderSession>> => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const body = z
      .object({
        type: z.enum(["navigate", "click", "dblclick", "input", "keydown", "scroll", "pointerdown", "pointermove", "pointerup"]),
        url: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        value: z.string().optional(),
        key: z.string().optional(),
        deltaY: z.number().optional(),
        selector: z.string().optional(),
        role: z.string().optional(),
        label: z.string().optional(),
        text: z.string().optional(),
        placeholder: z.string().optional(),
      })
      .parse(request.body) as RecorderInteractionRequest
  
    return { data: await store.applyRecorderInteraction(params.sessionId, body) }
  })

  app.post("/recorder-sessions/:sessionId/stop", async (request): Promise<ApiEnvelope<{ session: RecorderSession; script?: ScriptArtifact; run?: ExecutionRun }>> => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const body = z
      .object({
        saveAsScript: z.boolean().optional(),
        runAfterSave: z.boolean().optional(),
      })
      .parse(request.body) as StopRecorderSessionRequest
  
    return { data: await store.stopRecorderSession(params.sessionId, body) }
  })

  app.get("/recorder-sessions/:sessionId", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const session = await store.getRecorderSession(params.sessionId)
    if (!session) {
      reply.code(404)
      return { message: "Recorder session not found" }
    }
    return { data: session }
  })

  app.get("/recorder-sessions/:sessionId/stream", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const session = await store.getRecorderSession(params.sessionId)
    if (!session) {
      reply.code(404)
      return { message: "Recorder session not found" }
    }
  
    return createSseStream({
      streamName: "recorder",
      request,
      reply,
      initialData: session,
      subscribe: (listener) => store.subscribeRecorder(params.sessionId, listener),
      isDone: (nextSession) => RECORDER_TERMINAL_STATUSES.has(nextSession.status),
    })
  })

  app.post("/recorder-sessions/:sessionId/pause", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = store.pauseRecorder(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Recorder session not pausable" }
    }
    return { data: { kind: "recorder", id: params.sessionId, status: "paused" } }
  })

  app.post("/recorder-sessions/:sessionId/resume", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = store.resumeRecorder(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Recorder session not resumable" }
    }
    return { data: { kind: "recorder", id: params.sessionId, status: "running" } }
  })

  app.post("/recorder-sessions/:sessionId/cancel", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = await store.cancelRecorder(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Recorder session not cancellable" }
    }
    return { data: { kind: "recorder", id: params.sessionId, status: "cancelled" } }
  })

}
