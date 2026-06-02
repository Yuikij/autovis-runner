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

export async function agentRoutes(app: FastifyInstance) {
  app.post("/scripts/generate", async (request, reply): Promise<ApiEnvelope<GenerateScriptResponse> | void> => {
    const body = z
      .object({
        projectId: z.string(),
        testCaseId: z.string(),
        prompt: z.string(),
        runTargetUrlId: z.string().min(1, "必须从下拉框选择一个目标 URL"),
        baseScriptId: z.string().optional(),
      })
      .parse(request.body) as GenerateScriptRequest

    const existing = store.findActiveAgentForCase(body.testCaseId)
    if (existing) {
      reply.code(409)
      return {
        data: {
          sessionId: existing.id,
        },
      } as any
    }

    const sessionId = `agent_${Math.random().toString(36).slice(2, 10)}`
    void store.runScriptAgent({ ...body, sessionId }).catch((err: any) => {
      if (err?.code === "TASK_CONFLICT") {
        // The case got beat by a concurrent request; nothing to do here as the conflict
        // response was already returned for the racing client.
        return
      }
      console.error("[agent] runScriptAgent failed:", err)
    })

    return {
      data: {
        sessionId,
      },
    }
  })

  app.post("/scripts/direct-execute", async (request, reply): Promise<ApiEnvelope<GenerateScriptResponse> | void> => {
    const body = z
      .object({
        projectId: z.string(),
        testCaseId: z.string(),
        prompt: z.string(),
        runTargetUrlId: z.string().min(1, "必须从下拉框选择一个目标 URL"),
      })
      .parse(request.body)

    const existing = store.findActiveAgentForCase(body.testCaseId)
    if (existing) {
      reply.code(409)
      return {
        data: {
          sessionId: existing.id,
        },
      } as any
    }

    const sessionId = `agent_${Math.random().toString(36).slice(2, 10)}`
    void store.runDirectAgent({ ...body, sessionId }).catch((err: any) => {
      if (err?.code === "TASK_CONFLICT") {
        return
      }
      console.error("[agent] runDirectAgent failed:", err)
    })

    return {
      data: {
        sessionId,
      },
    }
  })

  app.get("/agent/:sessionId", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const session = store.getAgentSession(params.sessionId)
    if (!session) {
      reply.code(404)
      return { message: "Agent session not found" }
    }
    return { data: session }
  })

  app.get("/agent/:sessionId/stream", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
  
    reply.raw.setHeader("Content-Type", "text/event-stream")
    reply.raw.setHeader("Cache-Control", "no-cache")
    reply.raw.setHeader("Connection", "keep-alive")
    reply.raw.flushHeaders()
  
    const session = store.getAgentSession(params.sessionId)
    if (session) {
      reply.raw.write(`data: ${JSON.stringify(session)}\n\n`)
    }
  
    const unsubscribe = store.subscribeAgent(params.sessionId, (agentSession) => {
      reply.raw.write(`data: ${JSON.stringify(agentSession)}\n\n`)
    })
  
    request.raw.on("close", () => {
      unsubscribe()
      reply.raw.end()
    })
  
    return reply
  })

  app.post("/agent/:sessionId/pause", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = store.pauseAgent(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Agent session not pausable" }
    }
    return { data: { kind: "agent", id: params.sessionId, status: "paused" } }
  })

  app.post("/agent/:sessionId/resume", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = store.resumeAgent(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Agent session not resumable" }
    }
    return { data: { kind: "agent", id: params.sessionId, status: "running" } }
  })

  app.post("/agent/:sessionId/cancel", async (request, reply) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params)
    const ok = store.cancelAgent(params.sessionId)
    if (!ok) {
      reply.code(409)
      return { message: "Agent session not cancellable" }
    }
    return { data: { kind: "agent", id: params.sessionId, status: "cancelling" } }
  })

}
